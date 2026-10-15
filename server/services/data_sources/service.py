"""Registering data sources and relaying requests for their contents.

A request is checked against what the source's owner shared, queued for the
machine that holds the data, and answered by that machine's desktop app. When
the machine is off, or does not answer in time, names and dates come from the
light index instead; contents never do, because the server never has them.
"""

from __future__ import annotations

import asyncio
import json
import logging
import posixpath
import unicodedata
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from exceptions import AppError, ForbiddenError, NotFoundError, ValidationError
from models.data_source import DataSource, DataSourceEntry, DataSourceQuery
from models.execution_host import ExecutionHost
from schemas.data_source import (
    ClaimedDataQuery,
    DataQueryAnswer,
    DataSourceQueryResponse,
    DataSourceResponse,
    DataSourceTodoItem,
)
from schemas.data_source import DataSourceEntry as EntryOut
from schemas.data_source import DataSourceSearchMatch as MatchOut
from services.data_sources.broker import broker
from services.data_sources.policy import PathDenied, SharePolicy, normalize_path

logger = logging.getLogger(__name__)

#: A source counts as online while its machine asked for requests this
#: recently. The machine asks again as soon as a long poll ends, so silence
#: past a couple of poll lengths means the app is closed or asleep.
SOURCE_ONLINE_GRACE = timedelta(seconds=60)
#: How long a request waits for the machine before falling back to the index.
DEFAULT_ANSWER_TIMEOUT_SECONDS = 15.0
#: How long one claim may hold the connection open waiting for a request.
MAX_CLAIM_WAIT_SECONDS = 25.0
#: Content handed back from one read.
MAX_CONTENT_CHARS = 512_000
MAX_CACHED_MATCHES = 50


# -- registration -------------------------------------------------------------


def _json_list(value: str | None) -> list[str]:
    try:
        parsed = json.loads(value or "[]")
    except ValueError:
        return []
    return [str(item) for item in parsed] if isinstance(parsed, list) else []


def policy_for(source: DataSource) -> SharePolicy:
    return SharePolicy.from_lists(
        _json_list(source.include_folders), _json_list(source.exclude_folders)
    )


def _normalize_folders(folders: list[str]) -> list[str]:
    normalized: list[str] = []
    for folder in folders:
        try:
            value = normalize_path(folder)
        except PathDenied as exc:
            raise ValidationError(
                f"{folder!r} is not a folder inside the source.",
                details={"reason": exc.reason, "folder": folder},
            ) from exc
        if value and value not in normalized:
            normalized.append(value)
    return normalized


def apply_settings(
    source: DataSource,
    *,
    capabilities: list[str] | None = None,
    include_folders: list[str] | None = None,
    exclude_folders: list[str] | None = None,
) -> None:
    if capabilities is not None:
        source.capabilities = json.dumps(sorted(set(capabilities)))
    if include_folders is not None:
        source.include_folders = json.dumps(_normalize_folders(include_folders))
    if exclude_folders is not None:
        source.exclude_folders = json.dumps(_normalize_folders(exclude_folders))


def is_online(source: DataSource, *, now: datetime | None = None) -> bool:
    if source.last_seen_at is None:
        return False
    last_seen = source.last_seen_at
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    return (now or datetime.now(timezone.utc)) - last_seen <= SOURCE_ONLINE_GRACE


async def describe(db: AsyncSession, source: DataSource) -> DataSourceResponse:
    host = await db.get(ExecutionHost, source.host_id)
    indexed = (
        await db.execute(
            select(func.count()).select_from(DataSourceEntry).where(
                DataSourceEntry.source_id == source.id
            )
        )
    ).scalar_one()
    return DataSourceResponse(
        id=source.id,
        host_id=source.host_id,
        host_label=host.label if host is not None else "",
        kind=source.kind,
        name=source.name,
        capabilities=_json_list(source.capabilities),
        include_folders=_json_list(source.include_folders),
        exclude_folders=_json_list(source.exclude_folders),
        is_online=is_online(source),
        last_seen_at=source.last_seen_at,
        index_updated_at=source.index_updated_at,
        indexed_files=indexed,
        created_at=source.created_at,
    )


