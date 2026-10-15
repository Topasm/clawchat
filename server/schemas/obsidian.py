from pydantic import BaseModel, Field


class ObsidianProjectRootUpdate(BaseModel):
    # Vault-relative folder; empty means only folders holding a TODO.md count.
    project_root: str = Field("", max_length=512)


class ObsidianProjectTodoCreate(BaseModel):
    # Vault-relative project folder directly under the project root.
    folder: str = Field(..., min_length=1, max_length=1024)
