"""AI service for streaming chat completions via Ollama or OpenAI-compatible APIs."""

import json
import logging
from collections.abc import AsyncIterator

import httpx

logger = logging.getLogger(__name__)


class AIUnavailableError(Exception):
    """Raised when the AI backend cannot be reached or returns an error."""


class AIService:
    """Thin wrapper around Ollama / OpenAI-compatible chat completion APIs.

    Supports two providers:
    - ``"ollama"`` — uses the native ``/api/chat`` NDJSON streaming endpoint.
    - ``"openai"`` (or any other value) — uses the ``/v1/chat/completions`` SSE
      streaming endpoint, compatible with OpenAI, Together, Groq, etc.
    """

    def __init__(
        self,
        provider: str = "ollama",
        base_url: str = "http://localhost:11434",
        api_key: str = "",
        model: str = "llama3.2",
    ) -> None:
        self.provider = provider.lower()
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=120, write=10, pool=10))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def stream_completion(self, messages: list[dict]) -> AsyncIterator[str]:
        """Yield tokens from the AI backend as an async iterator.

        ``messages`` should be a list of ``{"role": ..., "content": ...}`` dicts.

        Raises ``AIUnavailableError`` if the backend is unreachable or returns a
        non-200 status.
        """
        if self.provider == "ollama":
            async for token in self._stream_ollama(messages):
                yield token
        else:
            async for token in self._stream_openai(messages):
                yield token

    async def close(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------
    # Ollama native streaming (/api/chat — NDJSON)
    # ------------------------------------------------------------------

    async def _stream_ollama(self, messages: list[dict]) -> AsyncIterator[str]:
        url = f"{self.base_url}/api/chat"
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
        }

        try:
            async with self._client.stream("POST", url, json=payload) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise AIUnavailableError(
                        f"Ollama returned {resp.status_code}: {body.decode(errors='replace')}"
                    )
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if data.get("done"):
                        break
                    token = data.get("message", {}).get("content", "")
                    if token:
                        yield token
        except httpx.ConnectError as exc:
            raise AIUnavailableError(f"Cannot connect to Ollama at {self.base_url}: {exc}") from exc
        except httpx.ReadTimeout as exc:
            raise AIUnavailableError(f"Ollama read timeout: {exc}") from exc

    # ------------------------------------------------------------------
    # OpenAI-compatible streaming (/v1/chat/completions — SSE)
    # ------------------------------------------------------------------

    async def _stream_openai(self, messages: list[dict]) -> AsyncIterator[str]:
        url = f"{self.base_url}/v1/chat/completions"
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
        }
        headers: dict[str, str] = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        try:
            async with self._client.stream("POST", url, json=payload, headers=headers) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise AIUnavailableError(
                        f"OpenAI-compatible API returned {resp.status_code}: {body.decode(errors='replace')}"
                    )
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        line = line[6:]
                    elif line.startswith("data:"):
                        line = line[5:]
                    else:
                        continue
                    if line.strip() == "[DONE]":
                        break
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    choices = data.get("choices", [])
                    if choices:
                        token = choices[0].get("delta", {}).get("content", "")
                        if token:
                            yield token
        except httpx.ConnectError as exc:
            raise AIUnavailableError(
                f"Cannot connect to AI provider at {self.base_url}: {exc}"
            ) from exc
        except httpx.ReadTimeout as exc:
            raise AIUnavailableError(f"AI provider read timeout: {exc}") from exc
