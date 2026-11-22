// The real Docker and registry steps for src/promote.js: build and push the staging image,
// start that exact image from the registry, run the smoke command against it, re-tag.

import { spawnSync } from 'child_process';
import net from 'net';
import { digestOf, retag } from './registry.js';

const docker = (args, options = {}) => spawnSync('docker', args, { encoding: 'utf8', ...options });

// Registry and Docker Hub calls sometimes fail for a moment; try a few times before giving up.
function dockerRetry(args, tries = 3) {
  let res;
  for (let i = 0; i < tries; i++) {
    res = docker(args);
    if (res.status === 0) return res;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)']);
  }
  throw new Error(`docker ${args.slice(0, 2).join(' ')} failed: ${res.stderr || res.stdout}`);
}

const freePort = () => new Promise((resolve) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => {
    const address = srv.address();
    srv.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
  });
});

async function waitForHealth(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the container did not become healthy at ${url}`);
}

/**
 * @param {{
 *   registry: string,            // host:port of the registry, e.g. localhost:5000
 *   repo: string,                // image name, e.g. qa-practice-api
 *   context: string,             // folder with the Dockerfile
 *   smokeCommand: string,        // run with BASE_URL pointing at the container
 *   smokeCwd: string,
 *   containerEnv?: string[],     // KEY=value pairs for the container
 *   stagingTag?: string,
 *   buildLabels?: string[],      // extra image labels, to make a different image
 * }} cfg
 */
export function dockerSteps(cfg) {
  const { registry, repo, context, smokeCommand, smokeCwd, containerEnv = [], stagingTag = 'staging', buildLabels = [] } = cfg;
  const base = `http://${registry}`;
  const stagingRef = `${registry}/${repo}:${stagingTag}`;

  return {
    digestOf: (tag) => digestOf(base, repo, tag),
    retag: (digest, tag) => retag(base, repo, digest, tag),

    async build() {
      const built = docker(['build', '--quiet', ...buildLabels.flatMap((l) => ['--label', l]), '-t', stagingRef, context]);
      if (built.status !== 0) throw new Error(`docker build failed: ${built.stderr || built.stdout}`);
      dockerRetry(['push', '--quiet', stagingRef]);
      const digest = await digestOf(base, repo, stagingTag);
      if (!digest) throw new Error(`${stagingRef} is not in the registry after the push`);
      return digest;
    },

    async smoke(digest) {
      const ref = `${registry}/${repo}@${digest}`;
      // Drop the local copy so the container can only start from what the registry holds.
      docker(['rmi', stagingRef]);
      const port = await freePort();
      const containerPort = containerEnv.find((e) => e.startsWith('PORT='))?.slice(5) ?? '4000';
      const run = docker(['run', '-d', '--rm', '-p', `127.0.0.1:${port}:${containerPort}`, ...containerEnv.flatMap((e) => ['-e', e]), ref]);
      if (run.status !== 0) throw new Error(`docker run ${ref} failed: ${run.stderr}`);
      const id = run.stdout.trim();
      try {
        const ranImage = docker(['inspect', '--format', '{{.Config.Image}}', id]).stdout.trim();
        if (ranImage !== ref) throw new Error(`the container runs ${ranImage}, not ${ref}`);
        await waitForHealth(`http://127.0.0.1:${port}`);
        const res = spawnSync(smokeCommand, { shell: true, cwd: smokeCwd, stdio: 'inherit', env: { ...process.env, BASE_URL: `http://127.0.0.1:${port}` } });
        return { passed: res.status === 0, detail: res.status === 0 ? `smoke passed on ${ref}` : `smoke failed (exit ${res.status}) on ${ref}` };
      } finally {
        docker(['stop', '--time', '2', id]);
      }
    },
  };
}
