"""Reading a log: what is kept, what is skipped, and how error text is compared."""
import json

from repro.logs import normalize_error, parse_log


def line(**fields):
    return json.dumps({"time": "2026-11-17T10:00:00Z", "method": "GET", "path": "/products", "status": 200, **fields})


def test_a_request_line_is_read_with_its_fields():
    log = parse_log(line(method="post", path="/orders", user="sam", body={"a": 1}, status=400, error="no"))
    (entry,) = log.entries
    assert (entry.method, entry.path, entry.user, entry.body, entry.status, entry.error) == (
        "POST", "/orders", "sam", {"a": 1}, 400, "no")
    assert entry.failed


def test_a_line_with_no_user_is_anonymous_and_a_2xx_is_not_a_failure():
    (entry,) = parse_log(line()).entries
    assert entry.user == "anonymous"
    assert not entry.failed


def test_lines_that_are_not_requests_are_skipped_with_their_line_number():
    text = "\n".join([
        "2026-11-17T09:00:00Z INFO server started",   # 1: not JSON
        "",                                            # 2: blank, ignored without a mention
        line(),                                        # 3: kept
        '{"time": "2026-11-17T10:00:00Z", "meth',      # 4: cut off when the file was copied
        json.dumps(["not", "an", "object"]),           # 5
        json.dumps({"time": "t", "method": "GET"}),    # 6: no path, no status
        line(status="400"),                            # 7: status is text
        line(status=True),                             # 8: a boolean is not a status
    ])
    log = parse_log(text)
    assert [e.line for e in log.entries] == [3]
    assert log.skipped == [
        (1, "not JSON"), (4, "not JSON"), (5, "not a JSON object"),
        (6, "no path, status"), (7, "status is not a number"), (8, "status is not a number"),
    ]


def test_entries_are_replayed_in_time_order_and_ties_keep_the_file_order():
    text = "\n".join([
        line(time="2026-11-17T10:00:05Z", path="/c"),
        line(time="2026-11-17T10:00:01Z", path="/a1"),
        line(time="2026-11-17T10:00:01Z", path="/a2"),
        line(time="2026-11-17T10:00:03Z", path="/b"),
    ])
    assert [e.path for e in parse_log(text).entries] == ["/a1", "/a2", "/b", "/c"]


def test_error_text_matches_when_only_numbers_differ():
    assert normalize_error("Insufficient stock for product 3 (available: 2)") == \
        normalize_error("Insufficient stock for product 41 (available: 0)")
    assert normalize_error("Product 3 not found") != normalize_error("Order 3 not found")
    assert normalize_error(None) == ""


def test_times_in_different_formats_sort_by_when_they_happened():
    text = "\n".join([
        line(time="2026-11-17T14:02:11.500Z", path="/b"),
        line(time="2026-11-17T09:02:12-05:00", path="/c"),   # 14:02:12Z
        line(time="2026-11-17T14:02:11Z", path="/a"),
        line(time="not a time", path="/first"),
    ])
    # Sorted as text, "11.500Z" would come before "11Z" and "09:02:12-05:00" would come first of all.
    assert [e.path for e in parse_log(text).entries] == ["/first", "/a", "/b", "/c"]
