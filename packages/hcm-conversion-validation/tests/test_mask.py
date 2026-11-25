"""Masking: nobody real is left in the copy, and the copy still breaks the same rules."""
import csv
import re
from datetime import date

import pytest

from hcm_conv import __main__ as cli
from hcm_conv import convert, mask
from hcm_conv.legacy import LEGACY_DIR

KEY = b"test-only-key"


def workers(folder):
    return list(csv.DictReader((folder / "workers.csv").read_text(encoding="utf-8").splitlines()))[:-1]   # no trailer


@pytest.fixture(scope="module")
def masked(tmp_path_factory):
    out = tmp_path_factory.mktemp("masked")
    mask.write(LEGACY_DIR, out, KEY)
    return out


@pytest.fixture(scope="module")
def pairs(masked):
    return list(zip(workers(LEGACY_DIR), workers(masked)))


@pytest.mark.req("MK-01", "MK-02", "MK-03", "MK-04", "MK-05")
def test_every_check_passes_on_a_fresh_masked_copy(masked):
    checks = mask.verify(LEGACY_DIR, masked)
    assert [c.passed for c in checks] == [True] * 5
    assert checks[-1].detail.startswith("68 findings")


@pytest.mark.req("MK-07")
def test_the_same_key_gives_the_same_bytes_and_another_key_does_not(masked, tmp_path):
    mask.write(LEGACY_DIR, tmp_path / "again", KEY)
    mask.write(LEGACY_DIR, tmp_path / "other", b"another-key")
    assert (tmp_path / "again" / "workers.csv").read_bytes() == (masked / "workers.csv").read_bytes()
    other = workers(tmp_path / "other")
    assert all(a["national_id"] != b["national_id"] for a, b in zip(workers(masked), other))


@pytest.mark.req("MK-01")
def test_only_workers_csv_changes(masked):
    for path in LEGACY_DIR.iterdir():
        if path.name != "workers.csv":
            assert (masked / path.name).read_bytes() == path.read_bytes(), path.name


@pytest.mark.req("MK-06")
def test_national_ids_keep_their_shape(pairs):
    assert all(re.fullmatch(r"0\d{8}", m["national_id"]) for _, m in pairs)


@pytest.mark.req("MK-06")
def test_birth_dates_move_1_to_180_days_inside_the_same_year(pairs):
    for o, m in pairs:
        before, after = date.fromisoformat(o["birth_date"]), date.fromisoformat(m["birth_date"])
        assert after.year == before.year and 1 <= abs((after - before).days) <= mask.MAX_SHIFT


@pytest.mark.req("MK-05", "MK-06")
def test_names_keep_blanks_accents_and_garbling(pairs):
    seen = set()
    for o, m in pairs:
        for column in ("first_name", "last_name"):
            if o[column] == "":
                assert m[column] == ""
                seen.add("blank")
            elif convert.MOJIBAKE.search(o[column]):
                assert convert.MOJIBAKE.search(m[column])
                seen.add("garbled")
            else:
                assert any(ord(c) > 127 for c in o[column]) == any(ord(c) > 127 for c in m[column])
                seen.add("accented" if any(ord(c) > 127 for c in o[column]) else "plain")
    assert seen == {"blank", "garbled", "accented", "plain"}


@pytest.mark.req("MK-05")
def test_a_worker_entered_twice_is_masked_the_same_way_on_both_rows(pairs):
    by_id = {}
    for _, m in pairs:
        by_id.setdefault(m["employee_id"], []).append(m)
    twice = [rows for rows in by_id.values() if len(rows) == 2]
    assert len(twice) == 2
    for a, b in twice:
        assert all(a[c] == b[c] for c in mask.MASKED)


def broken_copy(masked, tmp_path, change):
    """A masked copy with one thing done wrong, to show verify() notices."""
    out = tmp_path / "broken"
    out.mkdir()
    for path in masked.iterdir():
        (out / path.name).write_bytes(path.read_bytes())
    text = (out / "workers.csv").read_text(encoding="utf-8")
    (out / "workers.csv").write_bytes(change(text).encode("utf-8"))
    return out


def failed(folder):
    return [c.name for c in mask.verify(LEGACY_DIR, folder) if not c.passed]


@pytest.mark.req("MK-02", "MK-03")
def test_verify_notices_a_real_national_id_left_in(masked, pairs, tmp_path):
    o, m = pairs[0]
    folder = broken_copy(masked, tmp_path, lambda t: t.replace(m["national_id"], o["national_id"], 1))
    assert failed(folder) == ["No personal value is kept on its row",
                              "No national ID or email appears anywhere in the masked files"]


