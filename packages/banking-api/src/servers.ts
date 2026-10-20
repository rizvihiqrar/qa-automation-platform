import { spawn, type ChildProcess } from 'node:child_process';

export interface Running {
  bases: string[];
  stop(): Promise<void>;
}

// Real server processes (`node src/server.ts`) on one SQLite file, each with its own
// connection: the setup in which two requests really run at the same time. Started one
// after another, so only one creates the schema. Used by the race tests and `npm run race`.
export async function spawnServers(count: number, dbPath: string, env: Record<string, string> = {}): Promise<Running> {
  const children: ChildProcess[] = [];
  const bases: string[] = [];
  const stop = () => Promise.all(children.map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill();
  }))).then(() => undefined);

  try {
    for (let i = 0; i < count; i++) {
      const child = spawn(process.execPath, ['src/server.ts'], {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, ...env, PORT: '0', DATABASE_PATH: dbPath },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      children.push(child);
      bases.push(await new Promise<string>((resolve, reject) => {
        child.once('exit', (code) => reject(new Error(`server ${i} exited with ${code}`)));
        child.stdout!.on('data', (chunk: Buffer) => {
          const port = /listening on http:\/\/localhost:(\d+)/.exec(chunk.toString())?.[1];
          if (port) resolve(`http://127.0.0.1:${port}`);
        });
      }));
    }
  } catch (err) {
    await stop();
    throw err;
  }
  return { bases, stop };
}
