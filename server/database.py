import json
import os
from datetime import datetime, timezone

from sqlalchemy import event, inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import settings
from domain.plan_proposal import GLOBAL_TASK_GRAPH_SCOPE_ID, PlanProposalStatus
from domain.task import TASK_STATUS_SQL_VALUES, TaskStatus
from domain.task_relationship import TASK_RELATIONSHIP_MIGRATION_MARKER


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    """Make SQLite enforce the same FK cascades as production databases."""
    if "sqlite" not in type(dbapi_connection).__module__:
        return
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, echo=False)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ---------------------------------------------------------------------------
# FTS5 setup: individual DDL statements (triggers contain nested semicolons
# so we store them as a list rather than splitting on ";")
# ---------------------------------------------------------------------------

_FTS5_VIRTUAL_TABLES = [
    "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(id UNINDEXED, content)",
    "CREATE VIRTUAL TABLE IF NOT EXISTS todos_fts USING fts5(id UNINDEXED, title, description)",
    "CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(id UNINDEXED, title, description, location)",
]

_FTS5_TRIGGERS = [
    # -- Messages triggers
    """CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(id, content) VALUES (new.id, new.content);
    END""",
    """CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        DELETE FROM messages_fts WHERE id = old.id;
        INSERT INTO messages_fts(id, content) VALUES (new.id, new.content);
    END""",
    """CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE id = old.id;
    END""",
    # -- Todos triggers
    """CREATE TRIGGER IF NOT EXISTS todos_ai AFTER INSERT ON todos BEGIN
        INSERT INTO todos_fts(id, title, description)
        VALUES (new.id, new.title, COALESCE(new.description, ''));
    END""",
    """CREATE TRIGGER IF NOT EXISTS todos_au AFTER UPDATE ON todos BEGIN
        DELETE FROM todos_fts WHERE id = old.id;
        INSERT INTO todos_fts(id, title, description)
        VALUES (new.id, new.title, COALESCE(new.description, ''));
    END""",
    """CREATE TRIGGER IF NOT EXISTS todos_ad AFTER DELETE ON todos BEGIN
        DELETE FROM todos_fts WHERE id = old.id;
    END""",
    # -- Events triggers
    """CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
        INSERT INTO events_fts(id, title, description, location)
        VALUES (new.id, new.title, COALESCE(new.description, ''), COALESCE(new.location, ''));
    END""",
    """CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
        DELETE FROM events_fts WHERE id = old.id;
        INSERT INTO events_fts(id, title, description, location)
        VALUES (new.id, new.title, COALESCE(new.description, ''), COALESCE(new.location, ''));
    END""",
    """CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
        DELETE FROM events_fts WHERE id = old.id;
    END""",
]

_FTS5_BACKFILL = [
    """INSERT INTO messages_fts(id, content)
        SELECT id, content FROM messages
        WHERE id NOT IN (SELECT id FROM messages_fts)""",
    """INSERT INTO todos_fts(id, title, description)
        SELECT id, title, COALESCE(description, '') FROM todos
        WHERE id NOT IN (SELECT id FROM todos_fts)""",
    """INSERT INTO events_fts(id, title, description, location)
        SELECT id, title, COALESCE(description, ''), COALESCE(location, '') FROM events
        WHERE id NOT IN (SELECT id FROM events_fts)""",
]

