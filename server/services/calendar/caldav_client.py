"""A small CalDAV client: discovery, time-range reads, and conditional writes.

Only what calendar sync needs (RFC 4791 / RFC 6764), over httpx with Basic
auth -- which is what iCloud, Fastmail, Nextcloud, and Radicale accept with an
app-specific password.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit
from xml.etree import ElementTree

import httpx

DAV = "DAV:"
CALDAV = "urn:ietf:params:xml:ns:caldav"
CS = "http://calendarserver.org/ns/"
APPLE = "http://apple.com/ns/ical/"
_NS = {"d": DAV, "c": CALDAV, "cs": CS, "a": APPLE}
_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class CalDavError(Exception):
    """The server refused or failed; the message is safe to show."""


class PreconditionFailed(CalDavError):
    """The resource changed on the server since we last saw it (HTTP 412)."""


@dataclass(frozen=True)
class RemoteCalendar:
    href: str
    display_name: str
    color: str | None
    ctag: str | None


@dataclass(frozen=True)
class RemoteObject:
    href: str
    etag: str | None
    ics: str


def normalize_server_url(value: str) -> str:
    url = value.strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise CalDavError("Enter the CalDAV server address, e.g. https://caldav.icloud.com")
    return url if url.endswith("/") else url + "/"


def _utc_stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


class CalDavClient:
    def __init__(
        self,
        server_url: str,
        username: str,
        password: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.server_url = normalize_server_url(server_url)
        self._client = httpx.AsyncClient(
            auth=httpx.BasicAuth(username, password),
            timeout=_TIMEOUT,
            follow_redirects=True,
            transport=transport,
            headers={"User-Agent": "ClawChat CalDAV"},
        )

    async def __aenter__(self) -> "CalDavClient":
        return self

    async def __aexit__(self, *exc) -> None:
        await self._client.aclose()

    # --- HTTP -------------------------------------------------------------

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        try:
            response = await self._client.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise CalDavError(f"Could not reach the calendar server ({exc.__class__.__name__})") from exc
        if response.status_code == 401:
            raise CalDavError("The calendar server rejected the username or app password")
        if response.status_code == 412:
            raise PreconditionFailed("The event changed on the server")
        return response

    async def _xml(self, method: str, url: str, body: str, depth: str) -> ElementTree.Element:
        response = await self._request(
            method,
            url,
            content=body.encode(),
            headers={"Depth": depth, "Content-Type": "application/xml; charset=utf-8"},
        )
        if response.status_code not in (207, 200):
            raise CalDavError(f"{method} {urlsplit(url).path} answered HTTP {response.status_code}")
        try:
            return ElementTree.fromstring(response.content)
        except ElementTree.ParseError as exc:
            raise CalDavError("The calendar server sent an unreadable reply") from exc

    def _absolute(self, base: str, href: str) -> str:
        return urljoin(base, href.strip())

    # --- Discovery --------------------------------------------------------

    async def _href_prop(self, url: str, prop: str) -> str | None:
        body = (
            '<?xml version="1.0" encoding="utf-8"?>'
            f'<d:propfind xmlns:d="{DAV}" xmlns:c="{CALDAV}"><d:prop><{prop}/></d:prop></d:propfind>'
        )
        tree = await self._xml("PROPFIND", url, body, "0")
        prefix, name = prop.split(":", 1)
        element = tree.find(f".//{{{_NS[prefix]}}}{name}/{{{DAV}}}href")
        return self._absolute(url, element.text) if element is not None and element.text else None

    async def discover_home(self) -> str:
        """Find the calendar home set, starting from the server URL."""
        start = self.server_url
        principal = await self._href_prop(start, "d:current-user-principal")
        if principal is None:
            # RFC 6764: many servers answer at the well-known path.
            start = urljoin(self.server_url, "/.well-known/caldav")
            principal = await self._href_prop(start, "d:current-user-principal")
        if principal is None:
            raise CalDavError("This server did not say where your calendars are")
        home = await self._href_prop(principal, "c:calendar-home-set")
        if home is None:
            raise CalDavError("This server did not list a calendar home")
        return home

    async def list_calendars(self, home_url: str) -> list[RemoteCalendar]:
        body = (
            '<?xml version="1.0" encoding="utf-8"?>'
            f'<d:propfind xmlns:d="{DAV}" xmlns:c="{CALDAV}" xmlns:cs="{CS}" xmlns:a="{APPLE}">'
            "<d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/>"
            "<cs:getctag/><a:calendar-color/></d:prop></d:propfind>"
        )
        tree = await self._xml("PROPFIND", home_url, body, "1")
        calendars = []
        for response in tree.findall("d:response", _NS):
            href = response.findtext("d:href", namespaces=_NS)
            prop = response.find("d:propstat/d:prop", _NS)
            if not href or prop is None or prop.find("d:resourcetype/c:calendar", _NS) is None:
                continue
            components = prop.findall("c:supported-calendar-component-set/c:comp", _NS)
            if components and not any(comp.get("name") == "VEVENT" for comp in components):
                continue
            absolute = self._absolute(home_url, href)
            color = (prop.findtext("a:calendar-color", namespaces=_NS) or "").strip() or None
            calendars.append(
                RemoteCalendar(
                    href=absolute,
                    display_name=(prop.findtext("d:displayname", namespaces=_NS) or "").strip()
                    or urlsplit(absolute).path.rstrip("/").rsplit("/", 1)[-1],
                    color=color[:7] if color else None,
                    ctag=(prop.findtext("cs:getctag", namespaces=_NS) or "").strip() or None,
                )
            )
        return calendars

    async def ctag(self, calendar_href: str) -> str | None:
        body = (
            '<?xml version="1.0" encoding="utf-8"?>'
            f'<d:propfind xmlns:d="{DAV}" xmlns:cs="{CS}"><d:prop><cs:getctag/></d:prop></d:propfind>'
        )
        tree = await self._xml("PROPFIND", calendar_href, body, "0")
        return (tree.findtext(".//cs:getctag", namespaces=_NS) or "").strip() or None

    # --- Reading events ----------------------------------------------------

    async def events_between(
        self, calendar_href: str, start: datetime, end: datetime
    ) -> list[RemoteObject]:
        """Every event object with an occurrence in [start, end)."""
        body = (
            '<?xml version="1.0" encoding="utf-8"?>'
            f'<c:calendar-query xmlns:d="{DAV}" xmlns:c="{CALDAV}">'
            "<d:prop><d:getetag/><c:calendar-data/></d:prop>"
            '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'
            f'<c:time-range start="{_utc_stamp(start)}" end="{_utc_stamp(end)}"/>'
            "</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>"
        )
        tree = await self._xml("REPORT", calendar_href, body, "1")
        objects = []
        for response in tree.findall("d:response", _NS):
            href = response.findtext("d:href", namespaces=_NS)
            data = response.findtext("d:propstat/d:prop/c:calendar-data", namespaces=_NS)
            if not href or not data:
                continue
            etag = response.findtext("d:propstat/d:prop/d:getetag", namespaces=_NS)
            objects.append(
                RemoteObject(href=self._absolute(calendar_href, href), etag=etag, ics=data)
            )
        return objects

    async def get(self, href: str) -> RemoteObject | None:
        response = await self._request("GET", href)
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise CalDavError(f"Reading an event answered HTTP {response.status_code}")
        return RemoteObject(href=href, etag=response.headers.get("ETag"), ics=response.text)

    # --- Writing events ----------------------------------------------------

    async def put(self, href: str, ics: str, *, etag: str | None, create: bool) -> str | None:
        """Write one event; ``create`` refuses to overwrite, ``etag`` refuses stale writes."""
        headers = {"Content-Type": "text/calendar; charset=utf-8"}
        if create:
            headers["If-None-Match"] = "*"
        elif etag:
            headers["If-Match"] = etag
        response = await self._request("PUT", href, content=ics.encode(), headers=headers)
        if response.status_code not in (200, 201, 204):
            raise CalDavError(f"Saving the event answered HTTP {response.status_code}")
        return response.headers.get("ETag")

    async def delete(self, href: str, *, etag: str | None) -> None:
        headers = {"If-Match": etag} if etag else {}
        response = await self._request("DELETE", href, headers=headers)
        if response.status_code not in (200, 204, 404):
            raise CalDavError(f"Deleting the event answered HTTP {response.status_code}")
