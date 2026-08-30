"""LLM provider plumbing.

``ai_service`` is the thin relay to the OpenAI-compatible gateway;
``claude_code_provider`` is the local Claude Code backend; and
``codex_api_provider`` adapts OpenAI's Responses API.  All are pure outbound
clients.

This package imports nothing else under ``services``, which is what lets every
other domain depend on it freely.  The chat loop that *uses* a provider lives
in ``services.chat`` -- keeping the two apart is what makes the service
package graph acyclic.
"""
