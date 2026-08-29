"""The task graph: todo rows, their relationships, and execution state.

``graph_command_service`` (revision CAS) and ``graph_insights_service``
(read-only derivations) are the primitives every other module here builds on.
``task_relationship_service`` and ``task_placement_service`` are the two
mutators that take the revision lock; ``task_execution_service`` guards an
explicit single-task execution and ``task_execution_telemetry_service``
reports on it.  ``project_service`` owns the project rows the graph hangs off.

The only edge out of this package is ``todo_service`` exporting to ``vault``.
Anything here that needs to reach an agent run belongs in ``agents`` instead --
that is why ``task_execution_recovery_service`` lives there.
"""
