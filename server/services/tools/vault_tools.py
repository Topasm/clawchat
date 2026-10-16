"""Shared device folders as tools for chat and agents.

Only sources whose owner turned on AI access are offered, and every call goes
through the same relay a phone uses: the share policy is applied, the request
is logged with the chat or run that made it, and a machine that is off falls
back to names and dates. Adding a task only proposes it: the change waits in
review, and a source that does not take changes is not offered the tool.
"""

from __future__ import annotations

from typing import Any

from domain.agent_tools import ToolTrust
from exceptions import AppError
from models.data_source import DataSource
from models.execution_host import ExecutionHost
from services.data_sources import service
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

VAULT_SEARCH = "vault_search"
VAULT_READ = "vault_read"
VAULT_ADD_TASK = "vault_add_task"
VAULT_TOOLS = (VAULT_SEARCH, VAULT_READ, VAULT_ADD_TASK)
#: What a skill's ``mcp-servers`` names to be offered these tools.
VAULT_SERVER_NAME = "vault"
#: Most of one file the model is handed; notes beyond this are cut.
MAX_AI_CONTENT_CHARS = 40_000

_SOURCE_PROPERTY = {
    "type": "string",
    "description": "Which shared source, by name. Needed only when there are several.",
}


async def ai_sources(db: AsyncSession) -> list[DataSource]:
    return list(
        (
            await db.execute(
                select(DataSource)
                .where(DataSource.ai_access.is_(True))
                .order_by(DataSource.created_at.asc())
            )
        ).scalars()
    )


async def _source_list(db: AsyncSession, sources: list[DataSource]) -> str:
    names = []
    for source in sources:
        host = await db.get(ExecutionHost, source.host_id)
        where = f" on {host.label}" if host is not None else ""
        names.append(f"'{source.name}'{where}")
    return ", ".join(names)


async def specs(db: AsyncSession):
    """The vault tools this turn may call; none without a source shared with the AI."""
    from services.tools.catalog import ToolSpec

    sources = await ai_sources(db)
    if not sources:
        return []
    listed = await _source_list(db, sources)
    result = [
        ToolSpec(
            name=VAULT_SEARCH,
            description=(
                "Search the user's notes in folders their devices share with you "
                f"({listed}). Returns matching file paths with the matching line. "
                "Only what the owner shared is searched."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Words to look for."},
                    "folder": {
                        "type": "string",
                        "description": "Search only under this folder, relative to the source.",
                    },
                    "source": _SOURCE_PROPERTY,
                },
                "required": ["query"],
            },
            trust=ToolTrust.READ_ONLY,
        ),
        ToolSpec(
            name=VAULT_READ,
            description=(
                f"Read one note from a folder the user's devices share with you ({listed}). "
                "Use a path vault_search returned. Works only while that machine is on."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "The file, relative to the source."},
                    "source": _SOURCE_PROPERTY,
                },
                "required": ["path"],
            },
            trust=ToolTrust.READ_ONLY,
        ),
    ]
    writable = [source for source in sources if source.allow_writes]
    if writable:
        result.append(
            ToolSpec(
                name=VAULT_ADD_TASK,
                description=(
                    "Propose adding one task to a TODO.md in a shared folder "
                    f"({await _source_list(db, writable)}). It is not added yet: the "
                    "user approves or rejects it in Attention first. Say so in your reply."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "The TODO.md to add to, relative to the source.",
                        },
                        "task": {"type": "string", "description": "The task, in one line."},
                        "source": _SOURCE_PROPERTY,
                    },
                    "required": ["path", "task"],
                },
                # Nothing changes without the user: the proposal goes to review.
                trust=ToolTrust.READ_ONLY,
            )
        )
    return result


async def _pick_source(db: AsyncSession, wanted: Any) -> DataSource | str:
    """The source a call names, or why none fits."""
    sources = await ai_sources(db)
    if not sources:
        return "No folder is shared with the AI any more."
    name = str(wanted or "").strip()
    if not name:
        if len(sources) == 1:
            return sources[0]
        return f"Say which source: {await _source_list(db, sources)}."
    for source in sources:
        if name in (source.id, source.name) or name.casefold() == source.name.casefold():
            return source
    return f"There is no shared source named {name!r}. Shared: {await _source_list(db, sources)}."


def _format_search(answer) -> str:
    if not answer.matches:
        found = "Nothing matched."
    else:
        lines = []
        for match in answer.matches:
            line = f"- {match.path}"
            if match.snippet:
                line += f" (line {match.line}): {match.snippet}" if match.line else f": {match.snippet}"
            lines.append(line)
        found = "\n".join(lines)
    if answer.origin == "cache":
        found = (
            "The machine that holds these notes is off, so only file names were "
            "searched, not contents.\n" + found
        )
    return found


def _format_read(path: str, answer) -> str:
    content = answer.content or ""
    cut = answer.truncated or len(content) > MAX_AI_CONTENT_CHARS
    content = content[:MAX_AI_CONTENT_CHARS]
    note = "\n\n[The note was cut to fit.]" if cut else ""
    return f"{path}:\n\n{content}{note}"


async def execute(
    db: AsyncSession, name: str, arguments: dict[str, Any], *, requested_by: str
) -> tuple[str, bool]:
    """Run one vault tool call; ``(text for the model, is_error)``."""
    source = await _pick_source(db, arguments.get("source"))
    if isinstance(source, str):
        return source, True
    try:
        if name == VAULT_SEARCH:
            answer = await service.query_source(
                db,
                source,
                op="search",
                raw_path=str(arguments.get("folder") or "") or None,
                text=str(arguments.get("query") or ""),
                requested_by=requested_by,
                for_ai=True,
            )
            return _format_search(answer), False
        if name == VAULT_READ:
            path = str(arguments.get("path") or "")
            answer = await service.query_source(
                db,
                source,
                op="read",
                raw_path=path,
                text=None,
                requested_by=requested_by,
                for_ai=True,
            )
            return _format_read(answer.path or path, answer), False
        if name == VAULT_ADD_TASK:
            proposal = await service.propose_write(
                db,
                source,
                op="append_todo",
                raw_path=str(arguments.get("path") or ""),
                text=str(arguments.get("task") or ""),
                requested_by=requested_by,
                for_ai=True,
            )
            from ws.notifications import notify_module_data_changed

            await notify_module_data_changed("reviews")
            return (
                f"Proposed adding \"{proposal.line}\" to {proposal.path}. It waits for "
                "the user's approval in Attention and is not in the file yet."
            ), False
    except AppError as exc:
        reason = (exc.details or {}).get("reason")
        return f"{exc.message}" + (f" ({reason})" if reason else ""), True
    return f"There is no tool named {name}.", True