_TASK_RELATIONSHIP_CYCLE_TRIGGERS = [
    """
    CREATE TRIGGER IF NOT EXISTS task_relationships_prevent_dependency_cycle_insert
    BEFORE INSERT ON task_relationships
    WHEN NEW.type = 'depends_on'
    BEGIN
        WITH RECURSIVE reachable(task_id) AS (
            SELECT NEW.target_task_id
            UNION
            SELECT relationship.target_task_id
            FROM task_relationships AS relationship
            JOIN reachable
              ON relationship.source_task_id = reachable.task_id
            WHERE relationship.type = 'depends_on'
        )
        SELECT RAISE(ABORT, 'dependency cycle detected')
        WHERE EXISTS (
            SELECT 1 FROM reachable WHERE task_id = NEW.source_task_id
        );
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS task_relationships_prevent_dependency_cycle_update
    BEFORE UPDATE OF source_task_id, target_task_id, type ON task_relationships
    WHEN NEW.type = 'depends_on'
    BEGIN
        WITH RECURSIVE reachable(task_id) AS (
            SELECT NEW.target_task_id
            UNION
            SELECT relationship.target_task_id
            FROM task_relationships AS relationship
            JOIN reachable
              ON relationship.source_task_id = reachable.task_id
            WHERE relationship.type = 'depends_on'
              AND relationship.id <> OLD.id
        )
        SELECT RAISE(ABORT, 'dependency cycle detected')
        WHERE EXISTS (
            SELECT 1 FROM reachable WHERE task_id = NEW.source_task_id
        );
    END
    """,
]

_TASK_GRAPH_TODO_SEMANTIC_COLUMNS = (
    "project_id",
    "title",
    "description",
    "status",
    "priority",
    "due_date",
    "completed_at",
    "conversation_id",
    "message_id",
    "tags",
    "parent_id",
    "sort_order",
    "source",
    "source_id",
    "assignee",
    "enabled_skills",
    "estimated_minutes",
    "clarification_questions",
    "clarification_answers",
    "recurrence_rule",
    "recurrence_end",
    "recurrence_exceptions",
    "recurring_source_id",
)
_TASK_GRAPH_TODO_UPDATE_COLUMNS_SQL = ", ".join(
    _TASK_GRAPH_TODO_SEMANTIC_COLUMNS
)
_TASK_GRAPH_TODO_UPDATE_CHANGED_SQL = " OR ".join(
    f"OLD.{column} IS NOT NEW.{column}"
    for column in _TASK_GRAPH_TODO_SEMANTIC_COLUMNS
)
_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL = f"""
    UPDATE task_graph_states
    SET revision = revision + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE scope_id = '{GLOBAL_TASK_GRAPH_SCOPE_ID}';
"""


def _project_revision_update_sql(project_expression: str) -> str:
    return f"""
        UPDATE projects
        SET graph_revision = graph_revision + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = {project_expression};
    """


def _relationship_project_revision_update_sql(prefix: str) -> str:
    return f"""
        UPDATE projects
        SET graph_revision = graph_revision + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (
            SELECT project_id FROM todos
            WHERE id IN ({prefix}.source_task_id, {prefix}.target_task_id)
              AND project_id IS NOT NULL
        );
    """

_TASK_GRAPH_REVISION_TRIGGERS: list[tuple[str, str]] = [
    (
        "todos",
        f"""
        CREATE TRIGGER IF NOT EXISTS todos_bump_task_graph_revision_insert
        AFTER INSERT ON todos
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            {_project_revision_update_sql("NEW.project_id")}
        END
        """,
    ),
    (
        "todos",
        f"""
        CREATE TRIGGER IF NOT EXISTS todos_bump_task_graph_revision_delete
        AFTER DELETE ON todos
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            {_project_revision_update_sql("OLD.project_id")}
        END
        """,
    ),
    (
        "todos",
        f"""
        CREATE TRIGGER IF NOT EXISTS todos_bump_task_graph_revision_update
        AFTER UPDATE OF {_TASK_GRAPH_TODO_UPDATE_COLUMNS_SQL} ON todos
        WHEN {_TASK_GRAPH_TODO_UPDATE_CHANGED_SQL}
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            UPDATE projects
            SET graph_revision = graph_revision + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN (OLD.project_id, NEW.project_id);
        END
        """,
    ),
    (
        "task_relationships",
        f"""
        CREATE TRIGGER IF NOT EXISTS task_relationships_bump_graph_revision_insert
        AFTER INSERT ON task_relationships
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            {_relationship_project_revision_update_sql("NEW")}
        END
        """,
    ),
    (
        "task_relationships",
        f"""
        CREATE TRIGGER IF NOT EXISTS task_relationships_bump_graph_revision_update
        AFTER UPDATE ON task_relationships
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            UPDATE projects
            SET graph_revision = graph_revision + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id IN (
                SELECT project_id FROM todos
                WHERE id IN (
                    OLD.source_task_id, OLD.target_task_id,
                    NEW.source_task_id, NEW.target_task_id
                )
                  AND project_id IS NOT NULL
            );
        END
        """,
    ),
    (
        "task_relationships",
        f"""
        CREATE TRIGGER IF NOT EXISTS task_relationships_bump_graph_revision_delete
        AFTER DELETE ON task_relationships
        BEGIN
            {_GLOBAL_TASK_GRAPH_REVISION_UPDATE_SQL}
            {_relationship_project_revision_update_sql("OLD")}
        END
        """,
    ),
]


