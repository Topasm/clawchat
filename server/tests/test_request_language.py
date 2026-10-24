"""Text the server writes for the reader follows the client's language."""

from unittest.mock import AsyncMock

import pytest
from starlette.requests import Request

from services.notifications import briefing_service
from services.planning.plan_proposal_service import plan_instruction
from utils.request_language import request_language


def _request(accept_language: str | None) -> Request:
    headers = []
    if accept_language is not None:
        headers.append((b"accept-language", accept_language.encode()))
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers})


def test_request_language_reads_the_first_tag():
    assert request_language(_request("ko")) == "ko"
    assert request_language(_request("ko-KR,ko;q=0.9,en;q=0.8")) == "ko"
    assert request_language(_request("en-US,en;q=0.9,ko;q=0.5")) == "en"
    assert request_language(_request(None)) == "en"


def test_plan_instruction_follows_the_language():
    assert plan_instruction("GPU homework", "en") == "Plan subtasks for: GPU homework"
    assert plan_instruction("GPU 숙제", "ko") == "하위 단계 계획: GPU 숙제"
    assert plan_instruction("x", "fr") == "Plan subtasks for: x"


def test_briefing_prompt_asks_for_the_readers_language():
    english = briefing_service.briefing_system_prompt("en")
    korean = briefing_service.briefing_system_prompt("ko")
    assert "in English" in english
    assert "한국어" in korean
    assert korean.startswith(briefing_service._BRIEFING_SYSTEM_PROMPT)


@pytest.mark.asyncio
async def test_clear_day_is_told_in_korean(db_session):
    ai_service = AsyncMock()
    result = await briefing_service.generate_briefing(
        db_session, ai_service, language="ko"
    )
    assert result["summary"].startswith("오늘은 일정이 비어 있어요")
    assert result["load_message"] == "오늘 예정된 일이 없어요."
    ai_service.generate_completion.assert_not_called()


@pytest.mark.asyncio
async def test_briefing_route_passes_the_header_language(client, auth_headers):
    response = await client.get(
        "/api/today/briefing",
        headers={**auth_headers, "Accept-Language": "ko-KR"},
    )
    assert response.status_code == 200
    assert response.json()["summary"].startswith("오늘은")