# -- the light index ----------------------------------------------------------


def _title_for(path: str, title: str | None) -> str:
    if title and title.strip():
        return title.strip()
    name = posixpath.basename(path)
    stem, ext = posixpath.splitext(name)
    return stem if ext.lower() == ".md" else name


async def replace_index(db: AsyncSession, source: DataSource, files) -> int:
    """Store the light index the machine sent, keeping only what is shared."""
    policy = policy_for(source)
    rows: dict[str, DataSourceEntry] = {}
    for item in files:
        try:
            path = normalize_path(item.path)
        except PathDenied:
            continue
        if not path or not policy.shows_entry(path, is_dir=False):
            continue
        rows[path] = DataSourceEntry(
            source_id=source.id,
            path=path,
            title=_title_for(path, unicodedata.normalize("NFC", item.title or "")),
            size=item.size,
            modified_at=item.modified_at,
        )
    await db.execute(delete(DataSourceEntry).where(DataSourceEntry.source_id == source.id))
    db.add_all(rows.values())
    now = datetime.now(timezone.utc)
    source.index_updated_at = now
    source.last_seen_at = now
    await db.flush()
    return len(rows)


async def _cached_listing(
    db: AsyncSession, source: DataSource, folder: str, policy: SharePolicy
) -> list[EntryOut]:
    prefix = f"{folder}/" if folder else ""
    query = select(DataSourceEntry).where(DataSourceEntry.source_id == source.id)
    if prefix:
        query = query.where(DataSourceEntry.path.startswith(prefix, autoescape=True))
    files = (await db.execute(query)).scalars().all()

    folders: dict[str, datetime | None] = {}
    entries: list[EntryOut] = []
    for row in files:
        rest = row.path[len(prefix):]
        child, _, deeper = rest.partition("/")
        if deeper:
            # A file further down: its folder is the child here, dated by
            # its most recently changed file.
            path = prefix + child
            latest = folders.setdefault(path, None)
            if row.modified_at and (latest is None or row.modified_at > latest):
                folders[path] = row.modified_at
            continue
        if policy.shows_entry(row.path, is_dir=False):
            entries.append(
                EntryOut(
                    path=row.path,
                    name=child,
                    title=row.title,
                    size=row.size,
                    modified_at=row.modified_at,
                )
            )
    for path, modified_at in folders.items():
        if policy.shows_entry(path, is_dir=True):
            name = posixpath.basename(path)
            entries.append(
                EntryOut(path=path, name=name, title=name, is_dir=True, modified_at=modified_at)
            )
    return _sorted_entries(entries)


def _sorted_entries(entries: list[EntryOut]) -> list[EntryOut]:
    return sorted(entries, key=lambda entry: (not entry.is_dir, entry.name.lower()))


async def _cached_search(
    db: AsyncSession, source: DataSource, folder: str, text: str, policy: SharePolicy
) -> list[MatchOut]:
    needle = unicodedata.normalize("NFC", text).strip().lower()
    query = select(DataSourceEntry).where(DataSourceEntry.source_id == source.id)
    if folder:
        query = query.where(DataSourceEntry.path.startswith(f"{folder}/", autoescape=True))
    matches: list[MatchOut] = []
    for row in (await db.execute(query.order_by(DataSourceEntry.path))).scalars():
        if needle not in row.title.lower() and needle not in row.path.lower():
            continue
        if not policy.shows_entry(row.path, is_dir=False):
            continue
        matches.append(MatchOut(path=row.path, title=row.title))
        if len(matches) >= MAX_CACHED_MATCHES:
            break
    return matches


# -- relaying a request ------------------------------------------------------


def _error(code: str, message: str, status: int, **details) -> AppError:
    return AppError(code=code, message=message, status_code=status, details=details or None)