def _install_task_graph_state_sync(connection) -> None:
    """Seed the global graph state and install SQLite revision triggers."""
    inspector = inspect(connection)
    if not inspector.has_table("task_graph_states"):
        return

    seed_params = {"scope_id": GLOBAL_TASK_GRAPH_SCOPE_ID}
    if connection.dialect.name == "sqlite":
        connection.execute(
            text(
                "INSERT OR IGNORE INTO task_graph_states "
                "(scope_id, revision, updated_at) "
                "VALUES (:scope_id, 0, CURRENT_TIMESTAMP)"
            ),
            seed_params,
        )
    elif connection.dialect.name == "postgresql":
        connection.execute(
            text(
                "INSERT INTO task_graph_states "
                "(scope_id, revision, updated_at) "
                "VALUES (:scope_id, 0, CURRENT_TIMESTAMP) "
                "ON CONFLICT (scope_id) DO NOTHING"
            ),
            seed_params,
        )
    else:
        exists = connection.execute(
            text(
                "SELECT 1 FROM task_graph_states "
                "WHERE scope_id = :scope_id"
            ),
            seed_params,
        ).scalar_one_or_none()
        if exists is None:
            connection.execute(
                text(
                    "INSERT INTO task_graph_states "
                    "(scope_id, revision, updated_at) "
                    "VALUES (:scope_id, 0, CURRENT_TIMESTAMP)"
                ),
                seed_params,
            )

    if connection.dialect.name != "sqlite":
        return

    # ``create_all`` also runs against legacy databases before
    # ``_apply_schema_corrections`` has added every modern Todo column.  A
    # trigger that refers to a missing ``OLD.<column>``/``NEW.<column>`` makes
    # SQLite reject startup, so defer all Todo triggers until the complete
    # semantic column set is present.  ``_setup_task_graph_revision`` retries
    # installation after the corrections have run.
    todo_columns: set[str] = set()
    if inspector.has_table("todos"):
        todo_columns = {
            column["name"] for column in inspector.get_columns("todos")
        }
    todo_triggers_are_safe = (
        inspector.has_table("projects")
        and set(_TASK_GRAPH_TODO_SEMANTIC_COLUMNS).issubset(todo_columns)
    )
    for target_table, statement in _TASK_GRAPH_REVISION_TRIGGERS:
        if not inspector.has_table(target_table):
            continue
        if not todo_triggers_are_safe:
            continue
        connection.execute(text(statement))


@event.listens_for(Base.metadata, "after_create")
def _install_task_graph_state_after_create(
    _metadata,
    connection,
    **_kwargs,
) -> None:
    """Keep direct ``Base.metadata.create_all`` test/bootstrap paths safe."""
    _install_task_graph_state_sync(connection)


# ---------------------------------------------------------------------------
# Database initialization helpers
# ---------------------------------------------------------------------------

def _ensure_data_dir():
    """Create the data and upload directories if they don't exist."""
    db_path = settings.database_url.split("///")[-1]
    db_dir = os.path.dirname(db_path)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

    from config import settings as app_settings
    os.makedirs(app_settings.upload_dir, exist_ok=True)


