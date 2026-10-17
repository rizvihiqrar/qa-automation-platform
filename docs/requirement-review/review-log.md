# Review log

All 43 acceptance criteria of the ten Day 4 feature files, in the order of the files in [`examples/input`](../../packages/ai-test-generator/examples/input). Each feature has a table of its criteria with a verdict, then the findings. [README](README.md) explains the method and the totals.

Every finding names its test. A test marked `[known defect]` is expected to fail today: the site is wrong, so it stays green in CI while the defect exists and turns red when the site is fixed. A finding with **Test: none** is a question only the product owner can answer.

Live observations were made on the public demo site on 2026-10-17 with the `standard_user` account unless a finding says otherwise.

## cart-persistence

Feature file: [feature-cart-persistence.txt](../../packages/ai-test-generator/examples/input/feature-cart-persistence.txt)

| # | Criterion | Verdict | Findings |
|---|---|---|---|
| C1 | An item added to the cart is still in the cart after opening another product's details page | clear |  |
| C2 | An item added to the cart is still counted in the badge after reloading the products page | needs work | RV-01 |
| C3 | Items in the cart page match the items that were added | needs work | RV-02 |

### RV-01 The cart belongs to the browser, not the user

- **Where:** C2 (and the story, "keep its items while I browse")
- **Kind:** ambiguous
- **Result:** defect
- **Question:** persists for how long, and for whom? Reload is the only case written down. Logout, a second login and a second user are not mentioned.
- **Live site:** the cart is one `cart-contents` entry in the browser's local storage, with no user in it. `standard_user` adds the Backpack and logs out; `visual_user` logs in and sees a badge of 1. The same user's cart also survives logout and login.
- **Generated test:** reload only.
- **Decision:** a cart is private to the account that filled it. Whether the same user's cart should survive logout is left to the product owner; today it does.
- **Test:** review RV-01

### RV-02 "Match" and "correct items" are not defined