async def _record(
    db: AsyncSession,
    source: DataSource,
    *,
    op: str,
    path: str | None,
    query: str | None,
    requested_by: str,
    status: str,
    error: str | None = None,
) -> DataSourceQuery:
    now = datetime.now(timezone.utc)
    row = DataSourceQuery(
        source_id=source.id,
        host_id=source.host_id,
        op=op,
        path=path,
        query=query,
        status=status,
        requested_by=requested_by,
        error=error,
        created_at=now,
        completed_at=None if status in {"queued", "claimed"} else now,
    )
    db.add(row)
    await db.flush()
    return row


async def _deny(db, source, *, op, path, query, requested_by, reason: str) -> AppError:
    await _record(
        db, source, op=op, path=path, query=query,
        requested_by=requested_by, status="denied", error=reason,
    )
    await db.commit()
    logger.warning(
        "Refused %s of %r in data source %s for %s: %s",
        op, path, source.id, requested_by, reason,
    )
    return ForbiddenError(
        "That part of the source is not shared.",
        details={"reason": reason},
    )


def _todo_items(path: str, content: str) -> list[DataSourceTodoItem] | None:
    if posixpath.basename(path).lower() != "todo.md":
        return None
    from services.vault.vault_watcher_service import parse_todo_markdown

    return [
        DataSourceTodoItem(
            title=item["title"],
            status=item["status"],
            due_date=item.get("due_date"),
            priority=item.get("priority"),
            tags=item.get("tags") or [],
        )
        for item in parse_todo_markdown(content)
    ]