async def _apply_schema_corrections(session: AsyncSession):
    """Add columns that may be missing from older schemas.

    Each statement is idempotent -- duplicate column errors are silently ignored.
    Grouped by table for readability.
    """
    corrections = [
        # -- todos --
        "ALTER TABLE todos ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL",
        "ALTER TABLE todos ADD COLUMN parent_id TEXT REFERENCES todos(id) ON DELETE SET NULL",
        "ALTER TABLE todos ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE todos ADD COLUMN source TEXT",
        "ALTER TABLE todos ADD COLUMN source_id TEXT",
        "ALTER TABLE todos ADD COLUMN assignee TEXT",
        "ALTER TABLE todos ADD COLUMN inbox_state TEXT NOT NULL DEFAULT 'none'",
        "ALTER TABLE todos ADD COLUMN estimated_minutes INTEGER",
        "ALTER TABLE todos ADD COLUMN automation_error TEXT",
        "ALTER TABLE todos ADD COLUMN enabled_skills TEXT",
        "ALTER TABLE todos ADD COLUMN clarification_questions TEXT",
        "ALTER TABLE todos ADD COLUMN clarification_answers TEXT",
        "ALTER TABLE todos ADD COLUMN depends_on TEXT",
        "ALTER TABLE todos ADD COLUMN recurrence_rule TEXT",
        "ALTER TABLE todos ADD COLUMN recurrence_end DATETIME",
        "ALTER TABLE todos ADD COLUMN recurrence_exceptions TEXT",
        "ALTER TABLE todos ADD COLUMN recurring_source_id TEXT REFERENCES todos(id) ON DELETE SET NULL",

        # -- conversations --
        "ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL",
        "ALTER TABLE conversations ADD COLUMN project_todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL",

        # -- events --
        "ALTER TABLE events ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL",

        # -- plan proposals --
        "ALTER TABLE plan_proposals ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL",

        # -- agent_tasks --
        "ALTER TABLE agent_tasks ADD COLUMN todo_id TEXT REFERENCES todos(id) ON DELETE SET NULL",
        "ALTER TABLE agent_tasks ADD COLUMN payload_json TEXT",
        "ALTER TABLE agent_tasks ADD COLUMN skill_chain TEXT",
        "ALTER TABLE agent_tasks ADD COLUMN current_skill_index INTEGER NOT NULL DEFAULT 0",

        # -- projects / agent_runs (Paseo execution metadata) --
        "ALTER TABLE projects ADD COLUMN default_execution_model TEXT",
        "ALTER TABLE projects ADD COLUMN execution_workspace_path TEXT",
        "ALTER TABLE projects ADD COLUMN execution_workspace_isolation TEXT NOT NULL DEFAULT 'local'",
        "ALTER TABLE projects ADD COLUMN execution_base_branch TEXT",
        "ALTER TABLE agent_runs ADD COLUMN external_run_id TEXT",

        # -- paired_devices --
        "ALTER TABLE paired_devices ADD COLUMN public_key TEXT",

        # -- messages --
        "ALTER TABLE messages ADD COLUMN idempotency_key TEXT",
        # Partial so the pre-existing NULL-keyed rows do not collide.
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_conversation_idempotency_key "
        "ON messages (conversation_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
    ]

    for stmt in corrections:
        try:
            await session.execute(text(stmt))
        except (OperationalError, Exception):
            pass  # column already exists
    for stmt in (
        "CREATE INDEX IF NOT EXISTS idx_todos_project_id ON todos(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_plan_proposals_project_status ON plan_proposals(project_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_agent_runs_external_run_id ON agent_runs(external_run_id)",
    ):
        try:
            await session.execute(text(stmt))
        except OperationalError:
            pass
    await session.commit()


