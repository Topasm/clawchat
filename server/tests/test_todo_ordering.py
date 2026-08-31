from datetime import datetime, timedelta, timezone

from domain.task import TaskStatus
from models.todo import Todo
from services.tasks import todo_service


async def test_due_date_is_a_supported_todo_order_column(db_session):
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            Todo(id="todo_middle", title="Middle", due_date=now + timedelta(hours=2)),
            Todo(id="todo_latest", title="Latest", due_date=now + timedelta(hours=3)),
            Todo(id="todo_earliest", title="Earliest", due_date=now + timedelta(hours=1)),
        ]
    )
    await db_session.commit()

    rows, total = await todo_service.get_todos(
        db_session,
        status_filter=TaskStatus.PENDING,
        due_before=now + timedelta(days=1),
        order_by="due_date",
        order_dir="desc",
        limit=1000,
    )

    assert total == 3
    assert [todo.id for todo in rows] == [
        "todo_latest",
        "todo_middle",
        "todo_earliest",
    ]
