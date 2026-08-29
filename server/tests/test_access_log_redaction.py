"""The feed URL is a credential, so it must not survive into the access log."""

import logging

from utils.access_log import install_access_log_redaction, redact_feed_tokens


def _access_record(path: str) -> logging.LogRecord:
    logger = logging.getLogger("uvicorn.access")
    return logger.makeRecord(
        "uvicorn.access", logging.INFO, "", 0,
        '%s - "%s %s HTTP/%s" %d',
        ("1.2.3.4", "GET", path, "1.1", 200), None,
    )


def test_the_token_is_redacted_from_an_access_line():
    install_access_log_redaction()
    record = _access_record("/api/events/feed/AbCd1234SecretToken.ics")

    logging.getLogger("uvicorn.access").filters[0].filter(record)

    assert "AbCd1234SecretToken" not in record.getMessage()
    assert "/api/events/feed/<redacted>.ics" in record.getMessage()


def test_a_query_string_does_not_smuggle_the_token_through():
    assert "tok" not in redact_feed_tokens("/api/events/feed/tok.ics?alt=1")


def test_unrelated_paths_are_untouched():
    for path in ("/api/events/export.ics", "/api/events", "/api/todos/t1"):
        assert redact_feed_tokens(path) == path


def test_installation_is_idempotent():
    logger = logging.getLogger("uvicorn.access")
    before = len(logger.filters)
    install_access_log_redaction()
    install_access_log_redaction()
    assert len(logger.filters) <= max(before, 1)