async def _run_data_migrations(
    session: AsyncSession,
    *,
    relationship_table_existed: bool = True,
):
    """Run idempotent transforms and reconcile normalized dependency state.

    The relationship marker is committed in the same transaction as the
    legacy import.  This makes an interrupted first startup retryable even
    after ``create_all`` has already created the normalized table.  Once the
    marker exists, normalized rows are authoritative and only the legacy JSON
    shadow is reconciled.
    """
    migrations = [
        (
            f"UPDATE todos SET status = '{TaskStatus.PENDING.value}', completed_at = NULL "
            f"WHERE status IS NULL OR status NOT IN ({TASK_STATUS_SQL_VALUES})"
        ),
        "UPDATE todos SET enabled_skills = '[\"plan\"]' WHERE assignee = 'planner' AND enabled_skills IS NULL",
        "UPDATE todos SET enabled_skills = '[\"research\"]' WHERE assignee = 'researcher' AND enabled_skills IS NULL",
        "UPDATE todos SET enabled_skills = '[\"obsidian_sync\"]' WHERE assignee = 'executor' AND enabled_skills IS NULL",
    ]

    for stmt in migrations:
        try:
            await session.execute(text(stmt))
        except OperationalError:
            pass

    from models.data_migration_marker import DataMigrationMarker
    from services.task_relationship_service import (
        backfill_legacy_dependencies,
        reconcile_dependency_shadows,
    )

    marker = await session.get(
        DataMigrationMarker,
        TASK_RELATIONSHIP_MIGRATION_MARKER,
    )
    if marker is None:
        await backfill_legacy_dependencies(session)
        session.add(
            DataMigrationMarker(name=TASK_RELATIONSHIP_MIGRATION_MARKER)
        )
    else:
        if not relationship_table_existed:
            raise RuntimeError(
                "Task relationship migration marker exists but the "
                "task_relationships table was missing; refusing to overwrite "
                "legacy dependency data"
            )
        await reconcile_dependency_shadows(session)
    await _backfill_legacy_plan_proposals(session)
    await _backfill_first_class_projects(session)
    await _backfill_review_items(session)
    await _backfill_agent_runs(session)
    from services.agent_run_service import reconcile_interrupted_runs

    await reconcile_interrupted_runs(session)
    await session.commit()


async def _backfill_first_class_projects(session: AsyncSession) -> None:
    """Promote legacy root-Todo workspaces without changing task identity."""
    from collections import defaultdict, deque

    from models.conversation import Conversation
    from models.event import Event
    from models.plan_proposal import PlanProposal
    from models.project import Project
    from models.task_graph_state import TaskGraphState
    from models.todo import Todo
    from utils import make_id

    todos = list((await session.execute(select(Todo))).scalars().all())
    if not todos:
        return
    children: dict[str, list[Todo]] = defaultdict(list)
    for todo in todos:
        if todo.parent_id is not None:
            children[todo.parent_id].append(todo)

    conversations = list(
        (await session.execute(select(Conversation))).scalars().all()
    )
    linked_root_ids = {
        conversation.project_todo_id
        for conversation in conversations
        if conversation.project_todo_id is not None
    }
    projects = list((await session.execute(select(Project))).scalars().all())
    project_by_root_id = {
        project.root_task_id: project
        for project in projects
        if project.root_task_id is not None
    }
    global_state = await session.get(TaskGraphState, GLOBAL_TASK_GRAPH_SCOPE_ID)
    initial_revision = global_state.revision if global_state is not None else 0

    for root in sorted(todos, key=lambda item: (item.created_at, item.id)):
        if root.parent_id is not None:
            continue
        qualifies = bool(children.get(root.id)) or root.id in linked_root_ids or bool(root.source)
        if not qualifies:
            continue
        project = project_by_root_id.get(root.id)
        if project is None:
            project = Project(
                id=make_id("project_"),
                title=root.title,
                description=root.description,
                status=(
                    "completed"
                    if root.status == TaskStatus.COMPLETED
                    else "active"
                ),
                deadline=root.due_date,
                root_task_id=root.id,
                graph_revision=initial_revision,
                created_at=root.created_at,
                updated_at=root.updated_at,
            )
            session.add(project)
            project_by_root_id[root.id] = project

        queue = deque([root])
        while queue:
            todo = queue.popleft()
            if todo.project_id is None:
                todo.project_id = project.id
            queue.extend(children.get(todo.id, ()))

    await session.flush()
    project_by_root_id = {
        project.root_task_id: project
        for project in (await session.execute(select(Project))).scalars().all()
        if project.root_task_id is not None
    }
    for conversation in conversations:
        if conversation.project_id is None and conversation.project_todo_id is not None:
            project = project_by_root_id.get(conversation.project_todo_id)
            if project is not None:
                conversation.project_id = project.id

    await session.flush()
    conversation_projects = {
        conversation.id: conversation.project_id
        for conversation in conversations
        if conversation.project_id is not None
    }
    events = list((await session.execute(select(Event))).scalars().all())
    for event_row in events:
        if event_row.project_id is None and event_row.conversation_id is not None:
            event_row.project_id = conversation_projects.get(event_row.conversation_id)

    proposals = list(
        (await session.execute(select(PlanProposal))).scalars().all()
    )
    todo_projects = {todo.id: todo.project_id for todo in todos}
    for proposal in proposals:
        if proposal.project_id is None and proposal.root_task_id is not None:
            proposal.project_id = todo_projects.get(proposal.root_task_id)


