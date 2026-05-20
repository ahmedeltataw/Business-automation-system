import os
import sys
import json
import time
import io
from datetime import datetime, timezone

# Fix Windows console encoding for Arabic text
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from dotenv import load_dotenv
from supabase import create_client, Client
from pydantic import ValidationError

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

# Strip BOM from env vars (Windows UTF-8 BOM issue)
for key in list(os.environ.keys()):
    if key.startswith('\ufeff'):
        clean_key = key.replace('\ufeff', '')
        os.environ[clean_key] = os.environ.pop(key)

from ai_router import call
from schemas import LeadScoreResult, ProposalResult, JobRecord

SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print('[ERROR] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

SYSTEM_SCORER = (
    'You are a freelance job analyzer for an Arabic freelancing agency. '
    'Score jobs 0-5 based on relevance, budget clarity, and client quality. '
    'Respond with valid JSON ONLY, using exactly these fields: '
    '{"score": <float 0-5>, "is_relevant": <bool>, "project_type": "<string>", "tech_stack": ["<string>", ...], "reasoning": "<string>"}'
)

SYSTEM_PROPOSAL = (
    'You are a professional proposal writer for an Arabic freelancing agency. '
    'Write a compelling, tailored proposal in Arabic that addresses the client needs directly. '
    'Respond with valid JSON ONLY, using exactly these fields: '
    '{"proposal": "<Arabic text>", "highlights": ["<string>", ...], "estimated_budget": "<string or null>"}'
)


def fetch_pending_jobs(limit: int = 10) -> list[dict]:
    response = (
        supabase.table('scraped_jobs')
        .select('*')
        .eq('ai_lead_score_warning', 'true')
        .order('created_at', desc=True)
        .limit(limit)
        .execute()
    )
    return response.data or []


def mark_processing(job_id: str):
    supabase.table('scraped_jobs').update({
        'ai_lead_score_warning': False,
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }).eq('id', job_id).execute()


def update_job_score(job_id: str, score_result: LeadScoreResult):
    supabase.table('scraped_jobs').update({
        'ai_score': int(score_result.score),
        'ai_project_type': score_result.project_type,
        'ai_tech_stack': json.dumps(score_result.tech_stack),
        'ai_summary_ar': score_result.reasoning or '',
        'ai_is_relevant': score_result.is_relevant,
        'ai_analyzed_at': datetime.now(timezone.utc).isoformat(),
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }).eq('id', job_id).execute()


def update_proposal(job_id: str, proposal_result: ProposalResult):
    supabase.table('scraped_jobs').update({
        'ai_proposal_text': proposal_result.proposal,
        'ai_estimated_effort': json.dumps(proposal_result.highlights),
        'ai_proposal_generated_at': datetime.now(timezone.utc).isoformat(),
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }).eq('id', job_id).execute()


def process_job(job: dict) -> dict:
    job_id = str(job['id'])
    title = (job.get('title') or '')[:150]
    description = (job.get('description') or '')[:2000]
    platform = job.get('platform', 'unknown')
    budget = job.get('budget')
    proposals_count = job.get('proposals_count')
    client_hiring_rate = job.get('client_hiring_rate')
    client_notes = job.get('client_notes')

    context = (
        f'Platform: {platform}\n'
        f'Title: {title}\n'
        f'Budget: {budget or "Not specified"}\n'
        f'Proposals: {proposals_count or "Unknown"}\n'
        f'Client Hiring Rate: {client_hiring_rate or "Unknown"}\n'
        f'Client Notes: {client_notes or "None"}\n\n'
        f'Description:\n{description}'
    )

    print(f'\n[Job {job_id}] Scoring: {title}')

    try:
        score_result = call(
            'free-lead-scorer',
            f'Analyze this job:\n{context}',
            SYSTEM_SCORER,
            response_model=LeadScoreResult,
        )
        print(f'  Score: {score_result.score}/5, Relevant: {score_result.is_relevant}')
        update_job_score(job_id, score_result)
    except Exception as e:
        print(f'  [ERROR] Scoring failed: {e}')
        return {'job_id': job_id, 'status': 'score_failed', 'error': str(e)}

    if not score_result.is_relevant or score_result.score < 2:
        print(f'  [SKIP] Low relevance/score, skipping proposal generation')
        return {'job_id': job_id, 'status': 'skipped', 'score': score_result.score}

    print(f'[Job {job_id}] Generating proposal...')

    try:
        proposal_result = call(
            'free-proposal-generator',
            f'Write a proposal for this job:\n{context}',
            SYSTEM_PROPOSAL,
            response_model=ProposalResult,
        )
        print(f'  Proposal: {proposal_result.proposal[:80]}...')
        update_proposal(job_id, proposal_result)
    except Exception as e:
        print(f'  [ERROR] Proposal generation failed: {e}')
        return {'job_id': job_id, 'status': 'proposal_failed', 'error': str(e)}

    return {'job_id': job_id, 'status': 'completed', 'score': score_result.score}


def main():
    print('=' * 60)
    print('  AI Processing Engine — Python LiteLLM Router')
    print('=' * 60)

    jobs = fetch_pending_jobs(limit=10)
    if not jobs:
        print('\nNo pending jobs to process.')
        return

    print(f'\nFound {len(jobs)} pending job(s) to analyze.\n')

    results = []
    for job in jobs:
        mark_processing(job['id'])
        result = process_job(job)
        results.append(result)
        time.sleep(2)

    print('\n' + '=' * 60)
    print('  Processing Summary')
    print('=' * 60)
    for r in results:
        status_icon = {'completed': '✅', 'skipped': '⏭️', 'score_failed': '❌', 'proposal_failed': '⚠️'}.get(r['status'], '?')
        print(f'  {status_icon} Job {r["job_id"]}: {r["status"]}')

    completed = sum(1 for r in results if r['status'] == 'completed')
    print(f'\n  Total: {len(results)} | Completed: {completed}')


if __name__ == '__main__':
    main()
