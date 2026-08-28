"""Full-text search across messages, todos, and events."""

from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text

from database import _FTS5_TRIGGERS, _FTS5_VIRTUAL_TABLES
from domain.task import TaskStatus
from models.todo import Todo
from services import search_service
from services.search_service import _to_fts_expression
from utils import make_id


@pytest_asyncio.fixture
async def fts(db_session):
    """create_all does not build the FTS5 virtual tables or their triggers."""
    for statement in _FTS5_VIRTUAL_TABLES + _FTS5_TRIGGERS:
        await db_session.execute(text(statement))
    await db_session.commit()
    yield db_session


# --- query sanitisation ---------------------------------------------------


def test_tokens_are_quoted_as_literals():
    assert _to_fts_expression("buy milk") == '"buy" "milk"'


def test_embedded_quotes_are_escaped():
    """A raw quote closed the FTS string early and made SQLite reject the
    whole expression, so any search containing one returned a 500."""
    assert _to_fts_expression('say"hi') == '"say""hi"'


def test_blank_query_produces_no_expression():
    assert _to_fts_expression("   ") == ""


@pytest.mark.parametrize(
    "query",
    ['say"hi', '"quoted"', 'a "b c', "AND", "OR", "NOT", "*", "^token", "col:value"],
)
def test_operators_and_punctuation_stay_valid_expressions(query, fts):
    """Every one of these is FTS5 syntax if left unquoted."""
    import sqlite3

    connection = sqlite3.connect(":memory:")
    connection.execute("CREATE VIRTUAL TABLE t USING fts5(content)")
    connection.execute("INSERT INTO t VALUES ('hello world')")

    expression = _to_fts_expression(query)
    if expression:
        connection.execute("SELECT * FROM t WHERE t MATCH ?", (expression,)).fetchall()


# --- searching ------------------------------------------------------------


async def _todo(db, title: str, description: str | None = None) -> Todo:
    todo = Todo(
        id=make_id("todo_"),
        title=title,
        description=description,
        status=TaskStatus.PENDING,
        priority="medium",
    )
    db.add(todo)
    await db.commit()
    return todo


async def test_finds_a_todo_by_title(fts):
    await _todo(fts, "Buy oat milk")

    hits, total = await search_service.search(fts, "milk")

    assert total == 1
    assert hits[0].type == "todo"
    assert hits[0].title == "Buy oat milk"


async def test_a_quote_in_the_query_no_longer_errors(fts):
    """This used to raise OperationalError("unterminated string") and surface
    as a 500. FTS5 strips the punctuation, so the term still matches."""
    await _todo(fts, "Buy oat milk")

    hits, total = await search_service.search(fts, 'milk"')

    assert total == 1
    assert hits[0].title == "Buy oat milk"


async def test_blank_query_returns_nothing(fts):
    await _todo(fts, "Buy oat milk")

    assert await search_service.search(fts, "   ") == ([], 0)


async def test_type_filter_excludes_other_kinds(fts):
    await _todo(fts, "Buy oat milk")

    hits, total = await search_service.search(fts, "milk", types=["events"])

    assert (hits, total) == ([], 0)


async def test_pagination_windows_the_results(fts):
    for index in range(5):
        await _todo(fts, f"milk run {index}")

    page_one, total = await search_service.search(fts, "milk", limit=2, page=1)
    page_two, _ = await search_service.search(fts, "milk", limit=2, page=2)

    assert total == 5
    assert len(page_one) == 2
    assert len(page_two) == 2
    assert {h.id for h in page_one}.isdisjoint({h.id for h in page_two})


async def test_description_is_previewed_when_present(fts):
    await _todo(fts, "Groceries", description="Remember the oat milk")

    hits, _ = await search_service.search(fts, "milk")

    assert hits[0].preview == "Remember the oat milk"
