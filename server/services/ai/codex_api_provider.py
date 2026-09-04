"""OpenAI Codex provider backed by the Responses API.

Codex models are exposed through ``POST /v1/responses`` rather than the
OpenAI-compatible Chat Completions contract used by OpenClaw.  This adapter
keeps ClawChat's small provider interface stable while translating messages,
streaming events, and function calls to and from the Responses API.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from enum import StrEnum
from urllib.parse import quote

import httpx

from exceptions import AIUnavailableError

logger = logging.getLogger(__name__)


class CodexAPIStatus(StrEnum):
    AVAILABLE = "available"
    NOT_CONFIGURED = "not_configured"
    AUTHENTICATION_FAILED = "authentication_failed"
    UNAVAILABLE = "unavailable"


class CodexAPIProvider:
    """ClawChat AI provider for OpenAI's Codex models."""

    supports_native_tool_calling = True

    def __init__(
        self,
        *,
        api_key: str = "",
        model: str = "gpt-5.3-codex",
        base_url: str = "https://api.openai.com/v1",
        reasoning_effort: str = "medium",
        client: httpx.AsyncClient | None = None,
    ):
        normalized_base_url = base_url.rstrip("/")
        if not normalized_base_url.endswith("/v1"):
            normalized_base_url = f"{normalized_base_url}/v1"
        self.base_url = normalized_base_url
        self.api_key = api_key.strip()
        self.model = model
        self.reasoning_effort = reasoning_effort
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(120.0, connect=10.0)
        )
        self._owns_client = client is None

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def set_api_key(self, api_key: str) -> None:
        """Replace the in-memory credential without recreating the client."""
        self.api_key = api_key.strip()

    async def check_availability(self) -> CodexAPIStatus:
        """Validate credentials and model access without generating tokens."""
        if not self.is_configured:
            return CodexAPIStatus.NOT_CONFIGURED

        try:
            response = await self.client.get(
                f"{self.base_url}/models/{quote(self.model, safe='')}",
                headers=self._auth_headers(),
                timeout=10.0,
            )
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.TimeoutException):
            return CodexAPIStatus.UNAVAILABLE
        except httpx.HTTPError:
            return CodexAPIStatus.UNAVAILABLE

        if response.status_code == 200:
            return CodexAPIStatus.AVAILABLE
        if response.status_code in (401, 403):
            return CodexAPIStatus.AUTHENTICATION_FAILED
        return CodexAPIStatus.UNAVAILABLE

    async def health_check(self) -> bool:
        return await self.check_availability() == CodexAPIStatus.AVAILABLE

    async def stream_completion(self, messages: list[dict]) -> AsyncIterator[str]:
        """Yield visible text deltas from a streaming Responses API call."""
        if not self.is_configured:
            raise AIUnavailableError("Codex API key is not configured")
        instructions, response_input = _responses_input(messages)
        payload = self._base_payload(input=response_input, stream=True)
        if instructions:
            payload["instructions"] = instructions

        try:
            async with self.client.stream(
                "POST",
                f"{self.base_url}/responses",
                json=payload,
                headers=self._auth_headers(),
            ) as response:
                self._raise_for_status(response)
                event_name = ""
                async for line in response.aiter_lines():
                    if line.startswith("event:"):
                        event_name = line[6:].strip()
                        continue
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    event_type = event.get("type") or event_name
                    if event_type == "response.output_text.delta":
                        delta = event.get("delta")
                        if isinstance(delta, str) and delta:
                            yield delta
                    elif event_type in {"error", "response.failed"}:
                        raise AIUnavailableError("Codex API response failed")
        except AIUnavailableError:
            raise
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise AIUnavailableError("Cannot reach the Codex API") from exc
        except httpx.TimeoutException as exc:
            raise AIUnavailableError("Codex API request timed out") from exc
        except httpx.HTTPError as exc:
            raise AIUnavailableError("Codex API request failed") from exc

    async def generate_completion(self, system_prompt: str, user_message: str) -> str:
        payload = self._base_payload(input=user_message)
        if system_prompt:
            payload["instructions"] = system_prompt
        response = await self._post_response(payload)
        return _output_text(response).strip()

    async def generate_title(self, user_message: str) -> str:
        system_prompt = (
            "Generate a short title (max 6 words) for a conversation that starts with "
            "the following user message. Reply with ONLY the title, no quotes or "
            "punctuation at the start/end."
        )
        try:
            title = await self.generate_completion(system_prompt, user_message)
            return title[:60] if title else "New Conversation"
        except Exception:
            logger.warning("Codex title generation failed, using fallback")
            return "New Conversation"

    async def function_call(
        self,
        system_prompt: str,
        user_message: str,
        tools: list[dict],
        tool_choice: dict | str = "auto",
    ) -> dict:
        """Translate Responses API function calls to Chat Completions shape."""
        response_tools = [_responses_tool(tool) for tool in tools]
        response_tools = [tool for tool in response_tools if tool is not None]
        payload = self._base_payload(
            input=user_message,
            tools=response_tools,
            tool_choice=_responses_tool_choice(tool_choice),
            parallel_tool_calls=False,
        )
        if system_prompt:
            payload["instructions"] = system_prompt

        response = await self._post_response(payload)
        tool_calls = []
        for item in response.get("output", []):
            if not isinstance(item, dict) or item.get("type") != "function_call":
                continue
            name = item.get("name")
            arguments = item.get("arguments")
            if not isinstance(name, str) or not isinstance(arguments, str):
                continue
            tool_calls.append(
                {
                    "id": item.get("call_id") or item.get("id"),
                    "type": "function",
                    "function": {"name": name, "arguments": arguments},
                }
            )

        return {
            "choices": [
                {
                    "message": {
                        "content": _output_text(response) or None,
                        "tool_calls": tool_calls,
                    }
                }
            ]
        }

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    def _base_payload(self, **values) -> dict:
        return {
            "model": self.model,
            "store": False,
            "reasoning": {"effort": self.reasoning_effort},
            **values,
        }

    async def _post_response(self, payload: dict) -> dict:
        if not self.is_configured:
            raise AIUnavailableError("Codex API key is not configured")
        try:
            response = await self.client.post(
                f"{self.base_url}/responses",
                json=payload,
                headers=self._auth_headers(),
            )
            self._raise_for_status(response)
            return response.json()
        except AIUnavailableError:
            raise
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise AIUnavailableError("Cannot reach the Codex API") from exc
        except httpx.TimeoutException as exc:
            raise AIUnavailableError("Codex API request timed out") from exc
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            raise AIUnavailableError("Codex API returned an invalid response") from exc

    def _auth_headers(self) -> dict[str, str]:
        if not self.is_configured:
            return {}
        return {"Authorization": f"Bearer {self.api_key}"}

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        if response.status_code in (401, 403):
            raise AIUnavailableError("Codex API authentication failed")
        if response.status_code == 404:
            raise AIUnavailableError("The configured Codex model is unavailable")
        if response.status_code == 429:
            raise AIUnavailableError("Codex API rate limit reached")
        raise AIUnavailableError(
            f"Codex API request failed with status {response.status_code}"
        )


