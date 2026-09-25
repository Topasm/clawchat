"""Discover selectable models without generating tokens or resuming sessions."""

import asyncio
import re


async def discover_models(provider: str, backend) -> tuple[list[str], str]:
    if provider == "claude_code":
        # CLI aliases follow provider/account policy; these are not access checks.
        return ["sonnet", "opus", "haiku", "best", "fable", "opusplan"], "aliases"
    try:
        async with asyncio.timeout(20):
            if provider == "codex_cli":
                from execution.cli_sessions import codex_connection

                # Use the installed binary, even if an older shared daemon is running.
                async with codex_connection(prefer_live=False) as connection:
                    models = []
                    cursor = None
                    seen = set()
                    for _ in range(20):
                        params = {"limit": 100, "includeHidden": False}
                        if cursor:
                            params["cursor"] = cursor
                        result = await connection.call("model/list", params)
                        models.extend(
                            row["model"]
                            for row in result.get("data", [])
                            if isinstance(row.get("model"), str)
                            and not row.get("hidden")
                        )
                        cursor = result.get("nextCursor")
                        if not cursor or cursor in seen:
                            break
                        seen.add(cursor)
                    if models:
                        return list(dict.fromkeys(models)), "cli"
            elif backend.is_configured:
                response = await backend.client.get(
                    f"{backend.base_url}/models",
                    headers=backend._auth_headers(),
                    timeout=10,
                )
                response.raise_for_status()
                models = [
                    row["id"]
                    for row in response.json().get("data", [])
                    if isinstance(row.get("id"), str)
                    and re.match(r"gpt-(?:[5-9]|[1-9][0-9]+)(?:[.-]|$)", row["id"])
                    and not any(
                        part in row["id"]
                        for part in (
                            "image",
                            "audio",
                            "realtime",
                            "transcribe",
                            "search",
                        )
                    )
                ]
                if models:
                    return sorted(set(models), reverse=True), "api"
    except Exception:
        # Still permit explicit IDs after an update or when discovery is offline.
        pass
    return ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"], "suggestions"
