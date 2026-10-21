// GitHub runners have no IPv6. For a host with both kinds of address, Node gives each
// address 250 ms before trying the next (happy eyeballs), so an IPv4 connect slower
// than that is dropped for an IPv6 address that fails at once:
// AggregateError [ETIMEDOUT <ipv4>, ENETUNREACH <ipv6>]. The Pact proxy swallows that
// and the verifier waits out the 30 s test timeout. Give each address 5 s instead.
// Repro: npm run repro:slow-connect (scripts/slow-connect-repro.js).
const net = require('net');

const ATTEMPT_MS = 5000;
net.setDefaultAutoSelectFamilyAttemptTimeout(ATTEMPT_MS);

module.exports = { ATTEMPT_MS };
