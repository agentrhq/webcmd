from pydantic import BaseModel, Field, HttpUrl
from typing import List, Optional
from enum import Enum


class StudentProfile(BaseModel):
    year: Optional[str] = Field(None, example="1st Year")
    branch: Optional[str] = Field(None, example="CSE / AI")
    interests: Optional[str] = Field(None, example="hackathons, AI, web development")
    location: Optional[str] = Field(None, example="India")


class ResearchRequest(BaseModel):
    task: str = Field(
        ...,
        min_length=10,
        example="Find currently open opportunities for a first-year CSE/AI student. Check official pages, verify eligibility and deadline, and create a priority list of what I should apply for this week."
    )
    profile: Optional[StudentProfile] = None


class Opportunity(BaseModel):
    title: str
    eligible: bool
    deadline: Optional[str] = None
    what_to_do: str
    source: str
    reason: Optional[str] = None


class ResearchResponse(BaseModel):
    opportunities: List[Opportunity]
    next_3_actions: List[str]
    summary: str
    sources_checked: List[str] = []


class HealthResponse(BaseModel):
    status: str
    message: str
