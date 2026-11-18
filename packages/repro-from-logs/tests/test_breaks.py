"""Deliberate breaks: each one puts a mistake back and shows a check can see it.

A reproduction that always says "reproduced" is worth nothing, so these run the real
replay against the wrong build, a changed log or a missing fix and expect it to say so.
"""
import copy

from repro.cases import load_cases, load_log, run_case
from repro.replay import replay

CASES = {c["id"]: c for c in load_cases()}


def test_the_flag_case_does_not_reproduce_on_a_build_with_discount_codes_on(pool):
    # The customer's log came from a deployment with codes off. On the normal build the same orders succeed.
    wrong_build = copy.deepcopy(CASES["RFL-02"])
    wrong_build["flags"] = ""
    outcome = run_case(wrong_build, pool)
    assert not outcome.reproduced
    assert [m.line for m in outcome.mismatches] == [1, 2]
    assert "201" in str(outcome.mismatches[0])


def test_a_fix_that_changes_nothing_is_not_verified(pool):
    # "Fixed" by restarting with the same flags the failure came from: the orders are still refused.
    no_fix = copy.deepcopy(CASES["RFL-02"])
    no_fix["fix"] = {"flags": "discount-codes:off"}
    fixed = run_case(no_fix, pool, with_fix=True)
    assert fixed.fixed is False
    assert len(fixed.mismatches) == 2


def test_a_data_fix_that_does_nothing_is_not_verified(pool):
    # Raising the limit on a different field leaves the code used up.
    wrong_step = copy.deepcopy(CASES["RFL-04"])
    wrong_step["fix"] = {"steps": [{"method": "PATCH", "path": "/discounts/WELCOME5", "body": {"active": True}}]}
    assert run_case(wrong_step, pool, with_fix=True).fixed is False


def test_a_log_whose_error_words_changed_is_not_a_reproduction(pool):
    case = CASES["RFL-01"]
    entries = load_log(case).entries
    edited = [e.__class__(**{**e.__dict__, "error": "Out of stock"}) if e.failed else e for e in entries]
    build = pool.build(case.get("flags", ""))
    outcome = replay(case, edited, build.send, build.admin_token)
    assert not outcome.reproduced
    assert "Out of stock" in str(outcome.mismatches[0])


def test_a_log_whose_status_changed_is_not_a_reproduction(pool):
    case = CASES["RFL-05"]
    entries = load_log(case).entries
    edited = [e.__class__(**{**e.__dict__, "status": 422}) if e.failed else e for e in entries]
    build = pool.build("")
    assert not replay(case, edited, build.send, build.admin_token).reproduced


def test_a_server_error_in_the_log_is_not_rebuilt_from_the_request_alone(pool):
    outcome = run_case(CASES["RFL-06"], pool)
    assert not outcome.reproduced
    assert "500" in str(outcome.mismatches[0]) and "201" in str(outcome.mismatches[0])
