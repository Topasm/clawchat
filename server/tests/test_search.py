"""Full-text search across messages, todos, and events."""


import pytest
import pytest_asyncio
from sqlalchemy import text

from database import _setup_fts, rebuild_fts
from domain.task import TaskStatus
from models.todo import Todo
from services import search_service
from services.search_service import _to_fts_expression
from utils import make_id


@pytest_asyncio.fixture
async def fts(db_session):
    """create_all does not build the FTS5 virtual tables or their triggers."""
    await _setup_fts(db_session)
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


async def test_a_message_hit_names_its_conversation(fts):
    from models.conversation import Conversation
    from models.message import Message

    conversation = Conversation(id="conv_search", title="Trip planning")
    fts.add(conversation)
    await fts.flush()
    fts.add(Message(conversation_id=conversation.id, role="user", content="Book the ferry to Jeju"))
    await fts.commit()

    hits, _total = await search_service.search(fts, "ferry")

    assert [(hit.type, hit.conversation_id) for hit in hits] == [("message", "conv_search")]


# --- keeping the index in step --------------------------------------------


async def _todo_titles(db, query: str) -> list[str]:
    hits, _total = await search_service.search(db, query, types=["todos"])
    return sorted(hit.title for hit in hits)


async def _fts_rows(db, table: str) -> int:
    return (await db.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()


async def test_a_renamed_todo_is_found_by_its_new_title_only(fts):
    todo = await _todo(fts, "Buy oat milk")

    todo.title = "Buy rye bread"
    await fts.commit()

    assert await _todo_titles(fts, "milk") == []
    assert await _todo_titles(fts, "bread") == ["Buy rye bread"]
    assert await _fts_rows(fts, "todos_fts") == 1


async def test_a_deleted_todo_leaves_the_index(fts):
    todo = await _todo(fts, "Buy oat milk")

    await fts.delete(todo)
    await fts.commit()

    assert await _todo_titles(fts, "milk") == []
    assert await _fts_rows(fts, "todos_fts") == 0


async def test_a_reused_rowid_does_not_block_the_next_insert(fts):
    """SQLite hands the rowid of a deleted last row to the next insert."""
    await _todo(fts, "Walk the dog")
    last = await _todo(fts, "Buy oat milk")
    rowid = (
        await fts.execute(text("SELECT rowid FROM todos WHERE id = :id"), {"id": last.id})
    ).scalar_one()
    await fts.execute(text("DELETE FROM todos WHERE id = :id"), {"id": last.id})
    # Leave a stale entry behind the way an untriggered delete would.
    await fts.execute(
        text(
            "INSERT INTO todos_fts(rowid, id, title, description) "
            "VALUES (:rowid, 'gone', 'ghost', '')"
        ),
        {"rowid": rowid},
    )
    await fts.commit()

    bread = await _todo(fts, "Buy rye bread")

    assert (
        await fts.execute(text("SELECT rowid FROM todos WHERE id = :id"), {"id": bread.id})
    ).scalar_one() == rowid

    assert await _todo_titles(fts, "bread") == ["Buy rye bread"]
    assert await _todo_titles(fts, "ghost") == []


async def test_only_searchable_columns_rewrite_the_index(fts):
    triggers = dict(
        (
            await fts.execute(
                text("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_fts_au'")
            )
        ).all()
    )

    assert "AFTER UPDATE OF title, description ON todos" in triggers["todos_fts_au"]
    assert "AFTER UPDATE OF title, description, location ON events" in triggers["events_fts_au"]
    assert "AFTER UPDATE OF content ON messages" in triggers["messages_fts_au"]


async def test_startup_rebuilds_an_index_whose_rowids_drifted(fts):
    """A dump or VACUUM may renumber source rowids under the index."""
    await _todo(fts, "Buy oat milk")
    await _todo(fts, "Walk the dog")
    await fts.execute(text("UPDATE todos_fts SET rowid = rowid + 100"))
    await fts.commit()

    await _setup_fts(fts)

    paired = (
        await fts.execute(
            text("SELECT count(*) FROM todos_fts f JOIN todos t ON t.rowid = f.rowid AND t.id = f.id")
        )
    ).scalar_one()
    assert paired == 2
    assert await _todo_titles(fts, "milk") == ["Buy oat milk"]


async def test_startup_replaces_the_legacy_id_keyed_index(fts):
    await _todo(fts, "Buy oat milk")
    for statement in (
        "DROP TABLE todos_fts",
        "CREATE VIRTUAL TABLE todos_fts USING fts5(id UNINDEXED, title, description)",
        "INSERT INTO todos_fts(id, title, description) VALUES ('stale', 'Buy oat milk', '')",
        "CREATE TRIGGER todos_au AFTER UPDATE ON todos BEGIN DELETE FROM todos_fts WHERE id = old.id; END",
    ):
        await fts.execute(text(statement))
    await fts.commit()

    await _setup_fts(fts)

    legacy = (
        await fts.execute(text("SELECT count(*) FROM sqlite_master WHERE name = 'todos_au'"))
    ).scalar_one()
    assert legacy == 0
    hits, total = await search_service.search(fts, "milk", types=["todos"])
    assert total == 1
    assert hits[0].title == "Buy oat milk"


async def test_reindex_refills_every_index(fts):
    await _todo(fts, "Buy oat milk")
    await fts.execute(text("DELETE FROM todos_fts"))
    await fts.commit()

    assert await rebuild_fts(fts) == ["messages_fts", "todos_fts", "events_fts"]
    assert await _todo_titles(fts, "milk") == ["Buy oat milk"]
