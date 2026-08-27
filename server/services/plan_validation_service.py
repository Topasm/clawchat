"""Strict parsing and deterministic semantic validation for AI task plans."""

from __future__ import annotations

import json
import re
from collections import deque
from collections.abc import Collection, Iterable
from datetime import date

from pydantic import ValidationError as PydanticValidationError
from schemas.task import (
    PlanPayload,
    PlanValidationIssue,
    PlanValidationResult,
)
from utils import strip_markdown_fences

MAX_TOTAL_ESTIMATED_MINUTES = 43_200


class PlanOutputError(ValueError):
    """The AI response was not a valid plan payload."""

    def __init__(self, message: str, *, details: object | None = None):
        super().__init__(message)
        self.details = details


class PlanSemanticError(ValueError):
    """The plan was structurally valid but graph semantics were invalid."""

    def __init__(self, result: PlanValidationResult):
        super().__init__("The plan contains semantic validation errors")
        self.result = result


def parse_plan_response(raw_response: str) -> PlanPayload:
    """Parse one LLM response without silently falling back to an empty plan."""
    try:
        cleaned = strip_markdown_fences(raw_response)
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError) as exc:
        raise PlanOutputError("The AI response was not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise PlanOutputError("The AI response must be a JSON object")
    try:
        return PlanPayload.model_validate(parsed)
    except PydanticValidationError as exc:
        safe_errors = json.loads(json.dumps(exc.errors(include_url=False), default=str))
        raise PlanOutputError(
            "The AI response did not match the plan schema",
            details=safe_errors,
        ) from exc


def validate_plan_semantics(
    plan: PlanPayload,
    *,
    selected_indices: Iterable[int] | None = None,
    existing_child_titles: Collection[str] = (),
    allowed_skills: Collection[str] = (),
    effective_root_due_date: date | None = None,
) -> PlanValidationResult:
    """Validate dependency, title, skill, estimate, and due-date invariants."""
    errors: list[PlanValidationIssue] = []
    warnings: list[PlanValidationIssue] = []
    subtask_count = len(plan.subtasks)
    selected = (
        list(range(subtask_count))
        if selected_indices is None
        else list(selected_indices)
    )
    selected_set = set(selected)

    if not selected:
        errors.append(_issue("empty_selection", "Select at least one subtask"))
    if len(selected) != len(selected_set):
        errors.append(
            _issue("duplicate_selection", "selected_indices contains duplicates")
        )
    for index in selected:
        if index < 0 or index >= subtask_count:
            errors.append(
                _issue(
                    "invalid_selection_index",
                    f"Subtask index {index} is outside the proposal",
                    "selected_indices",
                )
            )

    normalized_titles: dict[str, int] = {}
    existing_normalized = {
        normalized
        for title in existing_child_titles
        if (normalized := _normalize_title(title))
    }
    for index in selected:
        if index < 0 or index >= subtask_count:
            continue
        normalized = _normalize_title(plan.subtasks[index].title)
        if normalized in normalized_titles:
            errors.append(
                _issue(
                    "duplicate_title",
                    f"Subtasks {normalized_titles[normalized]} and {index} have the same title",
                    f"subtasks.{index}.title",
                )
            )
        else:
            normalized_titles[normalized] = index
        if normalized in existing_normalized:
            errors.append(
                _issue(
                    "existing_title",
                    "A child task with this title already exists",
                    f"subtasks.{index}.title",
                )
            )

    dependency_edges: list[tuple[int, int]] = []
    for source_index in selected:
        if source_index < 0 or source_index >= subtask_count:
            continue
        dependencies = plan.subtasks[source_index].depends_on_indices
        if len(dependencies) != len(set(dependencies)):
            errors.append(
                _issue(
                    "duplicate_dependency",
                    "A subtask cannot contain duplicate dependencies",
                    f"subtasks.{source_index}.depends_on_indices",
                )
            )
        for target_index in dependencies:
            path = f"subtasks.{source_index}.depends_on_indices"
            if target_index < 0 or target_index >= subtask_count:
                errors.append(
                    _issue(
                        "dangling_dependency",
                        f"Dependency index {target_index} is outside the proposal",
                        path,
                    )
                )
            elif target_index == source_index:
                errors.append(
                    _issue(
                        "self_dependency",
                        "A subtask cannot depend on itself",
                        path,
                    )
                )
            elif target_index not in selected_set:
                errors.append(
                    _issue(
                        "unselected_dependency",
                        f"Dependency subtask {target_index} must also be selected",
                        path,
                    )
                )
            else:
                dependency_edges.append((source_index, target_index))

    if not _is_dag(selected_set, dependency_edges):
        errors.append(
            _issue("dependency_cycle", "Subtask dependencies contain a cycle")
        )

    if allowed_skills:
        for index, skill in enumerate(plan.suggested_skills):
            if skill not in allowed_skills:
                errors.append(
                    _issue(
                        "unknown_skill",
                        f"Unknown suggested skill: {skill}",
                        f"suggested_skills.{index}",
                    )
                )

    if plan.suggested_project_title:
        safe_project_title = (
            re.sub(
                r'[<>:"/\\|?*\x00]',
                "_",
                plan.suggested_project_title,
            )
            .strip()
            .rstrip(".")
        )
        safe_project_title = re.sub(r"\s+", "_", safe_project_title)
        if not safe_project_title:
            errors.append(
                _issue(
                    "invalid_project_title",
                    "The suggested project title cannot form a safe Vault path",
                    "suggested_project_title",
                )
            )

    total_estimate = sum(
        plan.subtasks[index].estimated_minutes or 0
        for index in selected
        if 0 <= index < subtask_count
    )
    if total_estimate > MAX_TOTAL_ESTIMATED_MINUTES:
        errors.append(
            _issue(
                "estimate_too_large",
                f"Selected subtasks exceed {MAX_TOTAL_ESTIMATED_MINUTES} total minutes",
                "subtasks",
            )
        )

    root_due_date = plan.suggested_root_due_date or effective_root_due_date
    if root_due_date:
        for index in selected:
            if index < 0 or index >= subtask_count:
                continue
            due_date = plan.subtasks[index].due_date
            if due_date and due_date > root_due_date:
                errors.append(
                    _issue(
                        "child_due_after_root",
                        "A subtask due date cannot be after the root due date",
                        f"subtasks.{index}.due_date",
                    )
                )

    return PlanValidationResult(errors=errors, warnings=warnings)


def require_valid_plan(
    plan: PlanPayload,
    *,
    selected_indices: Iterable[int] | None = None,
    existing_child_titles: Collection[str] = (),
    allowed_skills: Collection[str] = (),
    effective_root_due_date: date | None = None,
) -> PlanValidationResult:
    result = validate_plan_semantics(
        plan,
        selected_indices=selected_indices,
        existing_child_titles=existing_child_titles,
        allowed_skills=allowed_skills,
        effective_root_due_date=effective_root_due_date,
    )
    if result.errors:
        raise PlanSemanticError(result)
    return result


def _issue(code: str, message: str, path: str | None = None) -> PlanValidationIssue:
    return PlanValidationIssue(code=code, message=message, path=path)


def _normalize_title(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).casefold()


def _is_dag(nodes: set[int], edges: list[tuple[int, int]]) -> bool:
    """Return whether a dependency graph is acyclic without recursion."""
    adjacency: dict[int, set[int]] = {node: set() for node in nodes}
    indegree = dict.fromkeys(nodes, 0)
    for source, target in edges:
        if target in adjacency[source]:
            continue
        adjacency[source].add(target)
        indegree[target] += 1
    queue = deque(node for node, degree in indegree.items() if degree == 0)
    visited = 0
    while queue:
        node = queue.popleft()
        visited += 1
        for target in adjacency[node]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    return visited == len(nodes)
