"""Pydantic response schemas for the capabilities endpoint."""

from pydantic import BaseModel


class AICapability(BaseModel):
    provider: str | None
    model: str
    available: bool


class FeaturesCapability(BaseModel):
    obsidian: bool
    calendar: bool
    kanban: bool
    inbox_pipeline: bool
    skills: list[str]
    agent_tasks: bool


class CapabilitiesResponse(BaseModel):
    ai: AICapability
    features: FeaturesCapability
    version: str
