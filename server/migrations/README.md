# Database migrations

The baseline revision mirrors the current SQLAlchemy metadata. CI upgrades a
fresh SQLite database and runs `alembic check` so model changes cannot drift
from the revision history unnoticed.

```bash
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "describe the schema change"
uv run alembic check
```

`database.init_db` still performs the legacy idempotent bootstrap for existing
self-hosted and bundled installations. Keep that compatibility path until a
dedicated migration bootstrap has stamped deployed databases at this baseline.
