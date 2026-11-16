# Charter: Explore the chip counts against the category filter after creates, edits and deletes, and with odd values, to find counts that do not match the list

**Tester:** Claude
**Area:** Filter counts
**Timebox:** 10
**Started:** 2026-11-16T00:48

## Notes
[00:48] NOTE: with 260 products (three pages for the counts), after a delete and after moving a product to another category, every chip count equalled the total its filter returns.
[00:48] BUG: EX-05. POST /products accepts category: 5 (a number) with status 201. The chip for "" then counts it, but ?category= returns 0 and ?category=5 returns 0: the product cannot be reached by any filter, and the A496 rule that every count can be reproduced with the filter is broken.
[00:48] BUG: EX-06. PUT /products/:id stores category null, "", " ", 5, ["a"], {"x":1} and true with status 200. POST refuses an empty category with 400, so the two routes follow different rules, and one PUT can create the unreachable product above.
[00:48] QUESTION: a name of two spaces and a category of three spaces are accepted by POST, a name of 5,000 characters is accepted, and stock 1e21 is accepted. Are there limits?
[00:48] NOTE: a name containing <b>x</b> is stored and returned as written, which is correct for a JSON API; escaping belongs to the page that shows it.
[00:48] IDEA: a property test that creates products from generated categories and checks that the counts and the filters agree.
