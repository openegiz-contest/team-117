"""Small authenticated Eclipse Ditto HTTP client."""

import base64
import json
import urllib.error
import urllib.request
from collections.abc import Iterable
from typing import Any
from urllib.parse import quote


class DittoClient:
    def __init__(
        self, base_url: str, username: str, password: str, *, timeout_seconds: float = 30.0
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("Ditto timeout must be positive")
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        token = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._headers = {"Authorization": f"Basic {token}", "Accept": "application/json"}

    def _url(self, thing_id: str) -> str:
        return f"{self._base_url}/api/2/things/{quote(thing_id, safe=':')}"

    def get_thing(self, thing_id: str) -> dict[str, Any] | None:
        request = urllib.request.Request(self._url(thing_id), headers=self._headers)
        try:
            with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                value: object = json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            raise RuntimeError(f"Ditto GET failed with HTTP {exc.code}") from exc
        if not isinstance(value, dict):
            raise RuntimeError("Ditto returned a non-object thing")
        return value

    def get_things(self, thing_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
        """Read several twins in one authenticated request; missing twins are omitted."""
        ids = ",".join(quote(thing_id, safe=":") for thing_id in sorted(thing_ids))
        request = urllib.request.Request(
            f"{self._base_url}/api/2/things?ids={ids}", headers=self._headers
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                value: object = json.load(response)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Ditto batch GET failed with HTTP {exc.code}") from exc
        if not isinstance(value, list):
            raise RuntimeError("Ditto returned a non-list batch response")
        things: dict[str, dict[str, Any]] = {}
        for item in value:
            if not isinstance(item, dict) or not isinstance(item.get("thingId"), str):
                raise RuntimeError("Ditto returned an invalid thing in a batch response")
            things[item["thingId"]] = item
        return things

    def put_thing(self, thing_id: str, body: dict[str, object]) -> int:
        headers = {**self._headers, "Content-Type": "application/json"}
        request = urllib.request.Request(
            self._url(thing_id),
            data=json.dumps(body, separators=(",", ":"), allow_nan=False).encode(),
            method="PUT",
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                return int(response.status)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Ditto PUT failed with HTTP {exc.code}") from exc
