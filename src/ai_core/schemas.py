from pydantic import BaseModel, Field
from typing import List, Optional


class LeadScoreResult(BaseModel):
    score: float = Field(ge=0, le=5, description="Relevance score from 0 to 5")
    is_relevant: bool = Field(description="Whether the job is relevant to our services")
    project_type: str = Field(description="Type of project (e.g., Full-Stack, Mobile, Design)")
    tech_stack: List[str] = Field(description="Predicted technology stack")
    reasoning: Optional[str] = Field(default=None, description="Brief reasoning for the score")


class ProposalResult(BaseModel):
    proposal: str = Field(description="Tailored Arabic proposal for the client")
    highlights: List[str] = Field(description="Key selling points to emphasize")
    estimated_budget: Optional[str] = Field(default=None, description="Suggested budget range")


class JobRecord(BaseModel):
    id: int
    title: str
    description: str
    budget: Optional[str] = None
    platform: str = Field(description="Source platform: mostaql or khamsat")
    url: str
    proposals_count: Optional[int] = None
    client_hiring_rate: Optional[float] = None
    client_notes: Optional[str] = None
