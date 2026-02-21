"""Intent classification service using LLM function calling.

Classifies user messages into actionable intents (e.g. create_todo, query_events)
so the orchestrator can route them to the appropriate service.
"""

import json
import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

# All supported intents the classifier can return
SUPPORTED_INTENTS = [
    "general_chat",
    "create_todo",
    "query_todos",
    "update_todo",
    "delete_todo",
    "complete_todo",
    "create_event",
    "query_events",
    "update_event",
    "delete_event",
    "create_memo",
    "query_memos",
    "update_memo",
    "delete_memo",
    "search",
    "delegate_task",
    "daily_briefing",
]

# The function definition sent to the LLM for structured classification
CLASSIFY_FUNCTION = {
    "name": "classify_intent",
    "description": (
        "Classify the user's message into an intent and extract structured parameters. "
        "Always return exactly one intent."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "intent": {
                "type": "string",
                "enum": SUPPORTED_INTENTS,
                "description": "The classified intent of the user message.",
            },
            "entities": {
                "type": "object",
                "description": (
                    "Extracted entities from the message. Keys depend on intent. "
                    "For create_todo: {title, description?, priority?, due_date?, tags?}. "
                    "For create_event: {title, description?, start_time?, end_time?, location?}. "
                    "For create_memo: {title?, content}. "
                    "For query_*: {query?, status?, priority?, date_range?}. "
                    "For update_*/delete_*/complete_*: {id?, title?, updates?}. "
                    "For search: {query, types?}. "
                    "For general_chat: {}."
                ),
                "additionalProperties": True,
            },
            "confidence": {
                "type": "number",
                "description": "Confidence score between 0 and 1.",
            },
        },
        "required": ["intent", "entities", "confidence"],
    },
}

SYSTEM_PROMPT = (
    "You are an intent classifier for a personal productivity assistant called ClawChat. "
    "The user can create/manage todos, events, and memos through natural language. "
    "Classify the user's message into one of the supported intents and extract relevant entities. "
    "If the message is conversational or a question not related to task/event/memo management, "
    'use "general_chat". Be conservative: only classify as a CRUD intent if the user clearly '
    "expresses that intention."
)


class IntentClassifier:
    """Classifies user messages using LLM function calling."""

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
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10, read=30, write=10, pool=10)
        )

    async def classify(
        self, user_message: str, conversation_context: Optional[list[dict]] = None
    ) -> dict[str, Any]:
        """Classify a user message and return {intent, entities, confidence}.

        Falls back to ``general_chat`` if classification fails.
        """
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]

        # Include last few messages for context if provided
        if conversation_context:
            for msg in conversation_context[-6:]:
                if msg.get("role") in ("user", "assistant"):
                    messages.append(
                        {"role": msg["role"], "content": msg["content"]}
                    )

        messages.append({"role": "user", "content": user_message})

        try:
            if self.provider == "ollama":
                return await self._classify_ollama(messages)
            else:
                return await self._classify_openai(messages)
        except Exception:
            logger.exception("Intent classification failed, falling back to general_chat")
            return {
                "intent": "general_chat",
                "entities": {},
                "confidence": 0.0,
            }

    async def _classify_openai(self, messages: list[dict]) -> dict[str, Any]:
        """Classify using OpenAI-compatible function calling."""
        url = f"{self.base_url}/v1/chat/completions"
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model,
            "messages": messages,
            "functions": [CLASSIFY_FUNCTION],
            "function_call": {"name": "classify_intent"},
            "temperature": 0.1,
        }

        resp = await self._client.post(url, json=payload, headers=headers)
        if resp.status_code != 200:
            logger.warning(
                "OpenAI function call returned %d: %s",
                resp.status_code,
                resp.text[:500],
            )
            return {"intent": "general_chat", "entities": {}, "confidence": 0.0}

        data = resp.json()
        choice = data.get("choices", [{}])[0]
        fn_call = choice.get("message", {}).get("function_call", {})
        arguments_str = fn_call.get("arguments", "{}")

        try:
            result = json.loads(arguments_str)
        except json.JSONDecodeError:
            return {"intent": "general_chat", "entities": {}, "confidence": 0.0}

        intent = result.get("intent", "general_chat")
        if intent not in SUPPORTED_INTENTS:
            intent = "general_chat"

        return {
            "intent": intent,
            "entities": result.get("entities", {}),
            "confidence": result.get("confidence", 0.5),
        }

    async def _classify_ollama(self, messages: list[dict]) -> dict[str, Any]:
        """Classify using Ollama.

        Ollama does not natively support function calling in all models, so we
        use a structured prompt that asks for JSON output and parse it.
        """
        # Modify the system prompt to request JSON directly
        classification_prompt = (
            "You must respond with ONLY a JSON object (no markdown, no explanation) "
            "with this exact structure:\n"
            '{"intent": "<one of: '
            + ", ".join(SUPPORTED_INTENTS)
            + '>", "entities": {<extracted entities>}, "confidence": <0-1>}\n\n'
            "Classify the following user message."
        )

        modified_messages = [{"role": "system", "content": classification_prompt}]
        # Add only the user messages (skip original system prompt)
        for msg in messages:
            if msg["role"] != "system":
                modified_messages.append(msg)

        url = f"{self.base_url}/api/chat"
        payload = {
            "model": self.model,
            "messages": modified_messages,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1},
        }

        resp = await self._client.post(url, json=payload)
        if resp.status_code != 200:
            logger.warning(
                "Ollama classification returned %d: %s",
                resp.status_code,
                resp.text[:500],
            )
            return {"intent": "general_chat", "entities": {}, "confidence": 0.0}

        data = resp.json()
        content = data.get("message", {}).get("content", "")

        try:
            result = json.loads(content)
        except json.JSONDecodeError:
            logger.warning("Ollama returned non-JSON: %s", content[:200])
            return {"intent": "general_chat", "entities": {}, "confidence": 0.0}

        intent = result.get("intent", "general_chat")
        if intent not in SUPPORTED_INTENTS:
            intent = "general_chat"

        return {
            "intent": intent,
            "entities": result.get("entities", {}),
            "confidence": result.get("confidence", 0.5),
        }

    async def close(self) -> None:
        await self._client.aclose()
