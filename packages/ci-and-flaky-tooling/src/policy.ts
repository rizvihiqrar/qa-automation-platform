// npm run policy: checks the gates and the fix log against the repo, then rewrites
// docs/gates.md and docs/fixes.md from the two data files. Exits 1 if either check fails.
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from './build.ts';
import { checkFixes, fixesMarkdown, readFixes } from './fixes.ts';
import { checkGates, gatesMarkdown, readGates } from './gates.ts';

const gates = readGates();
const fixes = readFixes();
const problems = [...checkGates(gates), ...checkFixes(fixes)];
if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
fs.writeFileSync(path.join(packageRoot, 'docs', 'gates.md'), gatesMarkdown(gates));
fs.writeFileSync(path.join(packageRoot, 'docs', 'fixes.md'), fixesMarkdown(fixes));
console.log(`Wrote docs/gates.md (${gates.length} gates) and docs/fixes.md (${fixes.length} fixes)`);
