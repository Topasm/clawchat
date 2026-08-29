"""Keep credentials that live in a URL out of the access log.

The calendar subscription feed authenticates by path segment, because a
calendar app cannot send an ``Authorization`` header. That makes the URL itself
the credential, and uvicorn's access logger writes the full request path — so
without this filter every poll of the feed prints a working credential into the
log, and into whatever ships that log onward.

A reverse proxy in front of the server logs its own copy; see
``docs/deployment.md``.
"""

import logging
import re

# ``/api/events/feed/<token>.ics`` — keep the shape, drop the secret.
_FEED_PATH = re.compile(r"(/api/events/feed/)[^/?\s]+(\.ics)")
_REDACTED = r"\1<redacted>\2"


def redact_feed_tokens(text: str) -> str:
    return _FEED_PATH.sub(_REDACTED, text)


class _FeedTokenFilter(logging.Filter):
    """Redact feed tokens in uvicorn access records.

    Uvicorn formats access lines from ``record.args``; the request path is one
    of them. Rewriting the arg leaves the rest of the line untouched, and the
    ``record.msg`` fallback covers any handler that has already formatted it.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                redact_feed_tokens(a) if isinstance(a, str) else a for a in record.args
            )
        if isinstance(record.msg, str):
            record.msg = redact_feed_tokens(record.msg)
        return True


def install_access_log_redaction() -> None:
    """Attach the filter to uvicorn's access logger, at most once."""
    logger = logging.getLogger("uvicorn.access")
    if any(isinstance(f, _FeedTokenFilter) for f in logger.filters):
        return
    logger.addFilter(_FeedTokenFilter())
