"""The review queue and the artifacts it reviews.

``review_item_service`` is the shared queue persistence,
``agent_review_handoff_service`` computes the deterministic Todo handoff a
review implies, and ``artifact_service`` versions the project artifacts an
agent run adopts.

Sits below ``agents``: runs write here, nothing here reaches back into a run.
"""
