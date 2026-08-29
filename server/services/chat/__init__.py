"""The chat loop: classify a message, route it, deliver the reply.

``intent_classifier`` turns a user message into a named intent via LLM function
calling, ``intent_handlers`` is the registry that resolves that name to a
handler, ``conversation_context`` builds the project blocks appended to the
system prompt (shared by both transports), and ``orchestrator`` drives the
whole loop.

This is the top of the service graph: handlers reach down into ``tasks``,
``calendar``, ``notifications``, ``agents`` and ``search_service``, and nothing
under ``services`` reaches back up into it.
"""
