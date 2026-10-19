# multi-user-flow-patterns

Playwright patterns for testing more than one user at once: concurrent sessions, state isolation between users, and parallel workflows. Each user gets its own browser context, so cookies and storage never leak between them. The target is the public [Sauce Demo](https://www.saucedemo.com) site.

**In plain English:** Some bugs only appear when several people use a system at the same time. These tests act as several users at once to catch them, for example one user's actions leaking into another user's session.

---

## What It Tests

| File | Tests | Pattern |
|---|---:|---|
| `concurrent-sessions.spec.ts` | 3 | Two and three users logged in at once; a normal user alongside the `performance_glitch_user` |
| `context-isolation.spec.ts` | 3 | One user's cart, logout, and sort choice don't affect another user |
| `parallel-workflows.spec.ts` | 3 | Two users check out at the same time; users navigate independently; parallel sessions don't slow each other past a threshold |

**9 tests across 3 files**, in strict TypeScript run by Playwright and Node 24.

---

## Running

```bash
npm install
npx playwright install chromium

npm test            # all tests
npm run smoke       # @smoke only
```

Set `BASE_URL` to point the suite at another copy of the app. The tests sign in with Sauce Demo's public test accounts. Set `SAUCEDEMO_PASSWORD` to override the password; unset, it falls back to the public demo one (see `.env.example`).

---

## Why It Matters

Many real bugs only show up with two users: shared caches, session cookies that cross accounts, and locks or queues that slow everyone down. These tests show how to reproduce those situations in a single test with separate browser contexts.

---

## Fix Log

Found while moving to TypeScript (Day 20):

- **An assertion that couldn't fail:** the logout check was `toHaveURL(/$/)`. That regex matches every URL, so it passed whether or not User A was logged out. It now checks that the login button is visible and the page is no longer the inventory.
- **A sort check that was too loose:** it only asserted that the two users' first items differed, which would also pass if one sort silently didn't apply. It now asserts each user's exact first item.
- **Selectors:** CSS classes (`.inventory_item`, `.complete-header`) were replaced with the site's `data-test` attributes, matching the rest of the repo.
