# Review log: the discount code request

Every line of the [request](request.md) read for what it leaves out, before any code was written. Each finding records the question, the decision, and the rule in the [reviewed spec](spec.md) that holds the answer. The [README](README.md) has the totals and the method.

A finding with **Rule: none** is an open question: deliberately left out of scope rather than answered by guessing.

## The request, line by line

| # | Line | Verdict | Findings |
|---|---|---|---|
| L1 | Admins create discount codes and customers enter a code when they place an order to get money off. | needs work | DC-01, DC-02, DC-03, DC-04 |
| L2 | A code is either a percentage off or a fixed amount off. | needs work | DC-05, DC-06, DC-07, DC-08 |
| L3 | Codes can have an expiry date. | needs work | DC-09, DC-10 |
| L4 | Codes can have a usage limit. | needs work | DC-11, DC-12, DC-13 |
| L5 | Some codes need a minimum order amount. | needs work | DC-14 |
| L6 | One code per order. | needs work | DC-15 |
| L7 | The order should show the discount. | needs work | DC-16, DC-17 |
| L8 | Codes are not case sensitive. | needs work | DC-18, DC-19 |
| L9 | Admins can turn a code off. | needs work | DC-20, DC-21, DC-22 |

All nine lines needed work. None is wrong; each leaves at least one decision to whoever writes the code, and an AI asked to "add discount codes" from this text would make those decisions silently.

## Findings

### DC-01 What makes a code invalid, and what happens then

- **Where:** L1
- **Kind:** missing
- **Question:** if the code doesn't exist, is off, has expired or is used up, is the order placed without the discount, or refused? With which status and message?
- **Decision:** the order is refused with 422 and nothing changes: no order, no stock taken, no use counted. A customer who typed a code expects the discount; silently charging full price is worse than an error.
- **Rule:** DC-R15

### DC-02 Error messages can reveal which codes exist

- **Where:** L1
- **Kind:** risk
- **Question:** if "no such code" and "code turned off" give different messages, anyone can probe for codes that existed (the same kind of leak as R-23 in the [test strategy](../test-strategy/README.md)).
- **Decision:** unknown and turned-off codes get the same message. Expired, used up, already used and minimum not met get their own messages, because the customer needs to know why and those codes were given to them.
- **Rule:** DC-R15

### DC-03 Which checks come first

- **Where:** L1
- **Kind:** missing
- **Question:** an order with a missing product and an expired code: which error wins?
- **Decision:** the existing item and stock checks (400, 404) run first and keep their current responses; the code is checked after. Order of code checks: valid, expiry, usage limit, this customer's use, minimum.
- **Rule:** DC-R15

### DC-04 Who may create and see codes

- **Where:** L1
- **Kind:** missing
- **Question:** "admins create": can customers list codes? A list open to customers would publish every promotion.
- **Decision:** every `/discounts` endpoint is admin only: no token 401, customer 403, as for product changes since Day 36.
- **Rule:** DC-R10

### DC-05 Range of a percentage

- **Where:** L2
- **Kind:** ambiguous
- **Question:** is 0% allowed? 100%? 150%? 12.5%?
- **Decision:** a whole number from 1 to 100. 100% makes an order free, which is allowed.
- **Rule:** DC-R04

### DC-06 Precision of a fixed amount

- **Where:** L2
- **Kind:** ambiguous
- **Question:** can a fixed amount be 0, negative, 0.001, or the string "5"?
- **Decision:** a JSON number above 0 with at most two decimal places. Strings are refused, as for product prices (Day 33).
- **Rule:** DC-R04

### DC-07 A fixed amount larger than the order

- **Where:** L2
- **Kind:** missing
- **Question:** $25 off a $20 order: a total of -$5?
- **Decision:** the discount is capped at the subtotal, so the total is 0.00, never negative. No credit is kept for the rest.
- **Rule:** DC-R17

### DC-08 Rounding a percentage

- **Where:** L2
- **Kind:** missing
- **Question:** 10% of $10.05 is $1.005. Is the discount $1.00 or $1.01? Is it worked out per line or on the order?
- **Decision:** on the order subtotal, to the nearest cent, half a cent rounding up ($1.01). Amounts are worked out in whole cents. In JavaScript `Math.round(1.005 * 100) / 100` gives 1.00, because 1.005 is stored as 1.00499999…; the same float noise showed on the demo shop in Day 35 (RV-13).
- **Rule:** DC-R17, DC-R18

### DC-09 What "expiry date" means

- **Where:** L3
- **Kind:** ambiguous
- **Question:** a date in which time zone? Is the code still good on the expiry day? At the exact second?
- **Decision:** `expires_at` is an ISO 8601 date-time with a time zone. The code works while the current time is before it; an order at or after that moment is refused.
- **Rule:** DC-R05

### DC-10 Expiry in the past

- **Where:** L3
- **Kind:** missing
- **Question:** may an admin create a code that has already expired, or move expiry into the past?
- **Decision:** no, 400. `null` means it never expires; to stop a code now, turn it off.
- **Rule:** DC-R05, DC-R11

