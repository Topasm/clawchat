"""Turning intent into a proposed change to the task graph.

``todo_planning_service`` captures prompt context and parses the LLM's plan,
``plan_validation_service`` validates it deterministically, and
``plan_proposal_service`` versions, applies and conservatively undoes it.
``inbox_pipeline_service`` and ``inbox_triage_service`` are the capture-side
counterparts: classify a newly captured todo and recommend where it belongs.

Depends on ``ai``, ``tasks``, ``review`` and ``vault``.
"""
