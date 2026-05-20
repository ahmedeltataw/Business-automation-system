"""
AI Processing Engine — Python LiteLLM Router

Processes pending freelance jobs from Supabase through the LiteLLM AI router
for scoring and Arabic proposal generation. Uses Pydantic models for strict
response validation and structured database updates.

Usage:
    python engine.py
"""

import os
import sys
import json
import time
import io
import logging
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Console Encoding (Windows UTF-8 BOM workaround)
# ---------------------------------------------------------------------------

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Strip BOM from environment variables
for key in list(os.environ.keys()):
    if key.startswith("\ufeff"):
        clean_key = key.replace("\ufeff", "")
        os.environ[clean_key] = os.environ.pop(key)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Environment — dotenv must load before any ai_router import
# ---------------------------------------------------------------------------

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from supabase import create_client, Client
from pydantic import ValidationError

from ai_router import call
from schemas import LeadScoreResult, ProposalResult, JobRecord

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
TABLE_PREFIX = os.environ.get("SUPABASE_TABLE_PREFIX", "")
TABLE_SCRAPED_JOBS = f"{TABLE_PREFIX}scraped_jobs"

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------------------------------------------------------------------------
# System Prompts
# ---------------------------------------------------------------------------

SYSTEM_SCORER = (
    "You are a freelance job analyzer for an Arabic freelancing agency. "
    "Score jobs 0-5 based on relevance, budget clarity, and client quality. "
    "Respond with valid JSON ONLY, using exactly these fields: "
    '{"score": <float 0-5>, "is_relevant": <bool>, "project_type": "<string>", '
    '"tech_stack": ["<string>", ...], "reasoning": "<string>"}'
)

SYSTEM_PROPOSAL = (
    "You are a professional proposal writer for an Arabic freelancing agency. "
    "Write a compelling, tailored proposal in Arabic that addresses the client needs directly. "
    "Respond with valid JSON ONLY, using exactly these fields: "
    '{"proposal": "<Arabic text>", "highlights": ["<string>", ...], "estimated_budget": "<string or null>"}'
)

# ---------------------------------------------------------------------------
# Database Helpers
# ---------------------------------------------------------------------------


def fetch_pending_jobs(limit: int = 10) -> list[dict]:
    """Fetch jobs flagged for AI processing, ordered by creation date."""
    response = (
        supabase.table(TABLE_SCRAPED_JOBS)
        .select("*")
        .eq("ai_lead_score_warning", "true")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return response.data or []


def mark_processing(job_id: str) -> None:
    """Clear the processing flag to prevent duplicate work."""
    supabase.table(TABLE_SCRAPED_JOBS).update(
        {
            "ai_lead_score_warning": False,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", job_id).execute()


def update_job_score(job_id: str, score_result: LeadScoreResult) -> None:
    """Persist AI scoring results to the job record."""
    supabase.table(TABLE_SCRAPED_JOBS).update(
        {
            "ai_score": int(score_result.score),
            "ai_project_type": score_result.project_type,
            "ai_tech_stack": json.dumps(score_result.tech_stack),
            "ai_summary_ar": score_result.reasoning or "",
            "ai_is_relevant": score_result.is_relevant,
            "ai_analyzed_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", job_id).execute()


def update_proposal(job_id: str, proposal_result: ProposalResult) -> None:
    """Persist generated proposal text to the job record."""
    supabase.table(TABLE_SCRAPED_JOBS).update(
        {
            "ai_proposal_text": proposal_result.proposal,
            "ai_estimated_effort": json.dumps(proposal_result.highlights),
            "ai_proposal_generated_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", job_id).execute()

# ---------------------------------------------------------------------------
# Job Processing
# ---------------------------------------------------------------------------


def process_job(job: dict) -> dict:
    """Score a job and generate a proposal if relevant."""
    job_id = str(job["id"])
    title = (job.get("title") or "")[:150]
    description = (job.get("description") or "")[:2000]
    platform = job.get("platform", "unknown")
    budget = job.get("budget")
    proposals_count = job.get("proposals_count")
    client_hiring_rate = job.get("client_hiring_rate")
    client_notes = job.get("client_notes")

    context = (
        f"Platform: {platform}\n"
        f"Title: {title}\n"
        f"Budget: {budget or 'Not specified'}\n"
        f"Proposals: {proposals_count or 'Unknown'}\n"
        f"Client Hiring Rate: {client_hiring_rate or 'Unknown'}\n"
        f"Client Notes: {client_notes or 'None'}\n\n"
        f"Description:\n{description}"
    )

    logger.info("[Job %s] Scoring: %s", job_id, title)

    try:
        score_result = call(
            "free-lead-scorer",
            f"Analyze this job:\n{context}",
            SYSTEM_SCORER,
            response_model=LeadScoreResult,
        )
        logger.info("  Score: %s/5, Relevant: %s", score_result.score, score_result.is_relevant)
        update_job_score(job_id, score_result)
    except Exception as e:
        logger.error("  Scoring failed: %s", e)
        return {"job_id": job_id, "status": "score_failed", "error": str(e)}

    if not score_result.is_relevant or score_result.score < 2:
        logger.info("  [SKIP] Low relevance/score, skipping proposal generation")
        return {"job_id": job_id, "status": "skipped", "score": score_result.score}

    logger.info("[Job %s] Generating proposal...", job_id)

    try:
        proposal_result = call(
            "free-proposal-generator",
            f"Write a proposal for this job:\n{context}",
            SYSTEM_PROPOSAL,
            response_model=ProposalResult,
        )
        logger.info("  Proposal: %s...", proposal_result.proposal[:80])
        update_proposal(job_id, proposal_result)
    except Exception as e:
        logger.error("  Proposal generation failed: %s", e)
        return {"job_id": job_id, "status": "proposal_failed", "error": str(e)}

    return {"job_id": job_id, "status": "completed", "score": score_result.score}

# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------


def main() -> None:
    """Process all pending jobs through scoring and proposal generation."""
    logger.info("=" * 60)
    logger.info("  AI Processing Engine — Python LiteLLM Router")
    logger.info("=" * 60)

    jobs = fetch_pending_jobs(limit=10)
    if not jobs:
        logger.info("No pending jobs to process.")
        return

    logger.info("Found %d pending job(s) to analyze.", len(jobs))

    results = []
    for job in jobs:
        mark_processing(job["id"])
        result = process_job(job)
        results.append(result)
        time.sleep(2)

    logger.info("=" * 60)
    logger.info("  Processing Summary")
    logger.info("=" * 60)

    status_icons = {
        "completed": "✅",
        "skipped": "⏭️",
        "score_failed": "❌",
        "proposal_failed": "⚠️",
    }
    for r in results:
        icon = status_icons.get(r["status"], "?")
        logger.info("  %s Job %s: %s", icon, r["job_id"], r["status"])

    completed = sum(1 for r in results if r["status"] == "completed")
    logger.info("\n  Total: %d | Completed: %d", len(results), completed)


if __name__ == "__main__":
    main()
