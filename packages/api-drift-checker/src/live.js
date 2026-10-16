#!/usr/bin/env node
// Starts packages/qa-practice-api on a free port, runs the scenario, checks every
// response against the spec, and stops the server. Exit code 1 on any drift.
//   node src/live.js            (needs `npm ci` in ../qa-practice-api first)
//   node src/live.js --url http://localhost:4000   (an API that's already running)

import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { runScenario, untestedOperations, formatResults } from './runner.js';
import { steps } from '../scenarios/qa-practice-api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'spec', 'qa-practice-api.openapi.json'), 'utf8'));

const freePort = () => new Promise((resolve) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

async function waitForHealth(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`API did not become healthy at ${url}`);
}

const urlArg = process.argv.indexOf('--url');
let baseUrl = urlArg !== -1 ? process.argv[urlArg + 1] : null;
// --json <file> also writes { passed, summary } for tools such as the release gate.
const jsonArg = process.argv.indexOf('--json');
const jsonFile = jsonArg !== -1 ? process.argv[jsonArg + 1] : null;
let child = null;

try {
  if (!baseUrl) {
    const port = await freePort();
    const server = path.join(HERE, '..', '..', 'qa-practice-api', 'src', 'server.js');
    child = spawn(process.execPath, [server], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
    baseUrl = `http://127.0.0.1:${port}`;
  }
  await waitForHealth(baseUrl);
  const results = await runScenario({ baseUrl, spec, steps: steps() });
  console.log(formatResults(results, untestedOperations(spec, results)));
  const drifted = results.filter((r) => r.issues.length).length;
  if (jsonFile) {
    fs.writeFileSync(jsonFile, JSON.stringify({
      passed: drifted === 0,
      summary: `${results.length - drifted}/${results.length} responses match the spec`,
      drifted,
      total: results.length,
    }, null, 2));
  }
  if (drifted) process.exitCode = 1;
} catch (err) {
  console.error(err.message);
  process.exitCode = 2;
} finally {
  child?.kill();
}
