"""Web search through a SearXNG instance the user runs.

SearXNG is a self-hosted metasearch engine, so searches do not go to a hosted
search API tied to an account. Its JSON output must be enabled in the
instance's settings (``search.formats`` includes ``json``).
"""

from urllib.parse import urlsplit

import httpx

MAX_RESULTS = 8
_SNIPPET_CHARS = 400
_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class SearchError(Exception):
    """The search could not be completed; the message is safe to show."""


def normalize_base_url(value: str) -> str:
    """Validate a SearXNG base URL and return it without a trailing slash."""
    url = value.strip().rstrip("/")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise SearchError("Enter the SearXNG address, e.g. http://localhost:8888")
    if parts.query or parts.fragment:
        raise SearchError("The SearXNG address cannot include a query or fragment")
    return url


async def search(
    base_url: str,
    query: str,
    *,
    limit: int = MAX_RESULTS,
    client: httpx.AsyncClient | None = None,
) -> list[dict[str, str]]:
    """Return up to ``limit`` results as {title, url, snippet}."""
    query = query.strip()
    if not query:
        raise SearchError("The search query is empty")
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=_TIMEOUT)
    try:
        response = await client.get(
            f"{normalize_base_url(base_url)}/search",
            params={"q": query, "format": "json", "safesearch": 1},
            headers={"Accept": "application/json"},
        )
    except httpx.HTTPError as exc:
        raise SearchError(f"Could not reach SearXNG: {exc.__class__.__name__}") from exc
    finally:
        if owns_client:
            await client.aclose()
    if response.status_code == 403:
        raise SearchError(
            "SearXNG refused JSON output. Add json to search.formats in its settings.yml."
        )
    if response.status_code >= 400:
        raise SearchError(f"SearXNG answered HTTP {response.status_code}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise SearchError("SearXNG did not return JSON") from exc
    results = []
    for item in payload.get("results") or []:
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        results.append(
            {
                "title": str(item.get("title") or url).strip(),
                "url": url,
                "snippet": str(item.get("content") or "").strip()[:_SNIPPET_CHARS],
            }
        )
        if len(results) >= max(1, min(limit, MAX_RESULTS)):
            break
    return results


def format_results(query: str, results: list[dict[str, str]]) -> str:
    if not results:
        return f'No web results for "{query}".'
    lines = [f'Web results for "{query}":']
    for index, result in enumerate(results, start=1):
        lines.append(f"{index}. {result['title']}\n   {result['url']}")
        if result["snippet"]:
            lines.append(f"   {result['snippet']}")
    return "\n".join(lines)
