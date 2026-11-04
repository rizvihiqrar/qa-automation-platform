"""Reconciliation: a correct target passes, and each way a target can go wrong is caught.

The faults are put into the mock API's load step (process), the way a real target might
trim, round or drop data without saying so. The checks only read what the reports return.
"""
import pytest

from hcm_conv import convert, extract, mock_api, reconcile


def run_cycle1(api):
    source = extract.read()
    return reconcile.reconcile(api, convert.convert(source), source)


def checks(result):
    return {c.name: c.passed for c in result.checks}


def with_fault(monkeypatch, fault):
    """After each load, let fault(tenant, load_number) change what the target stored."""
    original = mock_api.process
    loads = []

    def faulty(tenant, sheets, save):
        result = original(tenant, sheets, save)
        if save:
            loads.append(1)
            fault(tenant, len(loads))
        return result
    monkeypatch.setattr(mock_api, "process", faulty)


def test_a_correct_target_passes_every_check_but_completeness(api):
    result = run_cycle1(api)
    failed = [name for name, ok in checks(result).items() if not ok]
    assert failed == ["Every loaded worker has compensation"]   # 3 compensation rows held in cycle 1
    assert result.findings == []
    assert result.load == {"validate_only": "Completed", "load": "Completed", "rows": 1116, "loaded": 1116, "rejected": 0}


def test_a_target_that_strips_accents_is_caught_field_by_field(api, monkeypatch):
    import unicodedata

    def strip(tenant, n):
        for w in tenant.records["Workers"].values():
            w["given_name"] = unicodedata.normalize("NFKD", w["given_name"]).encode("ascii", "ignore").decode()
    with_fault(monkeypatch, strip)
    result = run_cycle1(api)
    assert not checks(result)["Row hashes match"]
    assert checks(result)["Hash total: worker IDs"]   # counts and sums can't see it: that is why row hashes exist
    mismatches = [f for f in result.findings if f.rule == "RECON_MISMATCH"]
    assert mismatches and {f.field for f in mismatches} == {"given_name"}
    assert any("René" in f.message for f in mismatches)


def test_a_target_that_rounds_salaries_fails_the_hash_total(api, monkeypatch):
    def round_pay(tenant, n):
        for c in tenant.records["Compensation"].values():
            c["annual_amount"] = f"{round(float(c['annual_amount'])):.2f}"
    with_fault(monkeypatch, round_pay)
    result = run_cycle1(api)
    assert not checks(result)["Hash total: annual salaries"]
    assert not checks(result)["Row hashes match"]


def test_a_row_the_target_drops_silently_is_caught(api, monkeypatch):
    def drop_one(tenant, n):
        tenant.records["Pay Results"].pop(next(iter(tenant.records["Pay Results"])))
    with_fault(monkeypatch, drop_one)
    result = run_cycle1(api)
    assert not checks(result)["Row counts balance"]
    assert not checks(result)["Hash totals: pay per period"]
    assert [f.rule for f in result.findings] == ["RECON_MISSING"]


def test_a_rerun_that_adds_copies_is_caught(api, monkeypatch):
    def copy_on_second_load(tenant, n):
        if n == 2:
            workers = tenant.records["Workers"]
            for key, w in list(workers.items())[:5]:
                workers[key + ("again",)] = dict(w)
    with_fault(monkeypatch, copy_on_second_load)
    result = run_cycle1(api)
    assert not checks(result)["Rerun adds and changes nothing"]
    assert "duplicate keys {'Organizations': 0, 'Positions': 0, 'Workers': 5" in next(
        c.detail for c in result.checks if c.name == "Rerun adds and changes nothing")
    assert checks(result)["Row counts balance"]   # the first load was fine


def test_rows_the_target_refuses_are_reported_and_still_balance(api, monkeypatch):
    monkeypatch.setitem(mock_api.CODES, "frequency", {"Weekly", "Biweekly", "Monthly"})   # no Semimonthly
    result = run_cycle1(api)
    rejected = [f for f in result.findings if f.rule == "TARGET_REJECTED"]
    assert rejected and all(f.field in ("frequency", "worker_id") for f in rejected)
    assert {f.file for f in rejected} == {"compensation.csv"}
    assert not checks(result)["Target accepts every row sent"]
    assert checks(result)["Row counts balance"]          # source = held + loaded + rejected still holds
    comp = next(c for c in result.counts if c.sheet == "Compensation")
    assert comp.rejected == len(rejected) and comp.target == comp.loaded


def test_the_source_side_of_the_pay_totals_is_read_with_sql(api):
    source = extract.read()
    conversion = convert.convert(source)
    reconcile.reconcile(api, conversion, source)
    sent = source.payroll.execute("SELECT count(*) FROM temp.sent").fetchone()[0]
    assert sent == len(conversion.sent("Pay Results")) == 499


def test_payroll_keys_with_spaces_still_count_in_the_pay_hash_totals(api):
    source = extract.read()
    source.payroll.execute("UPDATE pay_results SET employee_id = employee_id || ' ' WHERE period_id = 'P2026-21'")
    conversion = convert.convert(source)
    assert sum(r.key.endswith("/P2026-21") for r in conversion.sent("Pay Results")) == 167   # still sent, not held
    result = reconcile.reconcile(api, conversion, source)
    assert checks(result)["Hash totals: pay per period"]
