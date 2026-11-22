#!/usr/bin/env node
/**
 * Usage:
 *   node src/promote-cli.js --registry localhost:5000 --repo qa-practice-api \
 *     --context ../qa-practice-api --smoke "npx playwright test --grep @smoke" \
 *     --smoke-cwd ../qa-practice-api --container-env ADMIN_EMAIL=a@b.test --container-env ADMIN_PASSWORD=...
 *
 * Builds the image once, pushes it with the staging tag, runs the smoke command against that
 * exact image (BASE_URL points at the container), and only if smoke passes points the release tag at it.
 * Exit 0 when promoted, 1 when smoke failed (the release tag is untouched), 2 on bad arguments or errors.
 */

import fs from 'fs';
import { pathToFileURL } from 'url';
import { dockerSteps } from './docker-steps.js';
import { promote } from './promote.js';

const FLAGS = ['--registry', '--repo', '--context', '--smoke', '--smoke-cwd', '--container-env', '--label'];

export function parseArgs(argv) {
  const opts = { registry: null, repo: null, context: null, smoke: null, smokeCwd: process.cwd(), containerEnv: [], labels: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!FLAGS.includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    if (flag === '--container-env') opts.containerEnv.push(value);
    else if (flag === '--label') opts.labels.push(value);
    else opts[flag === '--smoke-cwd' ? 'smokeCwd' : flag.slice(2)] = value;
    i++;
  }
  for (const required of ['registry', 'repo', 'context', 'smoke']) if (!opts[required]) throw new Error(`--${required} is required`);
  return opts;
}

export const toMarkdown = (r) => [
  `## Build promotion: ${r.promoted ? '✅ promoted' : '⛔ not promoted'}`,
  '',
  `- Image tested: \`${r.tested}\``,
  `- Release tag now points to: \`${r.released ?? 'nothing yet'}\``,
  `- Release tag before: \`${r.previous ?? 'nothing'}\``,
  `- ${r.detail}`,
  '',
].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = await promote(dockerSteps({
      registry: opts.registry, repo: opts.repo, context: opts.context, smokeCommand: opts.smoke,
      smokeCwd: opts.smokeCwd, containerEnv: opts.containerEnv, buildLabels: opts.labels,
    }));
    const markdown = toMarkdown(result);
    console.log(markdown);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    if (!result.promoted) process.exitCode = 1;
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
