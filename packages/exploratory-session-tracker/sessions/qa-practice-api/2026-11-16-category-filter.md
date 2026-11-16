# Charter: Explore the category filter on the product list with unusual category names and filter shapes to find products that exist but cannot be found

**Tester:** Claude
**Area:** Product list filter
**Timebox:** 10
**Started:** 2026-11-16T00:48

## Notes
[00:48] NOTE: 16 products, each in its own awkward category (case and space variants, two spellings of Café, C++, 100%, 日本語, null, undefined, constructor, __proto__). Filtering by each exact name finds exactly its product. This is pinned as EX-00.
[00:48] BUG: EX-01. A filter that is not one plain string (category=a&category=b, category[]=a, category[x]=y) is ignored and every product comes back with status 200. A client that sends two chips gets the whole catalogue and believes it is filtered.
[00:48] QUESTION: Café typed with one character (é) and with an e plus a combining accent are two categories that look the same, so the chips would show two Café chips. Should names be normalised?
[00:48] QUESTION: Books, books, "Books " and " Books" are four categories, and category=BOOKS finds none. Should a name be trimmed and compared ignoring case? Today it is exact, and EX-10 pins that.
[00:48] QUESTION: category= (empty) returns only the products with no category, not all products. It is what A496 chose, but a clear-filter button that sends it would show an empty list.
[00:48] NOTE: the parameter name is case-sensitive too: Category=Books is ignored and everything comes back.
