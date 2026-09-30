from auth.jwt import create_access_token, decode_token
from services import scheduler


def test_scheduler_messages_reach_the_signed_in_socket():
    """WebSockets register under the token subject; the scheduler must use it."""
    token, _expires_in = create_access_token()
    subject = decode_token(token)["sub"]
    assert scheduler.DEFAULT_USER_ID == subject
