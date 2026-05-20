"""
Pydantic Schemas — AI Response Models

Defines structured data models for AI scoring results, proposal generation,
and job records. Used by the Python AI engine for response validation and
database serialization.
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class LeadScoreResult(BaseModel):
    """AI scoring result for a freelance job posting."""

    score: float = Field(
        ge=0, le=5,
        description="Relevance score from 0 (irrelevant) to 5 (perfect match)"
    )
    is_relevant: bool = Field(
        description="Whether the job is relevant to our core services"
    )
    project_type: str = Field(
        description="Category: UI/UX, Frontend, Full-Stack, Mobile, or Irrelevant"
    )
    tech_stack: List[str] = Field(
        description="Predicted technology stack required for the project"
    )
    reasoning: Optional[str] = Field(
        default=None,
        description="Brief explanation for the assigned score"
    )


class ProposalResult(BaseModel):
    """Generated Arabic proposal for a relevant job."""

    proposal: str = Field(
        description="Tailored Arabic proposal text addressed to the client"
    )
    highlights: List[str] = Field(
        description="Key selling points to emphasize in the proposal"
    )
    estimated_budget: Optional[str] = Field(
        default=None,
        description="Suggested budget range for the project"
    )


class JobRecord(BaseModel):
    """Represents a scraped job posting from the database."""

    id: int
    title: str
    description: str
    budget: Optional[str] = None
    platform: str = Field(
        description="Source platform name (e.g. mostaql, khamsat)"
    )
    url: str
    proposals_count: Optional[int] = None
    client_hiring_rate: Optional[float] = None
    client_notes: Optional[str] = None
