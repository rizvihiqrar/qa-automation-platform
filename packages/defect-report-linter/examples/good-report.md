# Discount code SAVE10 isn't applied to the checkout total

**Severity:** High
**Component:** Checkout
**Environment:** Chrome 129 on Windows 11, staging build 4.2.1

## Steps to Reproduce
1. Log in as standard_user
2. Add the Backpack ($29.99) to the cart
3. Go to checkout and enter the code SAVE10
4. Click Apply

## Expected Result
The total drops by 10% to $26.99 and the code is listed under the subtotal.

## Actual Result
The total stays at $29.99. No error is shown, and the code field clears.

## Evidence
- checkout-save10.png
- network-log-apply-code.har
