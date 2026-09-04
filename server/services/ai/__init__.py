"""LLM provider plumbing.

``ai_service`` is the thin relay to the OpenAI-compatible gateway;
``claude_code_provider`` is the local Claude Code backend; and
``codex_api_provider`` adapts OpenAI's Responses API; and
``codex_cli_provider`` runs the local Codex CLI.  All are pure outbound clients.

This package imports nothing else under ``services``, which is what lets every
other domain depend on it freely.  The chat loop that *uses* a provider lives
in ``services.chat`` -- keeping the two apart is what makes the service
package graph acyclic.
"""


def resolve_active_ai(state):
    """Return the provider the workspace is currently using.

    Routers must not read ``state.ai_service`` directly: that attribute is the
    OpenClaw relay, so doing so bypasses a CLI provider the workspace selected
    and fails outright on hosts that never run OpenClaw. Returns ``None`` when
    the workspace is running without any provider at all.
    """
    return getattr(state, "active_ai", None) or getattr(state, "ai_service", None)