### DC-11 Usage limit for whom

- **Where:** L4
- **Kind:** ambiguous
- **Question:** a limit across all customers, or per customer? Can one customer use a 100-use code 100 times?
- **Decision:** `max_uses` is the total across everyone (`null` = no limit). Separately, each customer may use a code once.
- **Rule:** DC-R06, DC-R21, DC-R22

### DC-12 What counts as a use

- **Where:** L4
- **Kind:** missing
- **Question:** is a use counted when the order is placed, delivered, or not at all if it is cancelled? Does a refused order (say, out of stock) use the code up?
- **Decision:** a use counts when the order is placed. Cancelling the order gives the use back to the code and to the customer. A refused order counts nothing.
- **Rule:** DC-R15, DC-R21, DC-R23

### DC-13 The last use, taken twice

- **Where:** L4
- **Kind:** risk
- **Question:** two customers place an order with the last remaining use at the same moment. Can both get it?
- **Decision:** `max_uses` is never exceeded. Today the order route is synchronous, so the check and the count can't interleave, but that stops being true once storage is a real database (Day 49) and the rule has to survive that.
- **Rule:** DC-R21

### DC-14 Minimum of what

- **Where:** L5
- **Kind:** ambiguous
- **Question:** "minimum order amount" before or after the discount? Is exactly the minimum enough?
- **Decision:** `min_subtotal` is compared with the subtotal before the discount, and equal is enough. A $10 off code with a $50 minimum works on a $50.00 order (total $40.00), not on $49.99.
- **Rule:** DC-R07, DC-R16

### DC-15 How "one code" is sent

- **Where:** L6
- **Kind:** ambiguous
- **Question:** what does the API do with two codes, an array, a number, an empty string?
- **Decision:** `discount_code` is a single string. Omitted or `null` means no code. Any other type, or a string that is empty after trimming, is a 400 (a bad request, not an invalid code).
- **Rule:** DC-R13, DC-R14

### DC-16 Which fields show the discount

- **Where:** L7
- **Kind:** missing
- **Question:** does `total` become the price after the discount, or before? Every existing client reads `total` as the amount to pay.
- **Decision:** `total` keeps its meaning, the amount to pay. Orders gain `subtotal`, `discount_code` and `discount`. An order without a code has `subtotal` equal to `total`, `discount` 0 and `discount_code` null, so old clients see no change.
- **Rule:** DC-R19

### DC-17 The API document

- **Where:** L7
- **Kind:** missing
- **Question:** the OpenAPI document is checked against the running API (api-drift-checker) and drives the ZAP scan. New fields and endpoints that aren't in it would fail the drift check and go unscanned.
- **Decision:** the document describes the new endpoints, `discount_code` and the new order fields.
- **Rule:** DC-R25

### DC-18 Case-insensitive how

- **Where:** L8
- **Kind:** ambiguous
- **Question:** can "SUMMER" and "summer" both be created? What case does the API return? Do surrounding spaces from a copied code matter?
- **Decision:** codes are unique ignoring case (409 on a clash), stored and returned in upper case, and surrounding spaces are trimmed both when creating and when applying.
- **Rule:** DC-R01, DC-R02, DC-R13

### DC-19 What a code may contain

- **Where:** L8
- **Kind:** missing
- **Question:** length? Spaces inside, emoji, punctuation? Letters like "é" make "case-insensitive" ambiguous too.
- **Decision:** 3 to 20 characters of A–Z, 0–9 and hyphen, after trimming.
- **Rule:** DC-R01

### DC-20 Turning a code off, and orders already placed

- **Where:** L9
- **Kind:** ambiguous
- **Question:** does turning a code off (or editing it) change orders that already used it?
- **Decision:** no. An order keeps the discount it was placed with.
- **Rule:** DC-R20

### DC-21 What else an admin may change

- **Where:** L9
- **Kind:** missing
- **Question:** may an admin change a used code's value from 10% to 50%, or its type? Lower `max_uses` below the uses already counted?
- **Decision:** only `active`, `expires_at` and `max_uses` can change; any other field is a 400, because placed orders refer to the code as it was. `max_uses` below the current uses is a 409.
- **Rule:** DC-R11

### DC-22 Deleting a code

- **Where:** L9
- **Kind:** missing
- **Question:** "turn off" only, or delete too?
- **Decision:** no delete. A code that orders refer to stays, turned off.
- **Rule:** DC-R12

### DC-23 Checking a code before ordering

- **Where:** L1
- **Kind:** missing
- **Question:** most shops show the discount before the customer commits. Should customers be able to check a code without placing an order?
- **Decision:** left out of this version. A check endpoint for customers needs its own answer to DC-02 (it is an ideal probe) and rate limit, and the product owner hasn't asked for it.
- **Rule:** none

### DC-24 Codes for some products or customers only

- **Where:** L1
- **Kind:** missing
- **Question:** codes for one category, first orders only, or named customers?
- **Decision:** left out. Every code applies to the whole order for any signed-in customer.
- **Rule:** none
