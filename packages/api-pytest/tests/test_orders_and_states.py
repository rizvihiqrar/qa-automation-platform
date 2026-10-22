"""Placing an order (a decision table) and moving it through its lifecycle (state transitions).

Case IDs are the TC-DT and TC-ST ones in docs/test-strategy/test-plan.md.
"""
import pytest


def test_tc_dt_09_no_token_returns_401(api):
    res = api.post("/orders", json={"items": [{"product_id": 1, "quantity": 1}]})
    assert res.status_code == 401


def test_tc_dt_10_signed_in_with_an_invalid_line_returns_400(api, sign_up):
    res = api.post("/orders", headers=sign_up().headers, json={"items": [{"product_id": 1, "quantity": 0}]})
    assert res.status_code == 400


def test_tc_dt_11_a_missing_product_returns_404(api, sign_up):
    res = api.post("/orders", headers=sign_up().headers, json={"items": [{"product_id": 999999, "quantity": 1}]})
    assert res.status_code == 404


def test_tc_dt_12_too_little_stock_returns_400(api, sign_up, make_product):
    product = make_product(stock=1)
    res = api.post("/orders", headers=sign_up().headers, json={"items": [{"product_id": product["id"], "quantity": 2}]})
    assert res.status_code == 400


def _pending_order(api, sign_up, make_product):
    me, product = sign_up(), make_product(stock=10)
    res = api.post("/orders", headers=me.headers, json={"items": [{"product_id": product["id"], "quantity": 1}]})
    assert res.status_code == 201
    return me, res.json()["id"]


def _move(api, admin, order_id, status):
    return api.patch(f"/orders/{order_id}/status", headers=admin.headers, json={"status": status})


@pytest.mark.parametrize("to, status", [
    pytest.param("pending", 409, id="TC-ST-01 pending to pending"),
    pytest.param("processing", 200, id="TC-ST-02 pending to processing"),
    pytest.param("cancelled", 200, id="TC-ST-05 pending to cancelled"),
])
def test_moves_out_of_pending(api, admin, sign_up, make_product, to, status):
    me, order_id = _pending_order(api, sign_up, make_product)
    res = _move(api, admin, order_id, to)
    assert res.status_code == status
    # A refused move leaves the order as it was.
    now = api.get(f"/orders/{order_id}", headers=me.headers).json()["status"]
    assert now == (to if status == 200 else "pending")


def test_tc_st_08_processing_to_shipped(api, admin, sign_up, make_product):
    me, order_id = _pending_order(api, sign_up, make_product)
    assert _move(api, admin, order_id, "processing").status_code == 200
    res = _move(api, admin, order_id, "shipped")
    assert res.status_code == 200
    assert res.json()["status"] == "shipped"
