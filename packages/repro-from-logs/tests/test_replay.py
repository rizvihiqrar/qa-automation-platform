"""The replay and its matching rules, against a fake API: no server, so these run in milliseconds."""
import pytest

from repro.logs import Entry
from repro.replay import World, matches, replay


def entry(status=400, error="Nope", path="/orders", user="sam", body=None, line=1):
    return Entry(line=line, time="t", method="POST", path=path, user=user, body=body, status=status, error=error)


class FakeApi:
    """Answers like a small API and keeps every request it was sent."""

    def __init__(self, answer=(400, {"error": "Nope"})):
        self.answer = answer
        self.calls = []
        self.next_product = 100

    def send(self, method, path, token, body):
        self.calls.append((method, path, token, body))
        if path == "/auth/register":
            return 201, {"token": f"token-for-{body['email'].split('@')[0]}"}
        if path == "/products":
            self.next_product += 1
            return 201, {"id": self.next_product}
        return self.answer


CASE = {"id": "T-1"}


# ---- when a replay counts as the same failure ----------------------------------------
def test_same_status_and_same_words_is_the_same_failure():
    assert matches(entry(400, "Insufficient stock for product 3 (available: 2)"), 400,
                   "Insufficient stock for product 41 (available: 0)")


@pytest.mark.parametrize("status, error", [
    (422, "Nope"),            # another status
    (400, "Something else"),  # the same status for another reason
    (400, None),              # no error text at all
    (201, None),              # it worked
])
def test_anything_else_is_not_the_same_failure(status, error):
    assert not matches(entry(400, "Nope"), status, error)


def test_a_log_line_with_no_error_text_is_matched_on_status_alone():
    assert matches(entry(200, None), 200, "ignored")
    assert not matches(entry(200, None), 201, None)


# ---- replaying -----------------------------------------------------------------------
def test_a_log_with_no_failed_request_is_refused_not_replayed():
    api = FakeApi()
    with pytest.raises(ValueError, match="nothing to reproduce"):
        replay(CASE, [entry(200, None)], api.send, "admin-token")
    assert api.calls == []


def test_a_replay_that_gets_the_logged_answer_is_a_reproduction():
    outcome = replay(CASE, [entry()], FakeApi().send, "admin-token")
    assert outcome.reproduced and outcome.mismatches == [] and outcome.replayed == 1


def test_every_mismatch_is_listed_with_its_log_line():
    api = FakeApi(answer=(201, {}))
    outcome = replay(CASE, [entry(line=4), entry(status=201, error=None, line=7), entry(line=9)], api.send, "admin-token")
    assert not outcome.reproduced
    assert [m.line for m in outcome.mismatches] == [4, 9]
    assert str(outcome.mismatches[0]) == "line 4: the log has 400 'Nope', the replay gave 201"


def test_each_user_is_a_separate_account_and_the_admin_and_anonymous_are_not_created():
    api = FakeApi()
    replay(CASE, [entry(user="sam"), entry(user="lee"), entry(user="sam"), entry(user="admin"), entry(user="anonymous")],
           api.send, "admin-token")
    registered = [c for c in api.calls if c[1] == "/auth/register"]
    assert len(registered) == 2
    tokens = [c[2] for c in api.calls if c[1] == "/orders"]
    assert tokens[0].startswith("token-for-sam") and tokens[1].startswith("token-for-lee")
    assert tokens[2] == tokens[0], "the same user keeps the same account"
    assert tokens[3:] == ["admin-token", None]


def test_logged_product_ids_become_the_ids_on_this_server():
    api = FakeApi()
    case = {"id": "T-2", "setup": {"products": [{"logged_id": 3, "name": "Gnome", "price": 1, "stock": 1}]}}
    replay(case, [entry(body={"items": [{"product_id": 3, "quantity": 5}]}), entry(path="/products/3")],
           api.send, "admin-token")
    order, product = [c for c in api.calls if c[1] != "/auth/register" and c[1] != "/products"]
    assert order[3] == {"items": [{"product_id": 101, "quantity": 5}]}
    assert product[1] == "/products/101"


def test_emails_and_codes_get_names_nobody_used_before():
    world = World(FakeApi().send, "admin-token")
    other = World(FakeApi().send, "admin-token")
    assert world.email("pat@example.com") == world.email("pat@example.com")
    assert world.email("pat@example.com") != other.email("pat@example.com")
    code = world.code("WELCOME5")
    assert code != "WELCOME5" and code.startswith("WELCOME5") and 3 <= len(code) <= 20
    assert len(world.code("A" * 20)) <= 20, "a long code is cut to fit"
    assert world.path("/discounts/WELCOME5") == f"/discounts/{code}"
    assert world.body({"discount_code": "WELCOME5", "email": "pat@example.com"}) == {
        "discount_code": code, "email": world.email("pat@example.com")}


# ---- checking a fix --------------------------------------------------------------------
def test_with_the_fix_every_request_that_failed_must_now_succeed():
    fixed = replay({"id": "T-3", "fix": {}}, [entry(line=2)], FakeApi(answer=(201, {})).send, "admin-token", with_fix=True)
    assert fixed.fixed is True and fixed.mismatches == []

    still_failing = replay({"id": "T-3", "fix": {}}, [entry(line=2)], FakeApi().send, "admin-token", with_fix=True)
    assert still_failing.fixed is False
    assert str(still_failing.mismatches[0]) == "line 2: the log has a success after the fix, the replay gave 400 'Nope'"


def test_a_fix_step_that_is_refused_stops_the_replay_with_a_clear_error():
    case = {"id": "T-4", "fix": {"steps": [{"method": "PATCH", "path": "/discounts/X", "body": {}}]}}
    with pytest.raises(RuntimeError, match="fix step PATCH /discounts/X was refused: 400"):
        replay(case, [entry()], FakeApi().send, "admin-token", with_fix=True)


# ---- review findings: names, regressions, masked passwords, one bad case ------------------
def test_a_log_user_and_a_set_up_account_with_the_same_first_name_do_not_collide():
    world = World(FakeApi().send, "admin-token")
    assert world.email("pat@users.test") != world.email("pat@example.com")
    assert world.email("sam@a.com") != world.email("sam@b.com")


def test_a_fix_that_breaks_a_request_that_used_to_work_is_not_verified():
    class Api(FakeApi):
        def send(self, method, path, token, body):
            super().send(method, path, token, body)
            if path in ("/auth/register", "/products"):
                return super().send(method, path, token, body)
            return (201, {}) if path == "/was-broken" else (400, {"error": "now broken"})

    entries = [entry(path="/was-broken", line=1), entry(status=201, error=None, path="/worked", line=2)]
    fixed = replay({"id": "T-5", "fix": {}}, entries, Api().send, "admin-token", with_fix=True)
    assert fixed.fixed is False
    assert str(fixed.mismatches[0]) == "line 2: the log has 201, as before the fix, the replay gave 400 'now broken'"


def test_a_masked_password_is_real_when_the_request_worked_and_wrong_when_it_was_refused():
    api = FakeApi(answer=(200, {}))
    case = {"id": "T-6", "setup": {"accounts": [{"email": "pat@example.com", "password": "Real-pass-1!"}]}}
    login = {"email": "pat@example.com", "password": "[masked]"}
    replay(case, [entry(status=200, error=None, path="/auth/login", user="anonymous", body=login),
                  entry(status=401, error="Invalid credentials", path="/auth/login", user="anonymous", body=login, line=2)],
           api.send, "admin-token")
    sent = [c[3]["password"] for c in api.calls if c[1] == "/auth/login"]
    assert sent == ["Real-pass-1!", "[masked]"]
