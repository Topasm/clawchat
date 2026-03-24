"""HTTP client wrapper around the ClawChat REST API."""

from __future__ import annotations

from typing import Any

import httpx

from claw_cli import config
from claw_cli.errors import AuthError, NotFoundError, ServerError


def _base_url() -> str:
    url = config.get_server_url()
    if not url:
        raise AuthError("Not logged in. Run: claw auth login --server <url>")
    return url


def _ensure_auth() -> str:
    """Return a valid access token, refreshing once if expired."""
    token = config.get_access_token()
    if not token:
        raise AuthError("Not logged in. Run: claw auth login --server <url>")

    if config.is_token_expired():
        token = _refresh_token()

    return token


def _refresh_token() -> str:
    """Attempt a single token refresh. Raises AuthError on failure."""
    refresh = config.get_refresh_token()
    if not refresh:
        raise AuthError("Session expired. Run: claw auth login")

    base = _base_url()
    try:
        resp = httpx.post(
            f"{base}/api/auth/refresh",
            json={"refresh_token": refresh},
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise ServerError(f"Cannot reach server: {exc}") from exc

    if resp.status_code == 401:
        config.clear_tokens()
        raise AuthError("Session expired. Run: claw auth login")

    if resp.status_code != 200:
        raise ServerError(f"Token refresh failed ({resp.status_code})")

    data = resp.json()
    config.save_tokens(
        server_url=base,
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_in=data["expires_in"],
    )
    return data["access_token"]


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_ensure_auth()}"}


def _handle_response(resp: httpx.Response) -> Any:
    """Convert HTTP errors to ClawError subtypes."""
    if resp.status_code == 401:
        # Try refresh once
        token = _refresh_token()
        # Re-send the original request
        new_resp = httpx.request(
            resp.request.method,
            str(resp.request.url),
            headers={"Authorization": f"Bearer {token}"},
            content=resp.request.content,
            timeout=30,
        )
        if new_resp.status_code == 401:
            raise AuthError("Authentication failed. Run: claw auth login")
        return _handle_response_final(new_resp)
    return _handle_response_final(resp)


def _handle_response_final(resp: httpx.Response) -> Any:
    if resp.status_code == 404:
        raise NotFoundError("Resource not found")
    if resp.status_code == 422:
        detail = resp.json().get("detail", "Validation error")
        raise ServerError(f"Validation error: {detail}")
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("detail", resp.text)
        except Exception:
            detail = resp.text
        raise ServerError(f"Server error ({resp.status_code}): {detail}")
    if resp.status_code == 204:
        return None
    return resp.json()


def _request(method: str, path: str, **kwargs: Any) -> Any:
    base = _base_url()
    kwargs.setdefault("timeout", 30)
    kwargs.setdefault("headers", _headers())
    try:
        resp = httpx.request(method, f"{base}{path}", **kwargs)
    except httpx.HTTPError as exc:
        raise ServerError(f"Cannot reach server: {exc}") from exc
    return _handle_response(resp)


# ── Auth ─────────────────────────────────────────────────────────────

def login(server_url: str, pin: str) -> dict:
    server_url = server_url.rstrip("/")
    try:
        resp = httpx.post(
            f"{server_url}/api/auth/login",
            json={"pin": pin},
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise ServerError(f"Cannot reach server: {exc}") from exc

    if resp.status_code == 401:
        raise AuthError("Invalid PIN")
    if resp.status_code != 200:
        raise ServerError(f"Login failed ({resp.status_code})")

    data = resp.json()
    config.save_tokens(
        server_url=server_url,
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_in=data["expires_in"],
    )
    return data


def logout() -> None:
    try:
        _request("POST", "/api/auth/logout")
    except Exception:
        pass  # best-effort
    config.clear_tokens()


# ── Todos ────────────────────────────────────────────────────────────

def todo_list(**params: Any) -> dict:
    # Remove None values
    params = {k: v for k, v in params.items() if v is not None}
    return _request("GET", "/api/todos", params=params)


def todo_create(body: dict) -> dict:
    return _request("POST", "/api/todos", json=body)


def todo_get(todo_id: str) -> dict:
    return _request("GET", f"/api/todos/{todo_id}")


def todo_update(todo_id: str, body: dict) -> dict:
    return _request("PATCH", f"/api/todos/{todo_id}", json=body)


# ── Today ────────────────────────────────────────────────────────────

def today() -> dict:
    return _request("GET", "/api/today")


# ── Inbox / Organize ────────────────────────────────────────────────

def organize(todo_id: str) -> dict:
    return _request("POST", f"/api/todos/{todo_id}/organize")


def answer_questions(todo_id: str, answers: dict[str, str]) -> dict:
    return _request("POST", f"/api/todos/{todo_id}/answer-questions", json={"answers": answers})


def skip_questions(todo_id: str) -> dict:
    return _request("POST", f"/api/todos/{todo_id}/skip-questions")


# ── Plan ─────────────────────────────────────────────────────────────

def plan_latest(todo_id: str) -> dict:
    return _request("GET", f"/api/todos/{todo_id}/plan/latest")


def plan_apply(todo_id: str) -> dict:
    return _request("POST", f"/api/todos/{todo_id}/plan/apply")


def plan_dismiss(todo_id: str) -> dict:
    return _request("POST", f"/api/todos/{todo_id}/plan/dismiss")


# ── Delegate / Skills ───────────────────────────────────────────────

def delegate(todo_id: str, skill_id: str) -> dict:
    return _request("POST", f"/api/todos/{todo_id}/delegate", json={"skill_id": skill_id})


def skills_list() -> dict:
    return _request("GET", "/api/todos/skills/list")
