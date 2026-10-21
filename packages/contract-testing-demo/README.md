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
npm run repro:slow-connect   # shows the CI network failure fixed below
```

**5 tests:** 3 consumer interactions, 1 provider verification covering all three, and 1 check of the network setting below.

---

## Fix Log

- **Order:** `npm test` ran plain `jest`, which could start the provider check before the consumer had written the pact file. It now runs the consumer, then the provider.
- **Compression:** DummyJSON sits behind Cloudflare and returns brotli-compressed bodies when the client allows it. The Pact verifier couldn't parse them ("expected value at line 1 column 1") on the two 200 responses. The verifier now sends `Accept-Encoding: identity`.
- **Slow first connect (flaky, 1 CI run in 80):** the provider check failed with `AggregateError [ETIMEDOUT 172.64.80.1:443, ENETUNREACH 2606:4700:…]`, then hung until the 30 s timeout. Node tries each address of a host for 250 ms before moving on (happy eyeballs). The runner has no IPv6, so when the IPv4 connect to Cloudflare took longer than 250 ms, Node dropped it for an IPv6 address that failed at once. The Pact proxy swallowed the error and the verifier waited. [`provider/network.js`](provider/network.js) gives each address 5 s, and a test fails if that setting is lost (checked: with the line removed it reads 250). `npm run repro:slow-connect` shows the same error on any machine: it connects to a far-away host with 10 ms and 50 ms per address, then connects with 5 s.
