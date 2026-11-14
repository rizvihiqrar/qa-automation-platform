import { walkthrough } from './revert.ts';

const w = walkthrough();
w.steps.forEach((s, i) => console.log(`${i + 1}. ${s.step}${s.suite ? `  [suite ${s.suite}]` : ''}\n     ${s.command}`));
console.log(`\nFrom the bad merge being pushed to a green suite after the revert: ${(w.msBadToGreen / 1000).toFixed(1)} s`);
console.log('(this scratch suite has two tests; a real pipeline adds its queue and run time)');
console.log('\nHistory on main after the revert, newest first:');
w.history.forEach((line) => console.log(`  ${line}`));
