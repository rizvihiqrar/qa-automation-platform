"""Equivalence partitioning: one case per class of input, valid and invalid.

The case IDs (TC-EP-01 and so on) are the ones in docs/test-strategy/test-plan.md,
the same cases the Playwright suite runs in qa-practice-api/tests/design.
"""
import pytest

PRODUCT = {"name": "EP Widget", "category": "pytest"}


@pytest.mark.parametrize("price, status", [
    pytest.param(12.5, 201, id="TC-EP-01 a JSON number"),
    pytest.param("12.5", 400, id="TC-EP-02 a numeric string"),
    pytest.param("", 400, id="TC-EP-03 an empty string"),
    pytest.param(True, 400, id="TC-EP-04 a boolean"),
    pytest.param("abc", 400, id="TC-EP-05 a non-numeric string"),
    pytest.param([5], 400, id="TC-EP-06 a one-number array"),
])
def test_product_price_classes(api, admin, price, status):
    res = api.post("/products", headers=admin.headers, json={**PRODUCT, "price": price})
    assert res.status_code == status
    if status == 201:
        assert res.json()["price"] == price
    else:
        assert res.json()["error"] == "price must be a non-negative number"


def test_tc_ep_07_stock_left_out_defaults_to_zero(api, admin):
    res = api.post("/products", headers=admin.headers, json={**PRODUCT, "price": 1})
    assert res.status_code == 201
    assert res.json()["stock"] == 0


@pytest.mark.parametrize("stock", [
    pytest.param("", id="TC-EP-08 an empty string"),
    pytest.param("5", id="TC-EP-09 a numeric string"),
    pytest.param(2.5, id="TC-EP-10 a fraction"),
])
def test_product_stock_classes(api, admin, stock):
    res = api.post("/products", headers=admin.headers, json={**PRODUCT, "price": 1, "stock": stock})
    assert res.status_code == 400
    assert res.json()["error"] == "stock must be a non-negative whole number"


def test_tc_ep_11_a_whole_number_quantity_is_accepted(api, sign_up, make_product, stock_of):
    me, product = sign_up(), make_product()
    res = api.post("/orders", headers=me.headers, json={"items": [{"product_id": product["id"], "quantity": 2}]})
    assert res.status_code == 201
    assert stock_of(product["id"]) == 8


@pytest.mark.parametrize("line", [
    pytest.param(lambda pid: {"product_id": pid, "quantity": "2"}, id="TC-EP-12 a quantity sent as a string"),
    pytest.param(lambda pid: {"product_id": pid, "quantity": 1.5}, id="TC-EP-13 a fractional quantity"),
    pytest.param(lambda pid: {"product_id": pid}, id="TC-EP-14 no quantity"),
    pytest.param(lambda pid: None, id="TC-EP-15 a null line"),
])
def test_bad_order_lines_return_400_and_take_no_stock(api, sign_up, make_product, stock_of, line):
    me, product = sign_up(), make_product()
    res = api.post("/orders", headers=me.headers, json={"items": [line(product["id"])]})
    assert res.status_code == 400
    assert "whole-number quantity" in res.json()["error"]
    assert stock_of(product["id"]) == 10


def test_tc_ep_16_items_that_are_not_an_array_return_400(api, sign_up):
    res = api.post("/orders", headers=sign_up().headers, json={"items": "two widgets"})
    assert res.status_code == 400
    assert res.json()["error"] == "items must be a non-empty array"


def test_tc_ep_17_a_malformed_json_body_returns_a_json_400(api, admin):
    res = api.post(
        "/products",
        headers={**admin.headers, "Content-Type": "application/json"},
        data=b'{"name": "Widget",',
    )
    assert res.status_code == 400
    assert res.headers["content-type"].startswith("application/json")
    assert res.json() == {"error": "Request body is not valid JSON"}


@pytest.mark.parametrize("path, body", [
    pytest.param("/auth/register", {"name": "N", "email": "ep18@example.com", "password": 12345},
                 id="TC-EP-18 register with a numeric password"),
    pytest.param("/auth/register", {"name": "N", "email": {"$ne": ""}, "password": "Pass123!"},
                 id="TC-EP-19 register with an object email"),
    pytest.param("/auth/login", {"email": "ep20@example.com", "password": 12345},
                 id="TC-EP-20 sign in with a numeric password"),
])
def test_sign_up_and_sign_in_fields_must_be_strings(api, path, body):
    res = api.post(path, json=body)
    assert res.status_code == 400, "a bad type must be a 400, not a 500"
    assert "required strings" in res.json()["error"]
