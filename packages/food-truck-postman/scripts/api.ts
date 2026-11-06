import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

export interface RunningApi { baseUrl: string; child: ChildProcess; stop(): void }

const START_TIMEOUT_MS = 15_000;

// Starts the API in its own process on a free port and reads the port from its first
// log line. `srcDir` lets the planted-bug run start a changed copy of the source.
export function startApi(srcDir: string): Promise<RunningApi> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(srcDir, 'server.ts')], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('the API did not start in time'));
    }, START_TIMEOUT_MS);
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`the API stopped while starting (exit code ${code})`)));
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /listening on (http:\/\/\S+)/.exec(output);
      if (!match) return;
      clearTimeout(timer);
      child.removeAllListeners('exit');
      resolve({ baseUrl: match[1]!, child, stop: () => child.kill() });
    });
  });
}
