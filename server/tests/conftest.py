import asyncio
import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Override settings before any app code imports config
os.environ.update({
    "DATABASE_URL": "sqlite+aiosqlite:///:memory:",
    "JWT_SECRET": "test-secret-key-for-tests",
    "PIN": "123456",
    "AI_PROVIDER": "ollama",
    "AI_BASE_URL": "http://localhost:11434",
    "AI_MODEL": "test-model",
    "ENABLE_SCHEDULER": "false",
    "DEBUG": "false",
})

from database import Base, get_db  # noqa: E402
from main import app  # noqa: E402

_test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
_test_session_factory = async_sessionmaker(_test_engine, class_=AsyncSession, expire_on_commit=False)


async def _override_get_db():
    async with _test_session_factory() as session:
        yield session


app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """Create all tables before each test and drop after."""
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def auth_headers(client: AsyncClient):
    """Login and return headers with a valid access token."""
    resp = await client.post("/api/auth/login", json={"pin": "123456"})
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def db_session():
    async with _test_session_factory() as session:
        yield session
