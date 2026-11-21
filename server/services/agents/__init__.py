"""Agent run lifecycle: launching work and supervising it to completion.

``agent_run_service`` owns the durable run rows, the event log and the
in-process cancellation registry; ``agent_task_service`` owns the task rows a
run executes; ``task_delegation_service`` is the entry point that picks a
skill and provider and starts the run; ``opencode_execution_service``
runs them in a sandboxed OpenCode server on this machine; ``orca_execution_service``
bridges them to a chat in the user's running Orca; ``task_execution_recovery_service``
releases an unsuccessful run's task back to the graph.

Depends on ``review`` (handoff and queue writes on completion), ``tasks``,
``planning`` and ``ai``.  ``agent_run_service`` reaches the OpenCode and
Orca services through function-local imports -- each pair is mutually
recursive by design, and the lazy import is what breaks the cycle.
"""
