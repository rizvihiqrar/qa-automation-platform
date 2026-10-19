#!/usr/bin/env node
// Starts qa-practice-api on a free port, runs the chosen k6 tests against it,
// stops the server, and prints a summary. Exit code 1 if any threshold fails.
//
//   node src/run.js smoke load spike     (default: smoke load)
//   K6_BIN=path/to/k6 node src/run.js    (if k6 isn't on PATH)
//   node src/run.js load --url http://localhost:4000   (an API that's already running)

import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { readSummary, toMarkdown } from './summarize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const K6 = process.env.K6_BIN || 'k6';
const TESTS = ['smoke', 'load', 'spike'];
// The admin the started server is seeded with; the k6 setup signs in as it to create
// products. With --url, start that server with the same ADMIN_EMAIL and ADMIN_PASSWORD.
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@k6.test', password: process.env.ADMIN_PASSWORD || 'K6-admin-pass-1!' };
// Password for the users the k6 scripts register (k6 reads __ENV, not process.env).
const USER_PASSWORD = process.env.K6_USER_PASSWORD || 'Load-test-1!';

const freePort = () => new Promise((resolve) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => {
    // address() is a string for pipe/socket listeners; this one is TCP.
    const address = srv.address();
    srv.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
  });
});

async function waitForHealth(url) {
  for (let i = 0; i < 75; i++) {
    try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`API did not become healthy at ${url}`);
}

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
let baseUrl = urlIdx !== -1 ? args[urlIdx + 1] : null;
const chosen = args.filter((a, i) => !a.startsWith('--') && (urlIdx === -1 || i !== urlIdx + 1));
const tests = chosen.length ? chosen : ['smoke', 'load'];
const unknown = tests.filter((t) => !TESTS.includes(t));
if (unknown.length) { console.error(`Unknown test(s): ${unknown.join(', ')}. Use ${TESTS.join(', ')}.`); process.exit(2); }

let server = null;
try {
  if (!baseUrl) {
    const port = await freePort();
    server = spawn(process.execPath, [path.join(ROOT, '..', 'qa-practice-api', 'src', 'server.ts')], { env: { ...process.env, PORT: String(port), ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, stdio: 'ignore' });
    baseUrl = `http://127.0.0.1:${port}`;
  }
  await waitForHealth(baseUrl);
  fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });

  const summaries = [];
  for (const test of tests) {
    const res = spawnSync(K6, ['run', '--quiet', '-e', `BASE_URL=${baseUrl}`, '-e', `ADMIN_EMAIL=${ADMIN.email}`, '-e', `ADMIN_PASSWORD=${ADMIN.password}`, '-e', `K6_USER_PASSWORD=${USER_PASSWORD}`, path.join('k6', `${test}.js`)], { cwd: ROOT, encoding: 'utf8' });
    if (res.error) throw new Error(`Could not run k6 (${K6}): ${res.error.message}. Install k6 or set K6_BIN.`);
    const file = path.join(ROOT, 'results', `${test}.json`);
    if (!fs.existsSync(file)) throw new Error(`k6 ${test} wrote no summary:\n${res.stderr || res.stdout}`);
    summaries.push(readSummary(test, JSON.parse(fs.readFileSync(file, 'utf8'))));
  }

  const report = toMarkdown(summaries);
  fs.writeFileSync(path.join(ROOT, 'results', 'REPORT.md'), report);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## k6 performance\n\n${report}`);
  if (summaries.some((s) => !s.passed)) process.exitCode = 1;
} catch (err) {
  console.error(err.message);
  process.exitCode = 2;
} finally {
  server?.kill();
}
