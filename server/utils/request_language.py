"""The language a client asked for, read once from its request."""

from fastapi import Request

KOREAN = "ko"
ENGLISH = "en"


def request_language(request: Request) -> str:
    """`ko` when the first `Accept-Language` tag is Korean, otherwise `en`.

    The web and desktop clients send the app language there; a browser's own
    header (``ko-KR,ko;q=0.9,en;q=0.8``) reads the same way.
    """
    header = request.headers.get("accept-language", "")
    first = header.split(",", 1)[0].strip().lower()
    return KOREAN if first.startswith("ko") else ENGLISH
