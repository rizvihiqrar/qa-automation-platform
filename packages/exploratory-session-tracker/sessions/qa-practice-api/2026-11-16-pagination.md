# Charter: Explore page and limit on the product list with boundary values, malformed values and a catalogue that changes between pages to find skipped, repeated or mis-numbered products

**Tester:** Claude
**Area:** Product list paging
**Timebox:** 10
**Started:** 2026-11-16T00:48

## Notes
[00:48] NOTE: 30 products walked at limit 7 over five pages: every product seen once, in id order. A PUT does not move a product in the list (EX-09).
[00:48] BUG: EX-02. page=0x10 is read as page 16, because the number is parsed with parseInt and no radix, so a hexadecimal value gets through. page=2abc is read as 2 and page=1e2 as 1.
[00:48] BUG: EX-03. page=99999999999999999999 answers 200 with page: 100000000000000000000, a number past the largest exact integer, and no data.
[00:48] QUESTION: page=1.5 is read as 1, limit=2.9 as 2, and a repeated or array page (page=1&page=2, page[]=2) silently becomes page 1. Is that wanted, or should they be 400?
[00:48] QUESTION: a page past the last (page=4 of 3) answers 200 with an empty list and the page number echoed. Pinned as EX-08.
[00:48] RISK: EX-04. Paging is by position, so a product deleted after the first page was read moves the next one up: with 30 products, deleting id 1 made page 2 start at id 12, and id 11 was never shown to a client that had already read page 1. Pinned as the known behaviour.
