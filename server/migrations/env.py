import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from config import settings
from database import Base
from models import _register_all  # noqa: F401

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

_SQLITE_INLINE_PROJECT_FK_TABLES = {
    "todos",
    "conversations",
    "events",
    "plan_proposals",
}


def _sqlite_include_object(
    object_,
    _name,
    type_,
    _reflected,
    _compare_to,
) -> bool:
    """Ignore one SQLite reflection gap without hiding other schema drift.

    SQLite stores and enforces ON DELETE SET NULL for project_id columns added
    in place. SQLAlchemy's SQLite inspector does not reflect the ON DELETE
    option for an inline FK added through ALTER TABLE, so Alembic otherwise
    reports a remove/add pair forever. Rebuilding these tables would activate
    existing cascades and risk task relationship/history loss.
    """
    if (
        type_ == "check_constraint"
        and _name == "ck_projects_execution_workspace_isolation"
    ):
        # Legacy SQLite projects are extended in place to avoid activating
        # project FK cascades during a table rebuild. ORM validation and fresh
        # databases still enforce the same two-value domain.
        return False
    if type_ != "foreign_key_constraint":
        return True
    table = getattr(object_, "table", None)
    if table is None or table.name not in _SQLITE_INLINE_PROJECT_FK_TABLES:
        return True
    columns = {column.name for column in getattr(object_, "columns", ())}
    return columns != {"project_id"}

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    options = dict(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        render_as_batch=connection.dialect.name == "sqlite",
    )
    if connection.dialect.name == "sqlite":
        options["include_object"] = _sqlite_include_object
    context.configure(**options)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
