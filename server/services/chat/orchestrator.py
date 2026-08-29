import json
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from constants import SYSTEM_PROMPT
from exceptions import AIUnavailableError
from models.agent_task import AgentTask
from models.agent_run import AgentRun
from models.conversation import Conversation
from models.message import Message
from services.agents import agent_task_service, agent_run_service
from services.ai.ai_service import AIService
from services.chat.conversation_context import (
    build_first_class_project_context,
    build_project_context,
)
from services.chat.intent_classifier import classify_intent
from services.chat.intent_handlers import (
    MODULE_INTENTS,
    IntentContext,
    get_intent_handler,
    is_module_intent,
)
from utils import make_id
from ws.manager import ConnectionManager

logger = logging.getLogger(__name__)

# ``MODULE_INTENTS`` lives with the handler registry now; it stays importable
# from here because that is where callers have always found it.
__all__ = ["MODULE_INTENTS", "Orchestrator"]


class Orchestrator:
    """Routes a classified intent to its handler and delivers the reply.

    Everything intent-specific lives in ``services.chat.intent_handlers``;
    what is left here is routing, streaming, message persistence and error
    handling.
    """

    def __init__(
        self,
        ai_service: AIService,
        ws_manager: ConnectionManager,
        session_factory: async_sessionmaker[AsyncSession],
        app_state=None,
    ):
        self.ai = ai_service
        self.ws = ws_manager
        self.session_factory = session_factory
        self._app_state = app_state

    @property
    def active_ai(self):
        """Return the currently active AI provider (Claude Code or OpenClaw)."""
        if self._app_state:
            return getattr(self._app_state, "active_ai", self.ai)
        return self.ai

    async def resolve_intent_response(
        self,
        db: AsyncSession,
        conversation_id: str,
        intent: str,
        params: dict,
        content: str,
    ) -> tuple[str, dict | None] | None:
        """Produce the reply for an already-classified intent, without delivering it.

        Returns ``None`` when the intent has no self-contained textual answer and
        the caller should fall back to streaming a chat completion. That covers
        ``general_chat`` and ``delegate_task``: delegation spawns an AgentTask and
        reports progress over its own WebSocket events, which has no meaning on a
        one-shot SSE response.

        Splitting this out is what lets the SSE endpoint act on intents at all.
        Previously only the WebSocket path classified anything, so a client that
        streamed over SSE -- every Android client -- silently lost task and
        calendar actions.
        """
        definition = get_intent_handler(intent)
        if definition is None:
            if intent in MODULE_INTENTS:
                return self._unimplemented_module_intent(intent, params)
            return None

        ctx = IntentContext(
            db=db,
            ai=self.active_ai,
            ws=self.ws,
            intent=intent,
            params=params,
            content=content,
            conversation_id=conversation_id,
        )
        if not definition.module_intent:
            return await definition.handle(ctx)
        # Module intents act on user data, so a failure is reported as a reply
        # rather than raised: the user still gets an answer in the thread.
        try:
            return await definition.handle(ctx)
        except Exception:
            logger.exception("Module action failed for intent %s", intent)
            action = MODULE_INTENTS.get(intent, intent)
            return f"I tried to {action} but something went wrong. Please try again.", None

    @staticmethod
    def _unimplemented_module_intent(intent: str, params: dict) -> tuple[str, None]:
        """Reply for an intent the classifier knows but no handler implements."""
        action = MODULE_INTENTS.get(intent, intent)
        title = params.get("title", "")
        detail = f": '{title}'" if title else ""
        return f"I understood you want to {action}{detail}. This action is coming soon!", None

    async def handle_message(
        self,
        user_id: str,
        conversation_id: str,
        message_id: str,
        content: str,
    ):
        async with self.session_factory() as db:
            try:
                # 1. Classify intent (uses the active AI provider)
                intent_result = await classify_intent(content, self.active_ai)
                intent = intent_result.intent
                params = intent_result.params

                # Update user message with classified intent
                user_msg = await db.get(Message, message_id)
                if user_msg:
                    user_msg.intent = intent

                # 2. Route based on intent. Delegation is special-cased because
                # it has no one-shot reply: it queues background work and then
                # reports over its own events.
                if intent == "delegate_task":
                    await self._handle_delegate_task(
                        db, user_id, conversation_id, message_id, params, content
                    )
                elif get_intent_handler(intent) is not None or intent in MODULE_INTENTS:
                    await self._handle_resolved_intent(
                        db, user_id, conversation_id, intent, params, content
                    )
                else:
                    # general_chat and anything unrecognised
                    await self._handle_general_chat(
                        db, user_id, conversation_id, content
                    )

                # Auto-generate title for non-general-chat intents
                # (general_chat handles it internally)
                if intent != "general_chat":
                    conv = await db.get(Conversation, conversation_id)
                    if conv and not conv.title:
                        await self._generate_title(db, conv, content, user_id)

                await db.commit()

            except AIUnavailableError as exc:
                logger.error("AI unavailable: %s", exc)
                await self._send_error_message(
                    db, user_id, conversation_id,
                    "I'm sorry, I can't reach the AI provider right now. Please check that your AI service is running.",
                )
                await db.commit()
            except Exception:
                logger.exception("Orchestrator error")
                await self._send_error_message(
                    db, user_id, conversation_id,
                    "Something went wrong processing your message. Please try again.",
                )
                await db.commit()

    async def _handle_resolved_intent(
        self,
        db: AsyncSession,
        user_id: str,
        conversation_id: str,
        intent: str,
        params: dict,
        content: str,
    ):
        """Deliver a registry-resolved reply as an assistant message."""
        resolved = await self.resolve_intent_response(
            db, conversation_id, intent, params, content
        )
        if resolved is None:
            # A handler that declines leaves nothing to say; fall back to chat.
            await self._handle_general_chat(db, user_id, conversation_id, content)
            return

        response_text, action_metadata = resolved
        await self._send_assistant_message(
            db, user_id, conversation_id, intent, response_text, metadata=action_metadata
        )

        # Notify frontend to refresh module data
        if action_metadata and is_module_intent(intent):
            await self.ws.send_json(user_id, {
                "type": "module_data_changed",
                "data": {"module": action_metadata.get("module")},
            })

    async def _handle_delegate_task(
        self,
        db: AsyncSession,
        user_id: str,
        conversation_id: str,
        message_id: str,
        params: dict,
        content: str,
    ):
        instruction = params.get("instruction") or params.get("query") or content
        task_type = params.get("task_type", "research")

        # Use LLM-based skill selection (falls back to keyword heuristic).
        from skills.selector import select_skills
        skill_chain = await select_skills(self.active_ai, instruction)
        agent_type = skill_chain[0] if skill_chain else "general"

        task = await agent_task_service.create_task(
            db,
            task_type=task_type,
            instruction=instruction,
            conversation_id=conversation_id,
            message_id=message_id,
            agent_type=agent_type,
        )
        # Set the skill chain on the new task.
        task.skill_chain = json.dumps(skill_chain)
        await db.flush()
        provider = (
            getattr(self._app_state, "active_ai_provider", "openclaw")
            if self._app_state
            else "openclaw"
        )
        run = await agent_run_service.create_run(
            db,
            task,
            provider=provider,
            model=getattr(self.active_ai, "model", None),
        )

        is_multi_skill = len(skill_chain) > 1
        if is_multi_skill:
            chain_label = " → ".join(skill_chain)
            msg = (
                f"Got it! I'll run a skill chain ({chain_label}) for this task "
                f"(ID: {task.id}). I'll keep you updated on progress."
            )
        else:
            msg = (
                f"Got it! I've queued that as a background task (ID: {task.id}). "
                "I'll notify you when it's done."
            )

        await self._send_assistant_message(
            db,
            user_id,
            conversation_id,
            "delegate_task",
            msg,
            metadata={
                "action_type": "task_delegated",
                "task_id": task.id,
                "run_id": run.id,
                "agent_type": agent_type,
                "skill_chain": skill_chain,
                "is_multi_agent": is_multi_skill,
            },
        )
        # Make the task and run visible to the fresh execution session before
        # starting the coroutine.
        await db.commit()

        # Fire background execution with a fresh DB session
        async def _run_task():
            async with self.session_factory() as task_db:
                t = await task_db.get(AgentTask, task.id)
                persisted_run = await task_db.get(AgentRun, run.id)
                if t and persisted_run:
                    await agent_task_service.execute_task(
                        task_db, t, self.active_ai, self.ws, user_id,
                        session_factory=self.session_factory,
                        run=persisted_run,
                        provider=provider,
                        model=getattr(self.active_ai, "model", None),
                    )

        agent_run_service.launch_execution(run.id, _run_task())

    async def _handle_general_chat(
        self,
        db: AsyncSession,
        user_id: str,
        conversation_id: str,
        content: str,
    ):
        # Load last 20 messages for context
        q = (
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(20)
        )
        rows = (await db.execute(q)).scalars().all()
        history = list(reversed(rows))

        system_content = SYSTEM_PROMPT
        conv = await db.get(Conversation, conversation_id)
        if conv and conv.project_id:
            system_content += await build_first_class_project_context(db, conv.project_id)
        elif conv and conv.project_todo_id:
            system_content += await build_project_context(db, conv.project_todo_id)
        messages = [{"role": "system", "content": system_content}]
        for msg in history:
            messages.append({"role": msg.role, "content": msg.content})

        # Create assistant message placeholder
        assistant_msg_id = make_id("msg_")

        # Stream response via WebSocket (uses the active AI provider)
        try:
            full_content = await self.ws.stream_to_user(
                user_id=user_id,
                message_id=assistant_msg_id,
                conversation_id=conversation_id,
                token_iterator=self.active_ai.stream_completion(messages),
            )
        except Exception:
            # Send stream_end for the orphaned stream_start so the client doesn't hang
            await self.ws.send_json(user_id, {
                "type": "stream_end",
                "data": {"message_id": assistant_msg_id, "full_content": ""},
            })
            raise

        # Save assistant message
        assistant_msg = Message(
            id=assistant_msg_id,
            conversation_id=conversation_id,
            role="assistant",
            content=full_content,
            intent="general_chat",
        )
        db.add(assistant_msg)

        # Update conversation timestamp + auto-generate title
        conv = await db.get(Conversation, conversation_id)
        if conv:
            conv.updated_at = datetime.now(timezone.utc)
            if not conv.title:
                await self._generate_title(db, conv, content, user_id)

    async def _generate_title(
        self,
        db: AsyncSession,
        conv: Conversation,
        user_message: str,
        user_id: str,
    ):
        """Auto-generate a conversation title from the first user message."""
        try:
            title = await self.active_ai.generate_title(user_message)
            conv.title = title
            # Notify client of title update via WS
            await self.ws.send_json(user_id, {
                "type": "conversation_updated",
                "data": {"conversation_id": conv.id, "title": title},
            })
        except Exception:
            logger.warning("Failed to generate title for conversation %s", conv.id)

    async def _send_assistant_message(
        self,
        db: AsyncSession,
        user_id: str,
        conversation_id: str,
        intent: str,
        text: str,
        metadata: dict | None = None,
    ):
        msg_id = make_id("msg_")
        msg = Message(
            id=msg_id,
            conversation_id=conversation_id,
            role="assistant",
            content=text,
            intent=intent,
            metadata_json=json.dumps(metadata) if metadata else None,
        )
        db.add(msg)

        conv = await db.get(Conversation, conversation_id)
        if conv:
            conv.updated_at = datetime.now(timezone.utc)

        await self.ws.send_json(user_id, {
            "type": "stream_start",
            "data": {"message_id": msg_id, "conversation_id": conversation_id},
        })
        await self.ws.send_json(user_id, {
            "type": "stream_chunk",
            "data": {"message_id": msg_id, "content": text, "index": 0},
        })
        stream_end_data: dict = {"message_id": msg_id, "full_content": text}
        if metadata:
            stream_end_data["metadata"] = metadata
        await self.ws.send_json(user_id, {
            "type": "stream_end",
            "data": stream_end_data,
        })

    async def _send_error_message(
        self,
        db: AsyncSession,
        user_id: str,
        conversation_id: str,
        text: str,
    ):
        msg_id = make_id("msg_")
        msg = Message(
            id=msg_id,
            conversation_id=conversation_id,
            role="assistant",
            content=text,
            message_type="system",
        )
        db.add(msg)

        await self.ws.send_json(user_id, {
            "type": "stream_start",
            "data": {"message_id": msg_id, "conversation_id": conversation_id},
        })
        await self.ws.send_json(user_id, {
            "type": "stream_chunk",
            "data": {"message_id": msg_id, "content": text, "index": 0},
        })
        await self.ws.send_json(user_id, {
            "type": "stream_end",
            "data": {"message_id": msg_id, "full_content": text},
        })
