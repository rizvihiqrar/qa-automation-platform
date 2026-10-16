#!/usr/bin/env node
/**
 * Usage:
 *   node src/cli.js debrief sessions/              # debrief for every .md session in a folder
 *   node src/cli.js new --charter "Explore ..." --area Checkout --timebox 60 --tester "Name"
 *       prints a new session file to fill in (redirect it to a file)
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { parseSession, measureSession, newSessionTemplate } from './session.js';
import { formatDebrief } from './debrief.js';

const option = (argv, flag) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : undefined; };

export function loadSessions(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .map((f) => measureSession(parseSession(fs.readFileSync(path.join(dir, f), 'utf8'), f)));
}

export function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'debrief') {
    if (!rest[0]) throw new Error('Usage: debrief <folder of session files>');
    return formatDebrief(loadSessions(rest[0]));
  }
  if (command === 'new') {
    return newSessionTemplate({
      charter: option(rest, '--charter'),
      area: option(rest, '--area'),
      tester: option(rest, '--tester'),
      timebox: option(rest, '--timebox') ? Number(option(rest, '--timebox')) : undefined,
    });
  }
  throw new Error('Commands: debrief <folder>, new --charter "..." [--area] [--tester] [--timebox]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
