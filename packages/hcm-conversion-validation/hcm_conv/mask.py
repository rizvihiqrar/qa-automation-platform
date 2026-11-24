"""Mask the personal data in the legacy extract, for a test tenant that must not hold real people.

    HCM_MASK_KEY=<secret> python -m hcm_conv mask --out reports/masked

Masked (workers.csv): first name, last name, birth date, personal email and national ID. Each
masked value comes from an HMAC-SHA256 of the employee ID and the column, under a secret key:
  - the same key gives the same masked extract on every run, and the two rows of a worker who
    was entered twice still agree with each other
  - without the key, a masked value cannot be traced back to the person
Kept as they are: employee IDs, hire and termination dates, positions and pay. The conversion
and the payroll parallel need them, and the masked columns are the ones that name a person.

The shape of every value is kept, so the conversion checks find the same problems in the
masked copy: a blank stays blank, a name with accents gets a fake name with accents, a name
garbled by the wrong encoding gets a fake name garbled the same way, a national ID stays 9
digits starting with 0 (never anyone's real one, never shared), a birth date moves by 1 to 180
days inside the same year, and a birth date that is not a valid date gets other digits but stays
invalid.
"""
from __future__ import annotations

import hashlib
import hmac
import shutil
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from faker import Faker

from . import convert, extract, legacy

MASKED = ("first_name", "last_name", "birth_date", "personal_email", "national_id")
MAX_SHIFT = 180


def name_pools() -> dict[str, dict[bool, list[str]]]:
    """Fake names to choose from, by column and by whether they have accents (fixed seed)."""
    pools = {"first_name": {True: set(), False: set()}, "last_name": {True: set(), False: set()}}
    for i, locale in enumerate(("fr_CA", "en_CA")):
        fake = Faker(locale)
        fake.seed_instance(4051 + i)
        for _ in range(600):
            for column, make in (("first_name", fake.first_name), ("last_name", fake.last_name)):
                value = make()
                if all(ord(c) < 256 for c in value):   # garbling needs Latin-1 accents (é -> Ã©)
                    pools[column][any(ord(c) > 127 for c in value)].add(value)
    return {column: {k: sorted(v) for k, v in by_kind.items()} for column, by_kind in pools.items()}


POOLS = name_pools()


def digest(key: bytes, employee_id: str, column: str, attempt: int = 0) -> int:
    message = f"{employee_id}\x1f{column}\x1f{attempt}".encode("utf-8")
    return int.from_bytes(hmac.new(key, message, hashlib.sha256).digest()[:8], "big")


def garble(text: str) -> str:
    """UTF-8 read as Windows-1252, as the legacy defect did (é becomes Ã©)."""
    return text.encode("utf-8").decode("cp1252", errors="replace")


def blank(value: str) -> bool:
    """Blank as the conversion sees it (it strips first): kept as it is, so REQUIRED still fires."""
    return value.strip() == ""


def valid_date(value: str) -> bool:
    """The conversion's own test (convert.transform): YYYY-MM-DD and a real day."""
    return convert.transform({"date": True}, value)[1] is None


def mask_name(key: bytes, employee_id: str, column: str, original: str) -> str:
    if blank(original):
        return original
    garbled = bool(convert.MOJIBAKE.search(original))
    pool = POOLS[column][garbled or any(ord(c) > 127 for c in original)]
    for attempt in range(10):
        value = pool[digest(key, employee_id, column, attempt) % len(pool)]
        value = garble(value) if garbled else value
        if value != original:
            return value
    raise ValueError(f"no masked {column} for {employee_id}")


