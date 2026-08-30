import json

import httpx
import pytest

from exceptions import AIUnavailableError
from services.ai.codex_api_provider import CodexAPIProvider, CodexAPIStatus


def _provider(client: httpx.AsyncClient, api_key: str = "sk-test-secret") -> CodexAPIProvider:
    return CodexAPIProvider(
        api_key=api_key,
        model="gpt-5.3-codex",
        base_url="https://api.openai.com",
        reasoning_effort="high",
        client=client,
    )


async def test_availability_does_not_contact_api_without_a_key():
    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("unconfigured provider must not make a request")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _provider(client, api_key="")
        assert await provider.check_availability() == CodexAPIStatus.NOT_CONFIGURED


async def test_availability_validates_model_access_with_bearer_key():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/models/gpt-5.3-codex"
        assert request.headers["Authorization"] == "Bearer sk-test-secret"
        return httpx.Response(200, json={"id": "gpt-5.3-codex"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _provider(client)
        assert await provider.check_availability() == CodexAPIStatus.AVAILABLE
        assert await provider.health_check() is True


async def test_generate_completion_uses_responses_api_and_extracts_output_text():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/responses"
        payload = json.loads(request.content)
        assert payload == {
            "model": "gpt-5.3-codex",
            "store": False,
            "reasoning": {"effort": "high"},
            "input": "Plan this change",
            "instructions": "Be concise",
        }
        return httpx.Response(
            200,
            json={
                "output": [
                    {
                        "type": "reasoning",
                        "summary": [],
                    },
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {"type": "output_text", "text": "Use a provider adapter."}
                        ],
                    },
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _provider(client)
        result = await provider.generate_completion("Be concise", "Plan this change")

    assert result == "Use a provider adapter."


async def test_stream_completion_translates_messages_and_yields_text_deltas():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["instructions"] == "System rules"
        assert payload["input"] == [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi"},
            {"role": "user", "content": "Help me"},
        ]
        assert payload["stream"] is True
        body = "\n".join(
            [
                "event: response.created",
                'data: {"type":"response.created"}',
                "",
                "event: response.output_text.delta",
                'data: {"type":"response.output_text.delta","delta":"Hello"}',
                "",
                'data: {"type":"response.output_text.delta","delta":" there"}',
                "",
                'data: {"type":"response.completed"}',
                "",
            ]
        )
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=body.encode(),
        )

    messages = [
        {"role": "system", "content": "System rules"},
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi"},
        {"role": "user", "content": "Help me"},
    ]
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _provider(client)
        tokens = [token async for token in provider.stream_completion(messages)]

    assert tokens == ["Hello", " there"]


async def test_function_call_translates_tools_and_returns_chat_completion_shape():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["tools"] == [
            {
                "type": "function",
                "name": "classify",
                "description": "Classify the request",
                "parameters": {
                    "type": "object",
                    "properties": {"intent": {"type": "string"}},
                    "required": ["intent"],
                },
            }
        ]
        assert payload["tool_choice"] == {"type": "function", "name": "classify"}
        assert payload["parallel_tool_calls"] is False
        return httpx.Response(
            200,
            json={
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "call_123",
                        "name": "classify",
                        "arguments": '{"intent":"general_chat"}',
                    }
                ]
            },
        )

    tools = [
        {
            "type": "function",
            "function": {
                "name": "classify",
                "description": "Classify the request",
                "parameters": {
                    "type": "object",
                    "properties": {"intent": {"type": "string"}},
                    "required": ["intent"],
                },
            },
        }
    ]
    tool_choice = {"type": "function", "function": {"name": "classify"}}

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _provider(client)
        response = await provider.function_call(
            "Choose a tool", "Please classify this", tools, tool_choice
        )

    tool_call = response["choices"][0]["message"]["tool_calls"][0]
    assert tool_call == {
        "id": "call_123",
        "type": "function",
        "function": {
            "name": "classify",
            "arguments": '{"intent":"general_chat"}',
        },
    }


async def test_api_errors_do_not_echo_the_credential():
    secret = "sk-this-value-must-never-appear-in-errors"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": f"bad key {secret}"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = _provider(client, api_key=secret)
        with pytest.raises(AIUnavailableError) as caught:
            await provider.generate_completion("system", "user")

    assert "authentication failed" in str(caught.value).lower()
    assert secret not in str(caught.value)