async def _backfill_review_items(session: AsyncSession) -> None:
    """Mirror the Alembic plan-review backfill for legacy startup upgrades."""
    from domain.review import ReviewRiskLevel, ReviewStatus, ReviewSubjectType
    from models.plan_proposal import PlanProposal
    from models.review_item import ReviewItem
    from utils import make_id

    existing_subject_ids = set(
        (
            await session.execute(
                select(ReviewItem.subject_id).where(
                    ReviewItem.subject_type == ReviewSubjectType.PLAN_PROPOSAL
                )
            )
        ).scalars().all()
    )
    proposals = list(
        (
            await session.execute(
                select(PlanProposal).where(
                    PlanProposal.status.notin_([
                        PlanProposalStatus.GENERATING,
                        PlanProposalStatus.FAILED,
                    ])
                )
            )
        ).scalars().all()
    )
    status_map = {
        PlanProposalStatus.DRAFT: ReviewStatus.PENDING,
        PlanProposalStatus.APPLYING: ReviewStatus.PENDING,
        PlanProposalStatus.APPLIED: ReviewStatus.APPROVED,
        PlanProposalStatus.REJECTED: ReviewStatus.REJECTED,
        PlanProposalStatus.STALE: ReviewStatus.EXPIRED,
        PlanProposalStatus.REVERTED: ReviewStatus.APPROVED,
    }
    for proposal in proposals:
        if proposal.id in existing_subject_ids:
            continue
        status = status_map[PlanProposalStatus(proposal.status)]
        reviewed_at = (
            None
            if status == ReviewStatus.PENDING
            else proposal.updated_at or datetime.now(timezone.utc)
        )
        session.add(
            ReviewItem(
                id=make_id("review_"),
                project_id=proposal.project_id,
                subject_type=ReviewSubjectType.PLAN_PROPOSAL,
                subject_id=proposal.id,
                status=status,
                summary="Review AI task plan",
                risk_level=ReviewRiskLevel.MEDIUM,
                requested_at=proposal.created_at,
                reviewed_at=reviewed_at,
                created_at=proposal.created_at,
                updated_at=proposal.updated_at,
            )
        )


