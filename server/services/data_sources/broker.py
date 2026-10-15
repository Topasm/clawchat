"""Wake-ups between the request waiting for an answer and the device giving it.

The rows in ``data_source_queries`` are the truth; these events only save the
two sides from polling the database. ClawChat runs as one process, so
in-process events reach every waiter (the login throttle relies on the same).
A restart drops them, and with them every waiting request, which is why a
device answer is only kept while someone is still waiting for it.
"""

from __future__ import annotations

import asyncio


class QueryBroker:
    def __init__(self) -> None:
        self._host_events: dict[str, asyncio.Event] = {}
        self._answers: dict[str, asyncio.Event] = {}

    # -- device side ------------------------------------------------------

    def host_event(self, host_id: str) -> asyncio.Event:
        """Set when a request for [host_id] is queued.

        A claimer clears it *before* looking for work, so a request queued
        between the look and the wait still wakes it.
        """
        event = self._host_events.get(host_id)
        if event is None:
            event = self._host_events[host_id] = asyncio.Event()
        return event

    def notify_host(self, host_id: str) -> None:
        self.host_event(host_id).set()

    # -- asker side ---------------------------------------------------------

    def expect(self, query_id: str) -> asyncio.Event:
        event = self._answers[query_id] = asyncio.Event()
        return event

    def is_waiting(self, query_id: str) -> bool:
        return query_id in self._answers

    def answered(self, query_id: str) -> None:
        event = self._answers.get(query_id)
        if event is not None:
            event.set()

    def forget(self, query_id: str) -> None:
        self._answers.pop(query_id, None)


broker = QueryBroker()
