"""Minimal InfluxDB query used to verify the OpenEgiz event pipeline."""

import csv
import re
import urllib.error
import urllib.request
from urllib.parse import urlencode

from app.integrations.telemetry import validate_run_id

THING_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$")


def influx_csv_has_rows(body: str) -> bool:
    """Detect annotated CSV data rows by their numeric table column."""
    return any(
        len(row) > 2 and row[0] == "" and row[2].isdigit() for row in csv.reader(body.splitlines())
    )


class InfluxVerifier:
    def __init__(self, base_url: str, token: str, org: str, bucket: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._org = org
        self._bucket = bucket

    def _query(self, query: str) -> str:
        request = urllib.request.Request(
            f"{self._base_url}/api/v2/query?{urlencode({'org': self._org})}",
            data=query.encode(),
            method="POST",
            headers={
                "Authorization": f"Token {self._token}",
                "Accept": "application/csv",
                "Content-Type": "application/vnd.flux",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = bytes(response.read()).decode("utf-8")
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Influx query failed with HTTP {exc.code}") from exc
        return body

    def recent_csv(self, thing_id: str) -> str:
        """Return up to five recent rows for safe operational diagnostics."""
        if not THING_ID_PATTERN.fullmatch(thing_id):
            raise ValueError("Unsafe thing ID")
        query = f'''from(bucket: "{self._bucket}")
  |> range(start: -10m)
  |> filter(fn: (r) => r._measurement == "mqtt_consumer")
  |> filter(fn: (r) => r.thingId == "{thing_id}")
  |> limit(n: 5)'''
        return self._query(query)

    def run_seen(self, thing_id: str, run_id: str) -> bool:
        if not THING_ID_PATTERN.fullmatch(thing_id):
            raise ValueError("Unsafe thing ID")
        validate_run_id(run_id)
        query = f'''from(bucket: "{self._bucket}")
  |> range(start: -10m)
  |> filter(fn: (r) => r._measurement == "mqtt_consumer")
  |> filter(fn: (r) => r.thingId == "{thing_id}")
  |> filter(fn: (r) => r.idSimulationRun == "{run_id}")
  |> limit(n: 1)'''
        return influx_csv_has_rows(self._query(query))
