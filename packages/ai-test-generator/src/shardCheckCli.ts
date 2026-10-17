#!/usr/bin/env node
// Usage: node src/shardCheckCli.ts <list.json> <merged.json> [--shards N]
//   --shards: how many shard reports were merged (only labels the table)
//   list.json:   playwright test --list --reporter=json
//   merged.json: playwright merge-reports --reporter=json
// Exits 1 if a listed test is missing, ran more than once, or an unlisted test
// ran. Test failures are reported but left to the shard jobs to fail on.
// Writes the table to the GitHub job summary when GITHUB_STEP_SUMMARY is set.
import fs from 'node:fs';
import { listedTests, ranTests, checkShards, toMarkdown } from './shardCheck.ts';
import type { ShardReport } from './shardCheck.ts';

const args = process.argv.slice(2);
const shardsAt = args.indexOf('--shards');
const shards = shardsAt === -1 ? undefined : Number(args[shardsAt + 1]);
const [listFile, mergedFile] = args.filter((_, i) => i !== shardsAt && i !== shardsAt + 1);
if (!listFile || !mergedFile || (shards !== undefined && !(shards > 0))) {
  console.error('Usage: node src/shardCheckCli.ts <list.json> <merged.json> [--shards N]');
  process.exit(2);
}

const read = (file: string): ShardReport => JSON.parse(fs.readFileSync(file, 'utf8'));
const check = checkShards(listedTests(read(listFile)), ranTests(read(mergedFile)));
const markdown = toMarkdown(check, shards);

console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
process.exitCode = check.ok ? 0 : 1;
