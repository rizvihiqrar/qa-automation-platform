"""Rebuild a case's world, replay its log against an API, and say whether the failure came back.

A case is a customer report plus the log of what they did. Replaying has four steps:

1. Set up what the customer's system already had (products, accounts, discount codes),
   under names that cannot clash with an earlier case on the same server.
2. Optionally apply a fix (steps run as the admin) before replaying.
3. Replay every logged request in time order as the same kind of user.
4. Compare each answer with the logged one: the status and the error text, numbers aside.

`send` is the only thing that touches the network, so the matching rules can be tested
without a server.
"""
import itertools
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .logs import Entry, normalize_error

# send(method, path, token, body) -> (status, json body or None)
Send = Callable[[str, str, Optional[str], Any], tuple]

PASSWORD = "Pass123!"
MASKED = "[masked]"
_ids = itertools.count(1)


@dataclass
class Mismatch:
    line: int
    wanted: str
    got: str

    def __str__(self) -> str:
        return f"line {self.line}: the log has {self.wanted}, the replay gave {self.got}"


@dataclass
class Outcome:
    case_id: str
    reproduced: bool
    mismatches: list = field(default_factory=list)
    replayed: int = 0
    fixed: Optional[bool] = None  # None: the case has no fix to check


def describe(status: int, error: Optional[str]) -> str:
    return f"{status} {error!r}" if error else str(status)


def matches(entry: Entry, status: int, error: Optional[str]) -> bool:
    """The same answer: the same status and, when the log kept an error, the same words."""
    if status != entry.status:
        return False
    return not entry.error or normalize_error(error) == normalize_error(entry.error)


class World:
    """The names a replay needs mapped to this server's real values."""

    def __init__(self, send: Send, admin_token: str):
        self.send = send
        self.admin_token = admin_token
        self.run_id = f"{int(time.time()) % 100000}x{next(_ids)}"
        self.product_ids: dict = {}   # logged product id -> id on this server
        self.emails: dict = {}        # logged email -> an address nobody used yet
        self.codes: dict = {}         # logged discount code -> a code nobody used yet
        self.tokens: dict = {}        # user name in the log -> bearer token

    # ---- names -----------------------------------------------------------------------
    def email(self, logged: str) -> str:
        if logged not in self.emails:
            # The whole address, so sam@a.com and sam@b.com (or a log user "sam" and a set-up
            # account sam@example.com) never map to the same new address.
            local = re.sub(r"[^a-z0-9]", "", logged.lower())[:24] or "user"
            self.emails[logged] = f"{local}.{self.run_id}@example.com"
        return self.emails[logged]

    def code(self, logged: str) -> str:
        if logged not in self.codes:
            # A code is 3 to 20 letters, digits or hyphens: keep what fits of the name.
            suffix = f"-{self.run_id}".replace("x", "-")
            self.codes[logged] = (logged[: 20 - len(suffix)] + suffix).upper()
        return self.codes[logged]

    def token_for(self, user: str) -> Optional[str]:
        if user == "admin":
            return self.admin_token
        if user == "anonymous":
            return None
        if user not in self.tokens:
            status, body = self.send("POST", "/auth/register", None, {
                "name": user.title(), "email": self.email(f"{user}@users.test"), "password": PASSWORD,
            })
            if status != 201:
                raise RuntimeError(f"could not create the account for {user!r}: {status} {body}")
            self.tokens[user] = body["token"]
        return self.tokens[user]

    # ---- rewriting what the log recorded ---------------------------------------------
    def path(self, logged: str) -> str:
        path = re.sub(r"^/products/(\d+)", lambda m: f"/products/{self.product_ids.get(int(m.group(1)), m.group(1))}", logged)
        for original, alias in self.codes.items():
            path = path.replace(f"/discounts/{original}", f"/discounts/{alias}")
        return path

    def body(self, logged: Any) -> Any:
        if isinstance(logged, list):
            return [self.body(item) for item in logged]
        if not isinstance(logged, dict):
            return logged
        out = {}
        for key, value in logged.items():
            if key == "email" and isinstance(value, str):
                out[key] = self.email(value)
            elif key in ("discount_code", "code") and isinstance(value, str):
                out[key] = self.code(value)
            elif key == "product_id" and isinstance(value, int):
                out[key] = self.product_ids.get(value, value)
            else:
                out[key] = self.body(value)
        return out

    # ---- setup -----------------------------------------------------------------------
    def build(self, setup: dict) -> None:
        for product in setup.get("products", []):
            fields = {k: v for k, v in product.items() if k != "logged_id"}
            status, body = self.send("POST", "/products", self.admin_token, {"category": "repro", **fields})
            if status != 201:
                raise RuntimeError(f"setup: product {product['name']!r} was refused: {status} {body}")
            self.product_ids[product["logged_id"]] = body["id"]
        for account in setup.get("accounts", []):
            status, body = self.send("POST", "/auth/register", None, {
                "name": account.get("name", "Customer"), "email": self.email(account["email"]),
                "password": account["password"],
            })
            if status != 201:
                raise RuntimeError(f"setup: account {account['email']!r} was refused: {status} {body}")
        for discount in setup.get("discounts", []):
            fields = {**discount, "code": self.code(discount["code"])}
            status, body = self.send("POST", "/discounts", self.admin_token, fields)
            if status != 201:
                raise RuntimeError(f"setup: discount {discount['code']!r} was refused: {status} {body}")

    def apply_steps(self, steps: list) -> None:
        for step in steps:
            status, body = self.send(step["method"], self.path(step["path"]), self.admin_token, self.body(step.get("body")))
            if status >= 400:
                raise RuntimeError(f"fix step {step['method']} {step['path']} was refused: {status} {body}")


def replay(case: dict, entries: list, send: Send, admin_token: str, with_fix: bool = False) -> Outcome:
    """Replay a case's log. With the fix applied the question changes: not "did it fail the
    same way" but "did every request that failed in the log now succeed"."""
    if not any(e.failed for e in entries):
        raise ValueError(f"{case['id']}: the log has no failed request, so there is nothing to reproduce")
    world = World(send, admin_token)
    world.build(case.get("setup", {}))
    if with_fix:
        world.apply_steps(case["fix"].get("steps", []))

    outcome = Outcome(case["id"], reproduced=not with_fix, fixed=True if with_fix else None)
    passwords = {a["email"]: a["password"] for a in case.get("setup", {}).get("accounts", [])}
    for entry in entries:
        body = world.body(entry.body)
        # A log masks passwords. A request that succeeded must have had the right one, so
        # it is replayed with the account's real password; a refused one keeps the mask,
        # which is wrong on purpose.
        if isinstance(body, dict) and body.get("password") == MASKED and not entry.failed:
            body["password"] = passwords.get((entry.body or {}).get("email"), PASSWORD)
        status, answer = send(entry.method, world.path(entry.path), world.token_for(entry.user), body)
        error = answer.get("error") if isinstance(answer, dict) else None
        outcome.replayed += 1
        if with_fix:
            if entry.failed and status >= 400:
                outcome.fixed = False
                outcome.mismatches.append(Mismatch(entry.line, "a success after the fix", describe(status, error)))
            elif not entry.failed and status >= 400:
                # A fix that breaks a request that used to work is not a fix.
                outcome.fixed = False
                outcome.mismatches.append(Mismatch(entry.line, f"{entry.status}, as before the fix", describe(status, error)))
        elif not matches(entry, status, error):
            outcome.reproduced = False
            outcome.mismatches.append(Mismatch(entry.line, describe(entry.status, entry.error), describe(status, error)))
    return outcome
