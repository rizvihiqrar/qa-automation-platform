import fs from 'node:fs';
import { askBrowser, combine, differing, toTable } from './matrix.ts';
import { PROBES } from './probes.ts';

// Runs every probe in every browser and prints the matrix. In CI the same table goes to the job summary.
const answers = combine({ chromium: await askBrowser('chromium'), firefox: await askBrowser('firefox'), webkit: await askBrowser('webkit') });
const table = toTable(answers);
console.log(table);
console.log(`${differing(answers).length} of ${PROBES.length} probes differ between the browsers.`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Browser matrix\n\n${table}\n`);
