from typing import Literal

from pydantic import BaseModel, Field, field_validator

ModelProvider = Literal["codex_cli", "claude_code", "codex"]


class AIModelSelection(BaseModel):
    provider: ModelProvider
    model: str
    persistent: bool


class AIModelCatalog(AIModelSelection):
    models: list[str]
    source: Literal["cli", "api", "aliases", "suggestions"]


class AIModelUpdate(BaseModel):
    model: str = Field(max_length=200)

    @field_validator("model")
    @classmethod
    def clean_model(cls, value: str) -> str:
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Model IDs cannot contain control characters")
        return value.strip()
