"""python -m repro: replay every case and print what came back.

Exit code 1 when a case does something other than what its `expect` says, or a fix does
not make the failed requests succeed.
"""
import sys

from .cases import load_cases, load_log, run_case
from .server import Pool


def main() -> int:
    cases = load_cases()
    pool = Pool()
    problems = 0
    reproduced = fixes_checked = fixes_ok = 0
    try:
        for case in cases:
            parsed = load_log(case)
            try:
                outcome = run_case(case, pool)
            except (ValueError, RuntimeError) as err:
                # One case that cannot be replayed (no failed request in its log, a set-up the
                # API refused) is reported by itself. The others still run.
                print(f"{case['id']}  CANNOT RUN       {case['title']}")
                print(f"        {err}")
                problems += 1
                continue
            expected = case["expect"] == "reproduces"
            ok = outcome.reproduced == expected
            reproduced += outcome.reproduced
            verdict = "reproduced" if outcome.reproduced else "NOT reproduced"
            print(f"{case['id']}  {verdict:<15} {case['title']}" + ("" if ok else "   <- not what the case expects"))
            if parsed.skipped:
                print("        skipped lines: " + ", ".join(f"{n} ({why})" for n, why in parsed.skipped))
            for mismatch in outcome.mismatches:
                print(f"        {mismatch}")
            if not ok:
                problems += 1
            if "fix" in case:
                fixes_checked += 1
                try:
                    fixed = run_case(case, pool, with_fix=True)
                except (ValueError, RuntimeError) as err:
                    print(f"        fix: CANNOT RUN, {err}")
                    problems += 1
                    continue
                fixes_ok += bool(fixed.fixed)
                print(f"        fix: {'verified, the failed requests now succeed' if fixed.fixed else 'NOT verified'}")
                for mismatch in fixed.mismatches:
                    print(f"        {mismatch}")
                if not fixed.fixed:
                    problems += 1
    finally:
        pool.close()
    print(f"\n{reproduced} of {len(cases)} failures reproduced from the log set; {fixes_ok} of {fixes_checked} fixes verified")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