def _responses_input(messages: list[dict]) -> tuple[str, list[dict] | str]:
    instructions: list[str] = []
    response_input: list[dict] = []
    for message in messages:
        role = message.get("role")
        content = message.get("content", "")
        if role in {"system", "developer"}:
            if isinstance(content, str) and content:
                instructions.append(content)
            continue
        if role not in {"user", "assistant"}:
            continue
        response_input.append({"role": role, "content": content})
    return "\n\n".join(instructions), response_input or "Hello"


def _responses_tool(tool: dict) -> dict | None:
    if tool.get("type") != "function" or not isinstance(tool.get("function"), dict):
        return None
    function = tool["function"]
    name = function.get("name")
    if not isinstance(name, str) or not name:
        return None
    translated = {
        "type": "function",
        "name": name,
        "parameters": function.get("parameters", {"type": "object", "properties": {}}),
    }
    if isinstance(function.get("description"), str):
        translated["description"] = function["description"]
    if isinstance(function.get("strict"), bool):
        translated["strict"] = function["strict"]
    return translated


def _responses_tool_choice(tool_choice: dict | str) -> dict | str:
    if not isinstance(tool_choice, dict):
        return tool_choice
    function = tool_choice.get("function")
    if tool_choice.get("type") == "function" and isinstance(function, dict):
        name = function.get("name")
        if isinstance(name, str) and name:
            return {"type": "function", "name": name}
    return tool_choice


def _output_text(response: dict) -> str:
    direct = response.get("output_text")
    if isinstance(direct, str):
        return direct

    parts: list[str] = []
    for item in response.get("output", []):
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict) or content.get("type") != "output_text":
                continue
            text = content.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "".join(parts)
