// Stale-docs detector (A468). The READMEs and technical guides make claims about the code: "run
// `npm run report`" and "see [the report](reports/2026-11.md)". When a script is renamed or a file
// is moved, the sentence stays and nobody notices. This reads every Markdown file git tracks (the
// READMEs and technical guides, the guides in docs folders, the tool READMEs) and lists the claims
// that no longer match:
//
//   - an `npm run <name>` that no package.json defines;
//   - a relative link or image (Markdown, or an HTML src or href) that points at a file git does
//     not track.
//
// "Tracked", not "on disk": a file the .gitignore hides is on the author's disk and missing for
// everyone else, which is how the monthly report links were broken for four days (2026-11-11).
// Test counts are not checked here: scripts/readme-totals.test.mjs already does that.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Where `npm run` may be pointed at: the package itself, the repo root (typecheck, lint:playwright)
// and the screenshot tool (terminal, ui), the places the docs send readers. The root README and
// guide talk about all the packages at once ("npm run smoke in multi-user-flow-patterns"), so for
// them any package's script counts.
const SCRIPT_HOMES = ['scripts/screenshots'];

// Fenced code blocks hold example output; links inside them are not claims about this repo.
const withoutFences = (text) => text.replace(/^```[\s\S]*?^```/gm, '');

// The script names after `npm run`. A name starts and ends on a letter, digit or underscore, so
// "npm run flow: the refund..." in an image caption reads as "flow" followed by a colon and not
// as a script called "flow:", and "npm run -w packages/x test" has no script named "-w".
// Fenced blocks count: a command in one is a claim as much as a command in a sentence.
export function npmRunClaims(text) {
  return [...new Set([...text.matchAll(/npm run (\w(?:[\w:.-]*\w)?)/g)].map((m) => m[1]))];
}

// Relative link and image targets, anchors and queries removed: Markdown `](target)` and the src
// and href of the HTML the READMEs use for banners. Web links, mail links and in-page anchors are
// not files in this repo. Links inside fenced blocks are examples, not claims, so they are
// skipped. A name with a stray % that is not valid percent-encoding is read as written.
export function relativeLinks(text) {
  const raws = [];
  const body = withoutFences(text);
  for (const m of body.matchAll(/\]\(\s*<?([^)\s>]+)/g)) raws.push(m[1]);
  for (const m of body.matchAll(/<[^>]*?\b(?:src|href)=["']([^"']+)["']/g)) raws.push(m[1]);
  const targets = [];
  for (const raw of raws) {
    if (/^([a-z][a-z0-9+.-]*:|#)/i.test(raw) || /[<{]/.test(raw)) continue; // web, anchor, or a template placeholder
    const bare = raw.split(/[#?]/)[0];
    let target = bare;
    try {
      target = decodeURIComponent(bare);
    } catch {
      // not valid percent-encoding: use it as written
    }
    if (target) targets.push(target);
  }
  return [...new Set(targets)];
}

// Does a link, written in the file `from`, land on a tracked file or a folder that has tracked
// files in it? `tracked` is the set of repo-relative paths, forward slashes.
export function linkResolves(from, target, tracked) {
  const joined = target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(from), target);
  const resolved = path.posix.normalize(joined).replace(/\/$/, '');
  if (resolved === '' || resolved === '.') return true;
  if (resolved === '..' || resolved.startsWith('../')) return false;
  if (tracked.has(resolved)) return true;
  const prefix = `${resolved}/`;
  for (const file of tracked) if (file.startsWith(prefix)) return true;
  return false;
}

export function trackedFiles(root) {
  const res = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.stderr}`);
  return new Set(res.stdout.split('\0').filter(Boolean));
}

const scriptsIn = (dir) => {
  const file = path.join(dir, 'package.json');
  return fs.existsSync(file) ? Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).scripts ?? {}) : [];
};

// The scripts a doc may name: its own package's, the root's and the screenshot tool's, plus
// every package's when the doc is not inside a package.
export function knownScripts(root, dir) {
  const homes = ['', ...SCRIPT_HOMES];
  if (dir) homes.push(dir);
  else homes.push(...fs.readdirSync(path.join(root, 'packages')).map((pkg) => `packages/${pkg}`));
  return new Set(homes.flatMap((home) => scriptsIn(path.join(root, home))));
}

// Every Markdown file git tracks, as { file (repo-relative), dir (its package folder, or '' for
// the root, the docs folder and the tools) }.
export function docFiles(tracked) {
  return [...tracked]
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => ({ file, dir: file.match(/^packages\/[^/]+/)?.[0] ?? '' }));
}

// All the claims that no longer match, as { file, claim, problem }.
export function findDrift(root, tracked = trackedFiles(root)) {
  const drift = [];
  for (const { file, dir } of docFiles(tracked)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    const known = knownScripts(root, dir);
    for (const name of npmRunClaims(text)) {
      if (!known.has(name)) drift.push({ file, claim: `npm run ${name}`, problem: 'no package.json it may point at defines this script' });
    }
    for (const target of relativeLinks(text)) {
      if (!linkResolves(file, target, tracked)) drift.push({ file, claim: target, problem: 'not a file git tracks (moved, deleted, or hidden by .gitignore)' });
    }
  }
  return drift;
}
