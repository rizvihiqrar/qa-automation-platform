// Shows the CI failure on any machine: connect to a host whose first connect takes
// longer than the attempt timeout, with an unreachable IPv6 address after it (as on a
// runner with no IPv6). Default host is far from Canada, so the connect takes ~200 ms.
//   node scripts/slow-connect-repro.js [host]
// Expected: 10 ms and 50 ms fail with the CI error, 5000 ms connects.
const dns = require('dns');
const net = require('net');

const host = process.argv[2] || 'www.gov.au';
const lookup = (name, _opts, cb) =>
  dns.lookup(name, { family: 4, all: true }, (err, addrs) =>
    err ? cb(err) : cb(null, [addrs[0], { address: '100::1', family: 6 }]));

for (const ms of [10, 50, 5000]) {
  const start = Date.now();
  const socket = net.connect({ host, port: 443, lookup, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: ms });
  socket.on('connect', () => {
    console.log(`${ms} ms per address: connected in ${Date.now() - start} ms`);
    socket.destroy();
  });
  socket.on('error', (err) => {
    const codes = (err.errors || [err]).map((e) => `${e.code} ${e.address}`).join(', ');
    console.log(`${ms} ms per address: ${err.name} [${codes}]`);
  });
}