async def _backfill_agent_runs(session: AsyncSession) -> None:
    """Create one durable historical attempt for legacy AgentTask rows."""
    from models.agent_run import AgentRun, AgentRunEvent
    from models.agent_task import AgentTask
    from models.conversation import Conversation
    from models.todo import Todo
    from utils import make_id

    existing_task_ids = set(
        (await session.execute(select(AgentRun.agent_task_id))).scalars().all()
    )
    tasks = list((await session.execute(select(AgentTask))).scalars().all())
    todo_projects = dict(
        (await session.execute(select(Todo.id, Todo.project_id))).all()
    )
    conversation_projects = dict(
        (await session.execute(select(Conversation.id, Conversation.project_id))).all()
    )
    now = datetime.now(timezone.utc)
    for task in tasks:
        if task.id in existing_task_ids:
            continue
        if task.status == "completed":
            status = "completed"
            adopted = True
            error = task.error
        elif task.status in ("failed", "cancelled"):
            status = task.status
            adopted = False
            error = task.error
        else:
            status = "failed"
            adopted = False
            error = "Legacy execution was interrupted; retry is available"
            task.status = "failed"
            task.error = error
            task.completed_at = now
        result = task.result or task.payload_json
        completed_at = task.completed_at or now
        run = AgentRun(
            id=make_id("run_"),
            agent_task_id=task.id,
            project_id=(
                todo_projects.get(task.todo_id)
                or conversation_projects.get(task.conversation_id)
            ),
            attempt=1,
            instruction_snapshot=task.instruction,
            provider="legacy",
            status=status,
            progress=100 if status == "completed" else task.progress,
            progress_message=task.progress_message,
            result=result,
            result_summary=result[:500] if result else None,
            error=error,
            is_adopted=adopted,
            created_at=task.created_at,
            started_at=task.started_at,
            heartbeat_at=task.completed_at or task.started_at,
            completed_at=completed_at,
            updated_at=completed_at,
        )
        session.add(run)
        session.add(
            AgentRunEvent(
                id=make_id("run_event_"),
                run_id=run.id,
                sequence=1,
                event_type="migrated",
                message="Imported from legacy AgentTask state",
                progress=run.progress,
                created_at=completed_at,
            )
        )


async def _backfill_legacy_plan_proposals(session: AsyncSession) -> None:
    """Retain completed legacy planner runs on compatibility-only upgrades.

    Packaged and older self-hosted installations historically upgraded through
    ``init_db`` rather than Alembic.  ``create_all`` creates the PR3 tables for
    those databases, so this idempotent transform must mirror the Alembic
    backfill instead of making existing plan history disappear from the API.
    Imported history never receives a fabricated graph revision or undo log.
    """
    from models.agent_task import AgentTask
    from models.plan_proposal import PlanProposal
    from models.task_relationship import TaskRelationship

    existing_proposals = list(
        (await session.execute(select(PlanProposal))).scalars().all()
    )
    proposal_by_id = {proposal.id: proposal for proposal in existing_proposals}
    proposal_by_agent_task_id = {
        proposal.agent_task_id: proposal
        for proposal in existing_proposals
        if proposal.agent_task_id is not None
    }
    legacy_tasks = list(
        (
            await session.execute(
                select(AgentTask)
                .where(
                    AgentTask.task_type == "plan_todo",
                    AgentTask.status == "completed",
                )
                .order_by(AgentTask.created_at, AgentTask.id)
            )
        ).scalars().all()
    )
    eligible_agent_task_ids = {task.id for task in legacy_tasks}
    referenced_ids = set(
        (
            await session.execute(
                select(TaskRelationship.proposal_id).where(
                    TaskRelationship.proposal_id.is_not(None)
                )
            )
        ).scalars().all()
    )
    invalid_references = sorted(
        referenced_ids
        - eligible_agent_task_ids
        - set(proposal_by_id)
    )
    if invalid_references:
        raise RuntimeError(
            "Cannot migrate task relationship proposal references that do not "
            "point to completed plan_todo agent tasks or existing proposals: "
            + ", ".join(invalid_references)
        )

    now = datetime.now(timezone.utc)
    for task in legacy_tasks:
        existing_for_task = proposal_by_agent_task_id.get(task.id)
        existing_for_id = proposal_by_id.get(task.id)
        if existing_for_task is not None:
            continue
        if existing_for_id is not None:
            raise RuntimeError(
                "Cannot retain legacy plan history because proposal ID "
                f"{task.id} is already owned by another agent task"
            )

        parse_error: str | None = None
        try:
            payload = json.loads(task.payload_json) if task.payload_json else None
            if not isinstance(payload, dict):
                raise TypeError("payload_json must contain a JSON object")
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            parse_error = str(exc)

        if parse_error is not None:
            status = PlanProposalStatus.FAILED
        elif task.id in referenced_ids:
            status = PlanProposalStatus.APPLIED
        else:
            status = PlanProposalStatus.STALE
        validation_detail: dict[str, object] = {
            "legacy": True,
            "source": "agent_tasks",
            "base_graph_revision_available": False,
        }
        if parse_error is not None:
            validation_detail["error"] = parse_error
        elif status == PlanProposalStatus.APPLIED:
            validation_detail["reason"] = (
                "relationship_reference_without_change_set"
            )
        else:
            validation_detail["reason"] = (
                "legacy_proposal_requires_regeneration"
            )

        created_at = task.created_at or now
        completed_at = task.completed_at or created_at
        proposal = PlanProposal(
            id=task.id,
            root_task_id=task.todo_id,
            agent_task_id=task.id,
            base_graph_revision=None,
            prompt_version="legacy-agent-task-v1",
            payload_json=task.payload_json,
            validation_json=json.dumps(
                validation_detail,
                ensure_ascii=False,
                sort_keys=True,
            ),
            status=status,
            is_revertible=False,
            created_at=created_at,
            updated_at=completed_at,
            applied_at=(
                completed_at if status == PlanProposalStatus.APPLIED else None
            ),
        )
        session.add(proposal)
        proposal_by_id[proposal.id] = proposal
        proposal_by_agent_task_id[task.id] = proposal


