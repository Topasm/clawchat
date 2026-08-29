"""Service layer, grouped by domain.

Each subpackage owns one domain and documents its own membership rule:

- ``vault``         -- Obsidian read, write and sync (depends on nothing here)
- ``tasks``         -- the task graph, its relationships and execution state
- ``review``        -- the review queue and versioned artifacts
- ``calendar``      -- events, recurrence, scheduling maths
- ``notifications`` -- reminders, nudges, digests, push
- ``relay``         -- remote-access relay and its crypto
- ``planning``      -- plan proposals, validation, inbox triage
- ``agents``        -- agent run lifecycle, delegation and recovery
- ``ai``            -- LLM provider clients (depends on nothing here)
- ``chat``          -- intent classification and chat orchestration (the top)

Four modules stay at this level because they are not domain code: ``scheduler``
(the process-wide asyncio loop that drives several domains), ``admin_service``
and ``search_service`` (cross-domain read models), and ``rate_limiter``
(transport-level throttling).

Subpackage ``__init__`` files deliberately re-export nothing.  Re-exporting
would buy no reach -- ``from services.tasks import todo_service`` resolves the
submodule on its own -- while making an import of any one module drag in its
whole domain.  The package graph is a DAG -- ``vault`` and ``ai`` at the
bottom, ``chat`` at the top -- and it is worth keeping that way.  Import the
module you want, not the package.
"""
