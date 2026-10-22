"""Boundary value analysis: the edge of each range, and one step either side.

Case IDs are the TC-BVA ones in docs/test-strategy/test-plan.md.
"""
import pytest

PRODUCT = {"name": "BVA Widget", "category": "pytest"}


@pytest.mark.parametrize("price, status", [
    pytest.param(-0.01, 400, id="TC-BVA-01 price -0.01"),
    pytest.param(0, 201, id="TC-BVA-02 price 0"),
    pytest.param(0.01, 201, id="TC-BVA-03 price 0.01"),
])
def test_price_is_at_least_zero(api, admin, price, status):
    res = api.post("/products", headers=admin.headers, json={**PRODUCT, "price": price})
    assert res.status_code == status


@pytest.mark.parametrize("stock, status", [
    pytest.param(-1, 400, id="TC-BVA-04 stock -1"),
    pytest.param(0, 201, id="TC-BVA-05 stock 0"),
    pytest.param(1, 201, id="TC-BVA-06 stock 1"),
])
def test_stock_is_at_least_zero(api, admin, stock, status):
    res = api.post("/products", headers=admin.headers, json={**PRODUCT, "price": 1, "stock": stock})
    assert res.status_code == status


@pytest.mark.parametrize("quantities, status, stock_after", [
    pytest.param([0], 400, 5, id="TC-BVA-07 quantity 0, stock 5"),
    pytest.param([1], 201, 4, id="TC-BVA-08 quantity 1, stock 5"),
    pytest.param([5], 201, 0, id="TC-BVA-09 quantity 5, stock 5"),
    pytest.param([6], 400, 5, id="TC-BVA-10 quantity 6, stock 5"),
    pytest.param([2, 3], 201, 0, id="TC-BVA-11 two lines 2 + 3, stock 5"),
    pytest.param([3, 3], 400, 5, id="TC-BVA-12 two lines 3 + 3, stock 5"),
])
def test_quantity_is_between_one_and_the_stock(api, sign_up, make_product, stock_of, quantities, status, stock_after):
    me, product = sign_up(), make_product(stock=5)
    items = [{"product_id": product["id"], "quantity": q} for q in quantities]
    res = api.post("/orders", headers=me.headers, json={"items": items})
    assert res.status_code == status
    # The lines are summed before the stock check, and a refused order takes nothing.
    assert stock_of(product["id"]) == stock_after