@pytest.mark.req("MK-01")
def test_verify_notices_a_column_outside_the_personal_ones_changed(masked, pairs, tmp_path):
    _, m = pairs[0]
    folder = broken_copy(masked, tmp_path, lambda t: t.replace(m["hire_date"], "2000-01-01", 1))
    assert "Only the personal columns changed" in failed(folder)


@pytest.mark.req("MK-05")
def test_verify_notices_a_defect_the_masking_cleaned_away(masked, pairs, tmp_path):
    _, m = next((o, m) for o, m in pairs if convert.MOJIBAKE.search(o["first_name"]))
    folder = broken_copy(masked, tmp_path, lambda t: t.replace(m["first_name"], "Plain", 1))
    assert failed(folder) == ["The checks find the same problems in the masked copy"]


@pytest.mark.req("MK-04")
def test_verify_notices_two_workers_sharing_a_masked_id(masked, pairs, tmp_path):
    (_, a), (_, b) = pairs[0], pairs[5]
    folder = broken_copy(masked, tmp_path, lambda t: t.replace(b["national_id"], a["national_id"]))
    assert failed(folder) == ["Masked national IDs stay unique"]


@pytest.mark.parametrize("original", ["1990-02-30", "19900101", "15/03/1990"])
@pytest.mark.req("MK-05", "MK-06")
def test_a_birth_date_that_is_not_a_valid_date_gets_other_digits_and_stays_invalid(original):
    value = mask.mask_birth_date(KEY, "001234", original)
    assert value != original and not mask.valid_date(value)
    assert [c.isdigit() for c in value] == [c.isdigit() for c in original]
    assert mask.mask_birth_date(KEY, "001234", original) == value


@pytest.mark.req("MK-05")
def test_new_digits_that_make_a_valid_date_are_tried_again(monkeypatch):
    # Digit i moves by digit i of the hash: 8900000000 turns 1990-02-30 into 1990-02-28, a real day
    monkeypatch.setattr(mask, "digest", lambda key, worker, column, attempt=0: 8_900_000_000 if attempt == 0 else attempt)
    value = mask.mask_birth_date(KEY, "001234", "1990-02-30")
    assert value == "2990-02-30" and not mask.valid_date(value)


@pytest.mark.req("MK-05", "MK-06")
def test_a_blank_made_of_spaces_stays_as_it_is():
    row = {"employee_id": "001234", "first_name": " ", "last_name": "  ", "birth_date": " ",
           "personal_email": " ", "national_id": " "}
    assert mask.mask_worker(KEY, row, mask.Identifiers(KEY, [row])) == row


@pytest.mark.req("MK-04")
def test_a_masked_id_is_never_a_real_one_and_never_shared(monkeypatch):
    # Every worker's first try gives the same digits: the second worker must move on, and so
    # must a worker whose try equals someone's real national ID
    monkeypatch.setattr(mask, "digest", lambda key, worker, column, attempt=0: attempt)
    rows = [{"national_id": "000000001", "personal_email": "a@example.com"},
            {"national_id": "000000000", "personal_email": "b@example.com"}]
    ids = mask.Identifiers(KEY, rows)
    first = ids.get("000001", "national_id", lambda d: "0" + d)
    second = ids.get("000002", "national_id", lambda d: "0" + d)
    assert first == "000000002" and second == "000000003"   # 0 and 1 are real IDs, 2 is taken
    assert ids.get("000001", "national_id", lambda d: "0" + d) == first   # the same worker again


@pytest.mark.req("MK-01")
def test_other_files_in_the_folder_are_not_part_of_the_copy(masked, tmp_path):
    folder = broken_copy(masked, tmp_path, lambda t: t)
    (folder / "old-backup.csv").write_bytes((LEGACY_DIR / "workers.csv").read_bytes())
    assert failed(folder) == []


@pytest.mark.req("MK-07")
def test_masking_needs_a_key(tmp_path):
    with pytest.raises(ValueError):
        mask.write(LEGACY_DIR, tmp_path, b"")


@pytest.mark.req("MK-07")
def test_the_command_needs_a_key_and_then_checks_its_copy(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("HCM_MASK_KEY", raising=False)
    assert cli.main(["mask", "--out", str(tmp_path)]) == 2
    monkeypatch.setenv("HCM_MASK_KEY", "ci-key")
    assert cli.main(["mask", "--out", str(tmp_path)]) == 0
    assert capsys.readouterr().out.count("PASS") == 5
