// A second copy of the API with settings of its own, for tests that need a server started
// differently (a feature flag, a bad setting). The suite's own server keeps its settings, so
// nothing else is affected, and the copy is on its own port with its own in-memory data.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { expect } from '@playwright/test';
import { ADMIN } from './admin.ts';

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer().listen(0, () => {
    const { port } = s.address() as { port: number };
    s.close(() => resolve(port));
  });
});

export interface Started {
  url: string;
  log: () => string;
  stop: () => Promise<void>;
}

// Waits until /health answers; fails with the server's own output if it stops first.
export async function startServer(env: Record<string, string> = {}): Promise<Started> {
  const port = await freePort();
  let output = '';
  const child = spawn(process.execPath, ['src/server.ts'], {
    // No DATABASE_URL: the copy keeps its data in memory, whatever the suite is run on.
    env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test', PORT: String(port), ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const url = `http://localhost:${port}`;
  // Resolves once the process has exited, so the next test never meets a half-dead server.
  const stop = () => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill();
  });
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error(`the server stopped (exit code ${child.exitCode}):\n${output}`);
      return (await fetch(`${url}/health`).catch(() => null))?.status;
    }, { timeout: 15_000 }).toBe(200);
  } catch (err) {
    await stop();
    throw err;
  }
  return { url, log: () => output, stop };
}

// A server that is meant to refuse to start: resolves with its exit code and output.
export function startFailing(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(process.execPath, ['src/server.ts'], {
      env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test', PORT: '0', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    // Settles once, whichever of the timer, the exit or a failure to start comes first.
    let done = false;
    const finish = (code: number | null, extra = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, output: output + extra });
    };
    const timer = setTimeout(() => { child.kill(); finish(null, '\n(still running after 10 s)'); }, 10_000);
    child.on('exit', (code) => finish(code));
    child.on('error', (err) => finish(null, `\n(could not start: ${err.message})`));
  });
}