def mask_birth_date(key: bytes, employee_id: str, original: str) -> str:
    if blank(original):
        return original
    if not valid_date(original):
        # Not a date the conversion accepts: change its digits, keep it invalid, so DATE_INVALID still fires
        for attempt in range(20):
            n = digest(key, employee_id, "birth_date", attempt)
            value = "".join(str((int(c) + n // 10 ** (i % 18)) % 10) if c.isdigit() else c
                            for i, c in enumerate(original))
            if value != original and not valid_date(value):
                return value
        raise ValueError(f"no masked birth date for {employee_id}")
    born = date.fromisoformat(original)
    n = digest(key, employee_id, "birth_date")
    shift = timedelta(days=1 + n % MAX_SHIFT)
    moved = born + shift if n & (1 << 40) else born - shift
    if moved.year != born.year:   # a shift that leaves the year goes the other way, which cannot
        moved = born - shift if moved > born else born + shift
    return moved.isoformat()


class Identifiers:
    """Masked national IDs and emails: one per worker, never a value already taken.

    Taken means any original value of that column (so a masked ID is never somebody's real
    one) or a masked value already given to another worker (so they stay unique). A worker
    entered twice gets the same value on both rows."""

    def __init__(self, key: bytes, rows: list[dict]):
        self.key = key
        self.given: dict[tuple[str, str], str] = {}
        self.taken = {column: {r[column] for r in rows} for column in ("national_id", "personal_email")}

    def get(self, employee_id: str, column: str, make) -> str:
        if (employee_id, column) not in self.given:
            for attempt in range(50):
                value = make(f"{digest(self.key, employee_id, column, attempt) % 10**8:08d}")
                if value not in self.taken[column]:
                    break
            else:
                raise ValueError(f"no masked {column} for {employee_id}")
            self.taken[column].add(value)
            self.given[(employee_id, column)] = value
        return self.given[(employee_id, column)]


def mask_worker(key: bytes, row: dict, ids: Identifiers) -> dict:
    out = dict(row)
    worker = row["employee_id"]
    out["first_name"] = mask_name(key, worker, "first_name", row["first_name"])
    out["last_name"] = mask_name(key, worker, "last_name", row["last_name"])
    out["birth_date"] = mask_birth_date(key, worker, row["birth_date"])
    if not blank(row["personal_email"]):
        out["personal_email"] = ids.get(worker, "personal_email", lambda d: f"w{d}@example.com")
    if not blank(row["national_id"]):
        out["national_id"] = ids.get(worker, "national_id", lambda d: "0" + d)
    return out


def write(legacy_dir: Path, out_dir: Path, key: bytes) -> None:
    """The whole extract, with workers.csv masked and every other file copied byte for byte."""
    if not key:
        raise ValueError("masking needs a key")
    out_dir.mkdir(parents=True, exist_ok=True)
    for path in legacy_dir.iterdir():
        if path.is_file() and path.name != "workers.csv":
            shutil.copyfile(path, out_dir / path.name)
    rows, trailer = extract.parse_csv("workers.csv", (legacy_dir / "workers.csv").read_text(encoding="utf-8"))
    ids = Identifiers(key, [r.data for r in rows])
    masked = [mask_worker(key, r.data, ids) for r in rows]
    text = legacy.to_csv(legacy.WORKER_COLUMNS, masked, trailer)
    (out_dir / "workers.csv").write_bytes(text.encode("utf-8"))


@dataclass
class Check:
    name: str
    passed: bool
    detail: str


def verify(legacy_dir: Path, masked_dir: Path) -> list[Check]:
    """Prove the masked copy hides everyone and still behaves like the original."""
    def workers(folder: Path) -> list[dict]:
        return [r.data for r in extract.parse_csv("workers.csv", (folder / "workers.csv").read_text(encoding="utf-8"))[0]]

    before, after = workers(legacy_dir), workers(masked_dir)
    checks = []
    same_rows = len(before) == len(after) and all(
        {k: v for k, v in a.items() if k not in MASKED} == {k: v for k, v in b.items() if k not in MASKED}
        for a, b in zip(after, before))
    checks.append(Check("Only the personal columns changed", same_rows,
                        f"{len(after)} worker rows; every other column as it was" if same_rows else
                        "a row or a column outside the masked ones changed"))

    kept = [f"{b['employee_id']} {c}" for a, b in zip(after, before) for c in MASKED if not blank(b[c]) and a[c] == b[c]]
    checks.append(Check("No personal value is kept on its row", not kept,
                        f"{len(kept)} kept: {', '.join(kept[:5])}" if kept else
                        f"all {len(MASKED)} columns changed on every row that had them"))

    # The files of the copy only (the legacy file names), not whatever else is in the folder
    names = sorted(p.name for p in legacy_dir.iterdir() if p.is_file())
    text = "\n".join((masked_dir / n).read_text(encoding="utf-8") for n in names)
    leaked = sorted({b[c] for b in before for c in ("national_id", "personal_email") if not blank(b[c]) and b[c] in text})
    checks.append(Check("No national ID or email appears anywhere in the masked files", not leaked,
                        f"{len(leaked)} found" if leaked else
                        f"none of {len({b['national_id'] for b in before})} national IDs or the emails"))

    ids = {}
    for a in after:
        ids.setdefault(a["national_id"], set()).add(a["employee_id"])
    shared = [n for n, people in ids.items() if not blank(n) and len(people) > 1]
    checks.append(Check("Masked national IDs stay unique", not shared,
                        f"{len(shared)} shared by two workers" if shared else f"{len(ids)} IDs, one worker each"))

    original = {f.ident() for f in convert.convert(extract.read(legacy_dir)).findings}
    masked = {f.ident() for f in convert.convert(extract.read(masked_dir)).findings}
    same = original == masked
    checks.append(Check("The checks find the same problems in the masked copy", same,
                        f"{len(masked)} findings, the same rule, file, key and field as the original" if same else
                        f"{len(original - masked)} lost, {len(masked - original)} new"))
    return checks
