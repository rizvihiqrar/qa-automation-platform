"""Load the cases in cases/cases.json and the log file each one names."""
import json
from pathlib import Path

from .logs import ParsedLog, parse_log
from .replay import Outcome, replay
from .server import Pool

CASES_DIR = Path(__file__).resolve().parents[1] / "cases"
EXPECTATIONS = ("reproduces", "does-not-reproduce")
REQUIRED = ("id", "title", "report", "log", "expect", "why")


def load_cases() -> list:
    cases = json.loads((CASES_DIR / "cases.json").read_text(encoding="utf-8"))
    for case in cases:
        missing = [k for k in REQUIRED if k not in case]
        if missing:
            raise ValueError(f"{case.get('id', '?')}: missing {', '.join(missing)}")
        if case["expect"] not in EXPECTATIONS:
            raise ValueError(f"{case['id']}: expect must be one of {', '.join(EXPECTATIONS)}")
    ids = [c["id"] for c in cases]
    if len(set(ids)) != len(ids):
        raise ValueError("two cases share an ID")
    return cases


def load_log(case: dict) -> ParsedLog:
    return parse_log((CASES_DIR / case["log"]).read_text(encoding="utf-8"))


def run_case(case: dict, pool: Pool, with_fix: bool = False) -> Outcome:
    """Replay a case on the build its log came from (or, with the fix, on the fixed build)."""
    flags = (case["fix"].get("flags") if with_fix and case["fix"].get("flags") is not None else case.get("flags", ""))
    build = pool.build(flags)
    return replay(case, load_log(case).entries, build.send, build.admin_token, with_fix=with_fix)