- **Where:** C3 here, C5 of cart
- **Kind:** ambiguous
- **Result:** test gap
- **Question:** match on what? Name, price, quantity, order, description?
- **Live site:** each row shows quantity (always 1: the button toggles between Add and Remove, so one product can't be added twice), name, description and price. Rows are in the order the items were added, not the order of the product list: Fleece Jacket added before Backpack is listed first.
- **Generated test:** compares product names only.
- **Decision:** the cart page shows each added item once, with its list name and price, quantity 1, in the order added.
- **Test:** review RV-02

## cart

Feature file: [feature-cart.txt](../../packages/ai-test-generator/examples/input/feature-cart.txt)

| # | Criterion | Verdict | Findings |
|---|---|---|---|
| C1 | Adding a product increments the cart badge count by 1 | clear |  |
| C2 | Adding two different products shows a badge count of 2 | clear |  |
| C3 | Removing a product decrements the badge count | clear |  |
| C4 | Removing the last item from the cart hides the cart badge entirely | needs work | RV-03 |
| C5 | The cart page shows the correct items after navigating to it | needs work | RV-02 |

### RV-03 "Hides" can mean hidden or absent

- **Where:** C4
- **Kind:** ambiguous
- **Result:** rule clarified
- **Question:** a badge that is still in the page but invisible (CSS) and one that is not in the page at all both "hide" it. Screen readers and tests tell them apart.
- **Live site:** the badge element is removed.
- **Generated test:** counts the element and expects 0, so it silently chose "absent".
- **Decision:** "the cart badge is not on the page". The existing test already checks exactly that.
- **Test:** regression `cart.spec.js` › `removing the last item hides the badge`

## checkout-complete

Feature file: [feature-checkout-complete.txt](../../packages/ai-test-generator/examples/input/feature-checkout-complete.txt)

| # | Criterion | Verdict | Findings |
|---|---|---|---|
| C1 | Clicking Finish on the overview shows the "Checkout: Complete!" page | clear |  |
| C2 | The page shows the heading "Thank you for your order!" | clear |  |
| C3 | After finishing, the cart badge is no longer shown | needs work | RV-04 |
| C4 | Clicking "Back Home" returns to the products page | clear |  |

### RV-04 The story promises an empty cart; the criterion checks one badge

- **Where:** C3
- **Kind:** missing criterion
- **Result:** rule clarified
- **Question:** the story says "a confirmation and an empty cart". The badge is one of three places the cart shows: the cart page and the Add/Remove buttons on the product list are the others.
- **Live site:** all three are clear after finishing.
- **Generated test:** badge only.
- **Decision:** after finishing, the cart page is empty and every product button reads "Add to cart".
- **Test:** review RV-04

### RV-05 The confirmation page opens without an order

- **Where:** missing criterion (nothing says the pages are reached in order)
- **Kind:** missing criterion
- **Result:** defect
- **Question:** may `/checkout-complete.html` be opened directly?
- **Live site:** yes. With an item in the cart and no checkout, the address shows "Thank you for your order!". The overview page (`/checkout-step-two.html`) also opens directly, skipping the information step, and shows a total of $0.00 for an empty cart.
- **Generated test:** none.
- **Decision:** the confirmation is shown only after Finish. Only this page is tested; the same gap on the overview page is covered by RV-09.
- **Test:** review RV-05

## checkout-info

Feature file: [feature-checkout-info.txt](../../packages/ai-test-generator/examples/input/feature-checkout-info.txt)

| # | Criterion | Verdict | Findings |
|---|---|---|---|
| C1 | From the cart, clicking Checkout opens the "Checkout: Your Information" step | clear |  |
| C2 | Continuing with no first name shows "Error: First Name is required" | needs work | RV-06, RV-07 |
| C3 | Continuing with a first name but no last name shows "Error: Last Name is required" | needs work | RV-06 |
| C4 | Continuing with first and last name but no postal code shows "Error: Postal Code is required" | needs work | RV-06 |
| C5 | Continuing with all three fields filled opens the "Checkout: Overview" step | needs work | RV-08 |
| C6 | Clicking Cancel returns to the cart page | needs work | RV-10 |

### RV-06 Two missing fields: which error wins?

- **Where:** C2, C3, C4
- **Kind:** missing criterion
- **Result:** rule clarified
- **Question:** each criterion is written as "exactly this one field is missing". An empty form, or a form with only the postal code, is not covered.
- **Live site:** one error at a time, in field order: first name, then last name, then postal code.
- **Generated test:** the three single-field cases.
- **Decision:** with several fields missing, the error names the first one in form order.
- **Test:** review RV-06

### RV-07 Three spaces count as a first name

- **Where:** C2
- **Kind:** ambiguous
- **Result:** defect
- **Question:** does "no first name" include a name made only of spaces?
- **Live site:** `"   "` is accepted and the overview opens. The last name and postal code accept spaces as well.
- **Generated test:** empty field only.
- **Decision:** blank means empty or only spaces; a required field made of spaces is rejected with the same error.
- **Test:** review RV-07

### RV-08 What may a name or a postal code contain?

- **Where:** C5
- **Kind:** missing criterion
- **Result:** open question
- **Question:** "all three fields filled" accepts any text. Is there a length limit? A postal code format (the generated tests use a Canadian one; other countries differ)? Are letters or markup allowed in a name?
- **Live site:** `abc!!` as a postal code, digits as names, 300 characters and `<b>x</b>` are all accepted.
- **Generated test:** one valid set of values.
- **Decision:** none possible. Without a rule there is nothing to assert; a test that pins "anything goes" would turn a missing rule into a requirement.
- **Test:** none

### RV-09 Checking out an empty cart

- **Where:** missing criterion (the story starts "as a customer with an item in my cart")
- **Kind:** missing criterion
- **Result:** defect
- **Question:** what happens with no item?
- **Live site:** Checkout opens, the details are accepted, the overview shows a total of $0.00 and Finish returns "Thank you for your order!".
- **Generated test:** always has an item.
- **Decision:** an order needs at least one item. Where to stop it (the cart's Checkout button, or an error) is the owner's call; the test only requires that the information step is not reached.
- **Test:** review RV-09

### RV-10 Cancel goes to two different places

- **Where:** C6 here, C5 of checkout-overview
- **Kind:** inconsistent
- **Result:** rule clarified
- **Question:** Cancel on the information step goes to the cart; on the overview it goes to the products page. Intended? And is anything lost?
- **Live site:** as written. After cancelling on the overview the item is still in the cart.
- **Generated test:** URL only.
- **Decision:** both destinations are kept as written (they are explicit in the criteria); cancelling never discards the cart. The inconsistency is raised for the owner.
- **Test:** review RV-10

## checkout-overview

Feature file: [feature-checkout-overview.txt](../../packages/ai-test-generator/examples/input/feature-checkout-overview.txt)

| # | Criterion | Verdict | Findings |
|---|---|---|---|
| C1 | With only "Sauce Labs Backpack" in the cart, the overview lists that item | clear |  |
| C2 | The item total reads "Item total: $29.99" | needs work | RV-11, RV-13 |
| C3 | The tax reads "Tax: $2.40" | needs work | RV-11 |
| C4 | The total reads "Total: $32.39" | needs work | RV-11 |
| C5 | Clicking Cancel on the overview returns to the products page | needs work | RV-10 |

### RV-11 Three numbers for one cart, and no rule

- **Where:** C2, C3, C4
- **Kind:** weak criterion
- **Result:** rule clarified
- **Question:** the criteria are one example. They say nothing about how the numbers are made: which tax rate, how it rounds, whether the total is a sum. A fix that hard-codes $2.40 would pass.
- **Live site:** tax is 8% of the item total, rounded to the cent. Read for all 63 non-empty carts of the six products (prices $7.99 to $49.99); the tax and total were right every time. No cart has an exact half-cent, so the rounding direction can't matter with these prices.
- **Generated test:** the Backpack only.
- **Decision:** item total is the sum of the item prices; tax is 8% of it, rounded to the nearest cent; total is item total plus tax.
- **Test:** review RV-11

### RV-12 An empty cart's item total has no cents

- **Where:** missing criterion (reachable only because of RV-09)
- **Kind:** inconsistent
- **Result:** defect
- **Question:** how is a zero amount written?
- **Live site:** "Item total: $0" next to "Tax: $0.00" and "Total: $0.00".
- **Generated test:** none.
- **Decision:** every amount is written with two decimals.
- **Test:** review RV-12

### RV-13 The item total prints floating-point noise

- **Where:** C2
- **Kind:** weak criterion
- **Result:** defect
- **Question:** "reads $29.99" is true for the example and for 57 of the 63 carts. What about the rest?
- **Live site:** 6 of the 63 carts print the raw sum: "Item total: $59.980000000000004" (Bike Light + Fleece Jacket), "$105.96000000000001", "$57.980000000000004", "$113.94999999999999", "$119.94999999999999", "$99.94999999999999". The tax and total lines are rounded correctly, so the page disagrees with itself. The first probe of this review parsed the text as a number and missed it; comparing the exact text found it.
- **Generated test:** the Backpack only; its sum happens to be exact.
- **Decision:** every amount is a whole number of cents, written with two decimals. Money as a binary float is the cause and the reason Day 43 builds the banking API with decimal amounts.
- **Test:** review RV-13

## inventory-sort

Feature file: [feature-inventory-sort.txt](../../packages/ai-test-generator/examples/input/feature-inventory-sort.txt)

| # | Criterion | Verdict | Findings |
|---|---|---|---|
| C1 | The default sort is Name (A to Z), and the first product is "Sauce Labs Backpack" | clear |  |
| C2 | Sorting by Name (Z to A) shows "Test.allTheThings() T-Shirt (Red)" first | needs work | RV-15 |
| C3 | Sorting by Price (low to high) shows "Sauce Labs Onesie" first, priced $7.99 | needs work | RV-15 |
| C4 | Sorting by Price (high to low) shows "Sauce Labs Fleece Jacket" first, priced $49.99 | needs work | RV-15 |
| C5 | The page shows 6 products after any sort | needs work | RV-14 |

### RV-14 "Any sort" was tested once

- **Where:** C5
- **Kind:** ambiguous
- **Result:** test gap
- **Question:** "any sort" means four sorts.
- **Live site:** six products after each.
- **Generated test:** sorts by price high to low and counts. One of four.
- **Decision:** the count is checked after each of the four sorts.
- **Test:** review RV-14

### RV-15 Only the first product is checked, and two products tie

- **Where:** C2, C3, C4
- **Kind:** weak criterion
- **Result:** test gap
- **Question:** "sorted" is a claim about all six rows, and the criteria check one. Sorting by price also leaves a question: two products cost $15.99 (Bolt T-Shirt and the Red T-Shirt). Which comes first?
- **Live site:** all four orders are complete and right. The two shirts stay in name order for both price sorts (low to high and high to low), so high to low is not a reversed list.
- **Generated test:** first row and price only.
- **Decision:** the whole order is asserted for all four sorts. The tie order is recorded as observed, not as a requirement, until the owner says whether ties should be broken by name.
- **Test:** review RV-15

### RV-16 The chosen sort is forgotten

- **Where:** missing criterion
- **Kind:** missing criterion
- **Result:** open question
- **Question:** after sorting, opening a product and coming back, should the list keep the sort?
- **Live site:** no. "Back to products" shows Name (A to Z) again, and a reload does the same.
- **Generated test:** none.
- **Decision:** none possible; both behaviours are defensible.
- **Test:** none

## login

Feature file: [feature-login.txt](../../packages/ai-test-generator/examples/input/feature-login.txt)

| # | Criterion | Verdict | Findings |
|---|---|---|---|
| C1 | Logging in with valid credentials redirects to the products page | needs work | RV-17 |
| C2 | Logging in with an incorrect password shows an error message containing "Username and password do not match" | needs work | RV-20 |
| C3 | Logging in as a locked-out user shows a message containing "Sorry, this user has been locked out" | needs work | RV-18 |
| C4 | Submitting the login form without entering any credentials shows "Username is required" | needs work | RV-19 |
| C5 | The products page should display at least one product after successful login | needs work | RV-21 |

### RV-17 Which credentials are valid?

- **Where:** C1
- **Kind:** ambiguous
- **Result:** rule clarified
- **Question:** the feature file names no user. The site publishes six.
- **Live site:** five log in and reach the products page (`standard_user`, `problem_user`, `performance_glitch_user`, `error_user`, `visual_user`); `locked_out_user` is refused. They don't behave alike afterwards (see RV-27).
- **Generated test:** `standard_user`, the only one that is safe to assume.
- **Decision:** "valid" means any of the five accepted accounts reaches the products page. What each does after that is a separate requirement.
- **Test:** review RV-17

### RV-18 Locked out, but with which password?

- **Where:** C3
- **Kind:** missing criterion
- **Result:** rule clarified
- **Question:** the lock message is promised for "a locked-out user". With a wrong password too?
- **Live site:** no. The wrong password gets the ordinary credentials error, so the lock status is only revealed to someone who knows the password.
- **Generated test:** correct password only.
- **Decision:** the lock message needs the correct password. That is the safer behaviour and is written down.
- **Test:** review RV-18

### RV-19 One credential missing

- **Where:** C4
- **Kind:** missing criterion
- **Result:** rule clarified
- **Question:** "without entering any credentials" is both fields empty. A username alone, or a password alone?
- **Live site:** "Password is required" for a username alone, "Username is required" for a password alone.
- **Generated test:** both empty.
- **Decision:** each missing credential has its own message.
- **Test:** review RV-19

### RV-20 Is the username case-sensitive? Are spaces trimmed?

- **Where:** C2
- **Kind:** missing criterion
- **Result:** rule clarified
- **Question:** "incorrect password" is one of several ways to get the same message.
- **Live site:** `STANDARD_USER` and `standard_user ` (trailing space) are both refused with "Username and password do not match". No trimming, no case folding.
- **Generated test:** a wrong password.
- **Decision:** usernames are matched exactly.
- **Test:** review RV-20

### RV-21 "At least one" product is a very low bar

- **Where:** C5
- **Kind:** weak criterion
- **Result:** test gap
- **Question:** the page has six products. A bug that dropped five would still pass "at least one".
- **Live site:** six.
- **Generated test:** the first product is visible: passes with one.
- **Decision:** the page lists the six products by name.
- **Test:** review RV-21

## logout

Feature file: [feature-logout.txt](../../packages/ai-test-generator/examples/input/feature-logout.txt)

| # | Criterion | Verdict | Findings |
|---|---|---|---|
| C1 | Opening the menu and clicking Logout returns to the login page | clear |  |
| C2 | After logging out, the login button is visible again | clear |  |
| C3 | After logging out, going directly to /inventory.html shows an error containing "You can only access '/inventory.html' when you are logged in" | needs work | RV-22 |

### RV-22 Only one page is named

- **Where:** C3
- **Kind:** weak criterion
- **Result:** rule clarified
- **Question:** the story is "nobody else can use my session". The cart, the three checkout pages and the product details are also pages.
- **Live site:** all five show the same error with their own address in it.
- **Generated test:** `/inventory.html`.
- **Decision:** every page except the login page needs a session, and the error names the page asked for.
- **Test:** review RV-22

### RV-23 The back button after logout

- **Where:** missing criterion
- **Kind:** missing criterion
- **Result:** rule clarified
- **Question:** can the next person press Back and see the products?
- **Live site:** no; the login page shows.
- **Generated test:** none.
- **Decision:** after logout, going back never shows a page that needs a session.
- **Test:** review RV-23

## product-details

Feature file: [feature-product-details.txt](../../packages/ai-test-generator/examples/input/feature-product-details.txt)

| # | Criterion | Verdict | Findings |
|---|---|---|---|
| C1 | Clicking a product's name opens its details page | needs work | RV-27 |
| C2 | The details page shows the same name and price as the product list | needs work | RV-24 |
| C3 | Adding the product to the cart from the details page shows a cart badge of 1 | needs work | RV-25 |
| C4 | Clicking "Back to products" returns to the products page | clear |  |

### RV-24 One product was checked

- **Where:** C2
- **Kind:** ambiguous
- **Result:** test gap
- **Question:** "the product" is any of six; "same" could include the description.
- **Live site:** name, price and description match the list for all six.
- **Generated test:** the first product, name and price.
- **Decision:** all six, including the description.
- **Test:** review RV-24

### RV-25 "A badge of 1" only holds for an empty cart

- **Where:** C3
- **Kind:** hidden precondition
- **Result:** rule clarified
- **Question:** with something already in the cart, the badge shows more than 1.
- **Live site:** adds on top of the cart (2), and the button turns into "Remove".
- **Generated test:** starts from an empty cart.
- **Decision:** adding from the details page adds one to the badge.
- **Test:** review RV-25

### RV-26 A product that doesn't exist

- **Where:** missing criterion
- **Kind:** missing criterion
- **Result:** rule clarified
- **Question:** what does `/inventory-item.html?id=99` show?
- **Live site:** "ITEM NOT FOUND" with a Back to products button that works.
- **Generated test:** none.
- **Decision:** an unknown product shows a not-found message and a way back.
- **Test:** review RV-26

### RV-27 Clicking a product name opens another product

- **Where:** C1
- **Kind:** ambiguous
- **Result:** defect
- **Question:** the criterion holds "for valid credentials", which RV-17 shows is five accounts.
- **Live site:** as `problem_user`, clicking "Sauce Labs Backpack" opens the Fleece Jacket page. The same account's sort has no effect. (These accounts exist on the site to be broken. The point is that the criteria never said which one they were about.)
- **Generated test:** `standard_user`; checks the address changed, not which product opened.
- **Decision:** the criterion applies to every accepted account, and "its details page" means the page of the product clicked.
- **Test:** review RV-27

## reset-app-state

Feature file: [feature-reset-app-state.txt](../../packages/ai-test-generator/examples/input/feature-reset-app-state.txt)

| # | Criterion | Verdict | Findings |
|---|---|---|---|
| C1 | With items in the cart, choosing "Reset App State" from the menu removes the cart badge | clear |  |
| C2 | After resetting, the cart page shows no items | clear |  |
| C3 | After resetting, the user is still logged in and can see the products page | clear |  |

The three criteria are clear and the three generated tests pass. The findings are what the criteria leave out.

### RV-28 Reset leaves "Remove" buttons on the product list

- **Where:** missing criterion (the cart shows in three places; the criteria cover two)
- **Kind:** missing criterion
- **Result:** defect
- **Question:** after reset the badge and the cart page are empty. What do the product buttons say?
- **Live site:** still "Remove" for each item that was in the cart, until the page is reloaded.
- **Generated test:** all three green. The suite was passing on a visible defect.
- **Decision:** after reset every product button reads "Add to cart" without a reload.
- **Test:** review RV-28

### RV-29 What is "app state"?

- **Where:** missing criterion
- **Kind:** missing criterion
- **Result:** open question
- **Question:** the story says "start over with an empty cart", the menu item says "app state". Is the sort part of that state?
- **Live site:** the cart is cleared and the selected sort is not.
- **Generated test:** none.
- **Decision:** none possible until the owner defines the scope of a reset.
- **Test:** none
