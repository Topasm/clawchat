from pydantic import BaseModel, Field, model_validator


class InboxReviewChoice(BaseModel):
    project_id: str | None
    parent_id: str | None


class InboxReviewUpdate(BaseModel):
    deferred: bool | None = None
    exclude_deadline: bool | None = None
    choice: InboxReviewChoice | None = None
    expected_graph_revision: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_choice(self):
        if self.choice is not None and self.expected_graph_revision is None:
            raise ValueError("A saved location requires the graph revision")
        return self


class InboxReviewItem(BaseModel):
    task_id: str
    deferred: bool
    exclude_deadline: bool
    choice: InboxReviewChoice | None = None
    choice_revision: int | None = None


class InboxReviewState(BaseModel):
    items: list[InboxReviewItem]
