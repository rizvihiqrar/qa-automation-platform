"""The legacy extract: fake, repeatable, and its answer key matches what is in the files."""
import json

from hcm_conv import extract, legacy

KEY = json.loads((legacy.LEGACY_DIR / "defects.json").read_text(encoding="utf-8"))


def test_the_committed_extract_is_exactly_what_the_generator_writes(tmp_path):
    # A hand edit, or a Faker upgrade that changes the names, would move every expected count.
    legacy.write(tmp_path)
    for name in legacy.render(legacy.generate()):
        assert (tmp_path / name).read_bytes() == (legacy.LEGACY_DIR / name).read_bytes(), name


def test_the_sizes_are_the_ones_the_readme_gives():
    source = extract.read()
    assert len(source.table("workers.csv")) == 200
    assert len(source.table("positions.csv")) == 230
    assert len(source.table("organizations.csv")) == 20
    assert len(source.table("compensation.csv")) == 198
    assert source.payroll.execute("SELECT count(*) FROM pay_periods").fetchone()[0] == 3


def test_there_are_twenty_seeded_defects_of_eight_kinds():
    assert [d["id"] for d in KEY] == [f"D-{n:02d}" for n in range(1, 21)]
    assert len({d["type"] for d in KEY}) == 8


def test_every_defect_points_at_a_line_that_shows_it():
    source = extract.read()
    for d in KEY:
        if d["file"] == "payroll.sql":
            employee, period = d["key"].split("/")
            assert source.payroll.execute("SELECT 1 FROM pay_results WHERE employee_id=? AND period_id=?",
                                          (employee, period)).fetchone(), d["id"]
            continue
        if d["key"] == "TRAILER":
            assert source.trailers[d["file"]]["line"] == d["line"], d["id"]
            continue
        row = next(r for r in source.table(d["file"]) if r.line == d["line"])
        key_field = "position_id" if d["file"] == "positions.csv" else "employee_id"
        assert row.data[key_field] == d["key"], d["id"]


def test_the_data_is_fake():
    source = extract.read()
    for row in source.table("workers.csv"):
        assert row.data["personal_email"].endswith("@example.com")
        assert row.data["national_id"].startswith("0")   # no real SIN starts with 0


def test_real_accents_are_kept_alongside_the_garbled_ones():
    names = [r.data["first_name"] + " " + r.data["last_name"] for r in extract.read().table("workers.csv")]
    garbled = [n for n in names if "Ã" in n]
    accented = [n for n in names if any(ord(c) > 127 for c in n) and "Ã" not in n]
    assert len(garbled) == 2
    assert len(accented) > 20
