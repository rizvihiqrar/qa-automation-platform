import { startApi } from './api.ts';
import { PLANS, ROOT, reportsWithTokens, runPass, type Pass } from './newman-run.ts';

// One command: start the API on a free port, run the plan's Newman passes, stop the API.
//   node scripts/run.ts <all|smoke|flow|data> [--report] [--times N]
// --times N repeats the whole plan N times, each round on a fresh API.
const [planName = 'all', ...flags] = process.argv.slice(2);
const plan = PLANS[planName];
if (!plan) {
  console.error(`Unknown plan ${planName}: use ${Object.keys(PLANS).join(', ')}`);
  process.exit(2);
}
const report = flags.includes('--report');
const timesFlag = flags.indexOf('--times');
const times = timesFlag === -1 ? 1 : Number(flags[timesFlag + 1]);
if (!Number.isInteger(times) || times < 1) {
  console.error('--times needs a whole number of at least 1');
  process.exit(2);
}

async function round(passes: Pass[]): Promise<{ assertions: number; failures: number }> {
  const api = await startApi(`${ROOT}src`);
  const total = { assertions: 0, failures: 0 };
  try {
    for (const pass of passes) {
      const result = await runPass(pass, api.baseUrl, { report, quiet: times > 1 });
      // A run that asserted nothing has proved nothing, so it counts as a failure.
      if (result.assertions === 0) console.error(`${pass.name}: no assertions ran`);
      for (const failure of result.failed) console.error(`failed: ${failure}`);
      total.failures += result.failed.length + (result.assertions === 0 ? 1 : 0);
      total.assertions += result.assertions;
    }
  } finally {
    api.stop();
  }
  return total;
}

let failures = 0;
for (let at = 1; at <= times; at += 1) {
  const { assertions, failures: failed } = await round(plan);
  failures += failed;
  console.log(`${times > 1 ? `Round ${at} of ${times}: ` : ''}${plan.length} Newman ${plan.length === 1 ? 'pass' : 'passes'}: ${assertions} assertions, ${failed} failed`);
}

const leaks = reportsWithTokens();
for (const file of leaks) console.error(`reports/${file} holds a live token`);
process.exit(failures + leaks.length === 0 ? 0 : 1);
