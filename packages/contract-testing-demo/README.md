# contract-testing-demo

Consumer-driven contract testing with [Pact](https://docs.pact.io). A frontend consumer defines what it expects from a users API, Pact records those expectations as a contract, and the provider check verifies the real [DummyJSON](https://dummyjson.com) API still honours them.

**In plain English:** When two pieces of software talk to each other, each side expects certain things from the other. This writes those expectations down and checks them automatically, so a change on one side can't silently break the other.

---

## How It Works

```
consumer/userConsumer.spec.js        provider/userProvider.spec.js
  defines 3 interactions      ──►       verifies the contract
  against a Pact mock server            against https://dummyjson.com
            │                                    ▲
            └──── pacts/FrontendApp-UsersAPI.json ┘
```

| Interaction | Request | Expected |
|---|---|---|
| A paginated user list | `GET /users` | 200 with a `users` array |
| A single user | `GET /users/1` | 200 with the user's fields |
| A missing user | `GET /users/9999` | 404 |

---

## Running

```bash
npm install
npm test               # consumer first (writes the pact), then provider
npm run test:consumer
npm run test:provider
```

**4 tests:** 3 consumer interactions and 1 provider verification covering all three.

---

## Fix Log

- **Order:** `npm test` ran plain `jest`, which could start the provider check before the consumer had written the pact file. It now runs the consumer, then the provider.
- **Compression:** DummyJSON sits behind Cloudflare and returns brotli-compressed bodies when the client allows it. The Pact verifier couldn't parse them ("expected value at line 1 column 1") on the two 200 responses. The verifier now sends `Accept-Encoding: identity`.
