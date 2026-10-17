// Usage: node scripts/require-scenarios.ts <tag expression>
// Exits 1 if the tag expression selects no scenarios.
//
// cucumber-js --tags exits 0 when nothing matches, so a mistyped tag (@smok)
// would turn a smoke run into a green run that tested nothing. Playwright's
// --grep fails in the same case; this gives Cucumber the same behaviour.
import { loadConfiguration, loadSources } from '@cucumber/cucumber/api';

const tags = process.argv[2];
if (!tags) {
  console.error('Usage: node scripts/require-scenarios.ts <tag expression>');
  process.exit(2);
}

const { runConfiguration } = await loadConfiguration({ provided: { tags } });
const { plan } = await loadSources(runConfiguration.sources);
if (plan.length === 0) {
  console.error(`No scenarios match the tags "${tags}". Check the spelling of the tag.`);
  process.exit(1);
}
console.log(`${plan.length} scenario(s) match "${tags}".`);
