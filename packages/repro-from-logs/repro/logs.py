"""Read a request log and keep the requests worth replaying.

A log is one JSON object per line, the way a structured application log looks:

    {"time": "2026-11-17T14:02:11Z", "method": "POST", "path": "/orders", "user": "sam",
     "body": {...}, "status": 400, "error": "Insufficient stock for product 3 (available: 2)"}

Real logs also hold lines that are not requests (start-up messages, blank lines, a line
cut off when the file was copied). Those are skipped, each with its line number, so the
report can say what was ignored instead of failing on the first odd line.
"""
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

REQUIRED = ("time", "method", "path", "status")


@dataclass(frozen=True)
class Entry:
    line: int
    time: str
    method: str
    path: str
    user: str
    body: Any
    status: int
    error: Optional[str]

    @property
    def failed(self) -> bool:
        return self.status >= 400


@dataclass
class ParsedLog:
    entries: list = field(default_factory=list)
    skipped: list = field(default_factory=list)  # (line number, reason)


def parse_log(text: str) -> ParsedLog:
    parsed = ParsedLog()
    for number, raw in enumerate(text.splitlines(), start=1):
        raw = raw.strip()
        if not raw:
            continue
        try:
            record = json.loads(raw)
        except json.JSONDecodeError:
            parsed.skipped.append((number, "not JSON"))
            continue
        if not isinstance(record, dict):
            parsed.skipped.append((number, "not a JSON object"))
            continue
        missing = [key for key in REQUIRED if key not in record]
        if missing:
            parsed.skipped.append((number, "no " + ", ".join(missing)))
            continue
        if not isinstance(record["status"], int) or isinstance(record["status"], bool):
            parsed.skipped.append((number, "status is not a number"))
            continue
        parsed.entries.append(Entry(
            line=number,
            time=str(record["time"]),
            method=str(record["method"]).upper(),
            path=str(record["path"]),
            user=str(record.get("user", "anonymous")),
            body=record.get("body"),
            status=record["status"],
            error=record.get("error"),
        ))
    # Logs from more than one server instance interleave. Replay in time order; entries
    # with the same time keep the order they have in the file.
    parsed.entries.sort(key=lambda e: moment(e.time))
    return parsed


def moment(text: str) -> datetime:
    """A log time as a point in time, so 14:02:11Z, 14:02:11.500Z and 09:02:11-05:00 sort the
    way they happened and not the way their text sorts. A time that cannot be read (or has no
    zone) is taken as UTC; one that is not a time at all sorts first."""
    try:
        value = datetime.fromisoformat(text.strip())
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def normalize_error(message: Optional[str]) -> str:
    """The error text with every number replaced, so an ID or a count that differs between
    the customer's system and the replay (product 3 here, product 41 there) does not count
    as a different failure. Words still have to match."""
    return re.sub(r"\d+", "N", (message or "").strip())
