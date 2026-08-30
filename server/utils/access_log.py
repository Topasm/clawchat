"""Keep credentials that live in URLs out of the access log.

The calendar subscription feed authenticates by path segment, because a
calendar app cannot send an ``Authorization`` header. That makes the URL itself
the credential, and uvicorn's access logger writes the full request path — so
WebSocket clients likewise use a short-lived ticket (or a legacy bearer token)
in their query string. Without this filter those credentials are written to the
log, and into whatever ships that log onward.

A reverse proxy in front of the server logs its own copy; see
``docs/deployment.md``.
"""

import logging
import re

# Keep credential-bearing URL shapes useful for diagnostics, but drop secrets.
_FEED_PATH = re.compile(r"(/api/events/feed/)[^/?\s]+(\.ics)")
_QUERY_CREDENTIAL = re.compile(r"([?&](?:ticket|token)=)[^&\s]+", re.IGNORECASE)


def redact_feed_tokens(text: str) -> str:
    """Backward-compatible entry point for all URL credential redaction."""
    return redact_url_credentials(text)


def redact_url_credentials(text: str) -> str:
    text = _FEED_PATH.sub(r"\1<redacted>\2", text)
    return _QUERY_CREDENTIAL.sub(r"\1<redacted>", text)


class _UrlCredentialFilter(logging.Filter):
    """Redact URL credentials in uvicorn access records.

    Uvicorn formats access lines from ``record.args``; the request path is one
    of them. Rewriting the arg leaves the rest of the line untouched, and the
    ``record.msg`` fallback covers any handler that has already formatted it.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                redact_url_credentials(a) if isinstance(a, str) else a for a in record.args
            )
        if isinstance(record.msg, str):
            record.msg = redact_url_credentials(record.msg)
        return True


def install_access_log_redaction() -> None:
    """Attach the filter to uvicorn's access logger, at most once."""
    logger = logging.getLogger("uvicorn.access")
    if any(isinstance(f, _UrlCredentialFilter) for f in logger.filters):
        return
    logger.addFilter(_UrlCredentialFilter())