async def query_source(
    db: AsyncSession,
    source: DataSource,
    *,
    op: str,
    raw_path: str | None,
    text: str | None,
    requested_by: str,
    timeout: float = DEFAULT_ANSWER_TIMEOUT_SECONDS,
) -> DataSourceQueryResponse:
    """Answer one request, from the machine if it can, from the index if not."""
    if op not in _json_list(source.capabilities):
        raise await _deny(
            db, source, op=op, path=raw_path, query=text,
            requested_by=requested_by, reason="operation_not_allowed",
        )
    try:
        path = normalize_path(raw_path)
    except PathDenied as exc:
        raise await _deny(
            db, source, op=op, path=raw_path, query=text,
            requested_by=requested_by, reason=exc.reason,
        ) from exc

    policy = policy_for(source)
    allowed = policy.can_read(path) if op == "read" else policy.can_list(path)
    if op == "read" and not path:
        raise ValidationError("Name the file to read.", details={"reason": "path_required"})
    if op == "search" and not (text or "").strip():
        raise ValidationError("Say what to search for.", details={"reason": "query_required"})
    if not allowed:
        raise await _deny(
            db, source, op=op, path=path, query=text,
            requested_by=requested_by, reason="not_shared",
        )

    if not is_online(source):
        await _record(
            db, source, op=op, path=path, query=text,
            requested_by=requested_by, status="failed", error="source_offline",
        )
        await db.commit()
        return await _fallback(db, source, op, path, text, policy, reason="offline")

    row = await _record(
        db, source, op=op, path=path, query=text,
        requested_by=requested_by, status="queued",
    )
    query_id = row.id
    answered = broker.expect(query_id)
    try:
        await db.commit()
        broker.notify_host(source.host_id)
        try:
            await asyncio.wait_for(answered.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            gave_up = await db.execute(
                update(DataSourceQuery)
                .where(
                    DataSourceQuery.id == query_id,
                    DataSourceQuery.status.in_(("queued", "claimed")),
                )
                .values(
                    status="expired",
                    error="timeout",
                    completed_at=datetime.now(timezone.utc),
                )
            )
            await db.commit()
            if gave_up.rowcount:
                return await _fallback(db, source, op, path, text, policy, reason="timeout")
            # The answer landed between the timeout and the update.
    finally:
        broker.forget(query_id)

    await db.refresh(row)
    return await _collect(db, source, row, policy)


async def _fallback(db, source, op, path, text, policy, *, reason: str) -> DataSourceQueryResponse:
    if op == "read":
        if reason == "offline":
            raise _error(
                "DATA_SOURCE_OFFLINE",
                "The machine that holds this file is offline, and its contents are "
                "never kept anywhere else.",
                503,
                last_seen_at=source.last_seen_at.isoformat() if source.last_seen_at else None,
            )
        raise _error(
            "DATA_SOURCE_TIMEOUT",
            "The machine that holds this file did not answer in time.",
            504,
        )
    response = DataSourceQueryResponse(
        op=op,
        path=path,
        origin="cache",
        fallback_reason=reason,
        is_online=is_online(source),
        last_seen_at=source.last_seen_at,
    )
    if op == "list":
        response.entries = await _cached_listing(db, source, path, policy)
    else:
        response.matches = await _cached_search(db, source, path, text or "", policy)
    return response


async def _collect(
    db: AsyncSession, source: DataSource, row: DataSourceQuery, policy: SharePolicy
) -> DataSourceQueryResponse:
    """Hand the device's answer to the asker and drop it from the server."""
    raw = row.result
    row.result = None
    await db.commit()

    if row.status != "done":
        reason = row.error or "io_error"
        if reason in {"outside_source", "symlink", "not_shared", "hidden_path"}:
            raise ForbiddenError("That part of the source is not shared.", details={"reason": reason})
        if reason == "not_found":
            raise NotFoundError("Nothing exists at that path in the source.")
        raise _error("DATA_SOURCE_FAILED", "The machine could not read that.", 502, reason=reason)

    answer = DataQueryAnswer.model_validate_json(raw or '{"ok": true}')
    response = DataSourceQueryResponse(
        op=row.op,
        path=row.path or "",
        origin="live",
        is_online=True,
        last_seen_at=source.last_seen_at,
        truncated=answer.truncated,
    )
    if row.op == "list":
        prefix = f"{row.path}/" if row.path else ""
        entries: list[EntryOut] = []
        for item in answer.entries:
            try:
                path = normalize_path(item.path)
            except PathDenied:
                continue
            # Only direct children of the folder asked about, and only what
            # is shared: the device is trusted to look, not to decide.
            if not path.startswith(prefix) or "/" in path[len(prefix):]:
                continue
            if not policy.shows_entry(path, is_dir=item.is_dir):
                continue
            name = posixpath.basename(path)
            entries.append(
                EntryOut(
                    path=path,
                    name=name,
                    title=name if item.is_dir else _title_for(path, item.title),
                    is_dir=item.is_dir,
                    size=item.size,
                    modified_at=item.modified_at,
                )
            )
        response.entries = _sorted_entries(entries)
    elif row.op == "search":
        for item in answer.matches:
            try:
                path = normalize_path(item.path)
            except PathDenied:
                continue
            if not policy.shows_entry(path, is_dir=False):
                continue
            response.matches.append(
                MatchOut(
                    path=path,
                    title=_title_for(path, item.title),
                    snippet=item.snippet,
                    line=item.line,
                )
            )
    else:
        content = answer.content or ""
        if len(content) > MAX_CONTENT_CHARS:
            content = content[:MAX_CONTENT_CHARS]
            response.truncated = True
        response.content = content
        response.tasks = _todo_items(row.path or "", content)
    return response


# -- the machine's side -------------------------------------------------------


async def _claim_once(db: AsyncSession, host_id: str) -> DataSourceQuery | None:
    # Requests older than any asker would still wait for are left alone; the
    # asker that queued them has already moved on.
    oldest = datetime.now(timezone.utc) - timedelta(seconds=DEFAULT_ANSWER_TIMEOUT_SECONDS * 2)
    while True:
        candidate = (
            select(DataSourceQuery.id)
            .where(
                DataSourceQuery.host_id == host_id,
                DataSourceQuery.status == "queued",
                DataSourceQuery.created_at >= oldest,
            )
            .order_by(DataSourceQuery.created_at.asc())
            .limit(1)
            .scalar_subquery()
        )
        claimed_id = (
            await db.execute(
                update(DataSourceQuery)
                .where(DataSourceQuery.id == candidate, DataSourceQuery.status == "queued")
                .values(status="claimed", claimed_at=datetime.now(timezone.utc))
                .returning(DataSourceQuery.id)
            )
        ).scalar_one_or_none()
        if claimed_id is None:
            return None
        if broker.is_waiting(claimed_id):
            return await db.get(DataSourceQuery, claimed_id)
        # Queued before a restart: nobody is left to hand the answer to.
        await db.execute(
            update(DataSourceQuery)
            .where(DataSourceQuery.id == claimed_id)
            .values(status="expired", error="asker_gone", completed_at=datetime.now(timezone.utc))
        )


async def _mark_sources_seen(db: AsyncSession, host_id: str) -> None:
    await db.execute(
        update(DataSource)
        .where(DataSource.host_id == host_id)
        .values(last_seen_at=datetime.now(timezone.utc))
    )


async def claim_next_query(
    db: AsyncSession, host: ExecutionHost, *, wait_seconds: float = 0.0
) -> ClaimedDataQuery | None:
    """Hand the machine the oldest request waiting for it.

    With [wait_seconds], hold on until one arrives or the time is up, so a
    request is answered as soon as it is made rather than on the next poll.
    Asking counts as the machine's sources being online.
    """
    wait_seconds = max(0.0, min(wait_seconds, MAX_CLAIM_WAIT_SECONDS))
    loop = asyncio.get_running_loop()
    deadline = loop.time() + wait_seconds
    event = broker.host_event(host.id)
    while True:
        event.clear()
        await _mark_sources_seen(db, host.id)
        row = await _claim_once(db, host.id)
        await db.commit()
        if row is not None:
            source = await db.get(DataSource, row.source_id)
            return ClaimedDataQuery(
                query_id=row.id,
                source_id=row.source_id,
                op=row.op,
                path=row.path or "",
                query=row.query,
                include_folders=_json_list(source.include_folders) if source else [],
                exclude_folders=_json_list(source.exclude_folders) if source else [],
            )
        remaining = deadline - loop.time()
        if remaining <= 0:
            return None
        try:
            await asyncio.wait_for(event.wait(), timeout=remaining)
        except asyncio.TimeoutError:
            await _mark_sources_seen(db, host.id)
            await db.commit()
            return None


async def submit_answer(
    db: AsyncSession, host: ExecutionHost, query_id: str, answer: DataQueryAnswer
) -> bool:
    """Record the machine's answer for the asker; ``False`` if nobody waits."""
    if not broker.is_waiting(query_id):
        await db.execute(
            update(DataSourceQuery)
            .where(
                DataSourceQuery.id == query_id,
                DataSourceQuery.host_id == host.id,
                DataSourceQuery.status == "claimed",
            )
            .values(status="expired", error="asker_gone", completed_at=datetime.now(timezone.utc))
        )
        await db.commit()
        return False
    payload = answer.model_dump_json()
    result = await db.execute(
        update(DataSourceQuery)
        .where(
            DataSourceQuery.id == query_id,
            DataSourceQuery.host_id == host.id,
            DataSourceQuery.status == "claimed",
        )
        .values(
            status="done" if answer.ok else "failed",
            error=None if answer.ok else (answer.error or "io_error"),
            result=payload if answer.ok else None,
            result_bytes=len(payload) if answer.ok else None,
            completed_at=datetime.now(timezone.utc),
        )
    )
    await db.commit()
    if not result.rowcount:
        return False
    if not answer.ok:
        logger.warning(
            "Machine %s refused or failed data query %s: %s", host.id, query_id, answer.error
        )
    broker.answered(query_id)
    return True
