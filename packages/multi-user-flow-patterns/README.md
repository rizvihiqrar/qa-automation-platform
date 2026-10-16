# multi-user-flow-patterns

Playwright patterns for testing more than one user at once: concurrent sessions, state isolation between users, and parallel workflows. Each user gets its own browser context, so cookies and storage never leak between them. The target is the public [Sauce Demo](https://www.saucedemo.com) site.

---

## What It Tests

| File | Tests | Pattern |
|---|---:|---|
| `concurrent-sessions.spec.js` | 3 | Two and three users logged in at once; a normal user alongside the `performance_glitch_user` |
| `context-isolation.spec.js` | 3 | One user's cart, logout, and sort choice don't affect another user |
| `parallel-workflows.spec.js` | 3 | Two users check out at the same time; users navigate independently; parallel sessions don't slow each other past a threshold |

**9 tests across 3 files.**

---

## Running

```bash
npm install
npx playwright install chromium

npm test            # all tests
npm run smoke       # @smoke only
```

Set `BASE_URL` to point the suite at another copy of the app.

---

## Why It Matters

Many real bugs only show up with two users: shared caches, session cookies that cross accounts, and locks or queues that slow everyone down. These tests show how to reproduce those situations in a single test with separate browser contexts.
