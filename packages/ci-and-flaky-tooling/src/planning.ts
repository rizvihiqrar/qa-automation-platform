// npm run planning: checks the sprint and release data, then rewrites docs/burndown.md and
// docs/estimates.md from data/sprint.json and data/releases.json. Exits 1 if either file has problems.
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from './build.ts';
import { burndownMarkdown, checkSprint, readSprint } from './burndown.ts';
import { checkEstimates, estimatesMarkdown, readEstimates } from './estimates.ts';

const sprint = readSprint();
const estimates = readEstimates();
const problems = [...checkSprint(sprint).map((p) => `data/sprint.json: ${p}`), ...checkEstimates(estimates).map((p) => `data/releases.json: ${p}`)];
if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
fs.writeFileSync(path.join(packageRoot, 'docs', 'burndown.md'), burndownMarkdown(sprint));
fs.writeFileSync(path.join(packageRoot, 'docs', 'estimates.md'), estimatesMarkdown(estimates));
console.log(`Wrote docs/burndown.md (${sprint.days} days, ${sprint.tickets.length} tickets) and docs/estimates.md (${estimates.releases.length} releases)`);