async def _setup_task_relationship_integrity(session: AsyncSession) -> None:
    """Install SQLite triggers that atomically reject dependency cycles."""
    bind = session.get_bind()
    if bind.dialect.name != "sqlite":
        return
    for statement in _TASK_RELATIONSHIP_CYCLE_TRIGGERS:
        await session.execute(text(statement))
    await session.commit()


async def _setup_task_graph_revision(session: AsyncSession) -> None:
    """Ensure the global revision row and SQLite trigger parity at startup."""
    async_connection = await session.connection()
    await async_connection.run_sync(_install_task_graph_state_sync)
    await session.commit()


async def _setup_fts(session: AsyncSession):
    """Create FTS5 virtual tables, sync triggers, and backfill missing rows."""
    for stmt in _FTS5_VIRTUAL_TABLES:
        await session.execute(text(stmt))
    for stmt in _FTS5_TRIGGERS:
        await session.execute(text(stmt))
    for stmt in _FTS5_BACKFILL:
        await session.execute(text(stmt))
    await session.commit()


async def init_db():
    """Initialize database: create tables, apply corrections, setup FTS."""
    _ensure_data_dir()

    async with engine.begin() as conn:
        from models import _register_all  # noqa: F401

        relationship_table_existed = await conn.run_sync(
            lambda sync_conn: inspect(sync_conn).has_table("task_relationships")
        )
        marker_table_existed = await conn.run_sync(
            lambda sync_conn: inspect(sync_conn).has_table(
                "data_migration_markers"
            )
        )
        relationship_marker_exists = False
        if marker_table_existed:
            relationship_marker_exists = (
                await conn.execute(
                    text(
                        "SELECT 1 FROM data_migration_markers "
                        "WHERE name = :name"
                    ),
                    {"name": TASK_RELATIONSHIP_MIGRATION_MARKER},
                )
            ).scalar_one_or_none() is not None
        if relationship_marker_exists and not relationship_table_existed:
            raise RuntimeError(
                "Task relationship migration marker exists but the "
                "task_relationships table is missing; refusing to recreate "
                "an empty table over legacy dependency data"
            )
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSession(engine) as session:
        await _apply_schema_corrections(session)
        await _setup_task_relationship_integrity(session)
        await _run_data_migrations(
            session,
            relationship_table_existed=relationship_table_existed,
        )
        await _setup_task_graph_revision(session)
        await _setup_fts(session)


async def get_db():
    async with async_session_factory() as session:
        yield session
