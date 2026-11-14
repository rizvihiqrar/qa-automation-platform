// A60: a bad change is merged, and the fix is to revert it, not to rewrite history.
// walkthrough() builds a throwaway repository in a temp folder with a local bare repository
// as "origin" (the shared branch) and two clones: the author's and a teammate's. It then:
//   1. merges a bad change into main and pushes it (the suite goes red),
//   2. has the teammate pull it and commit new work on top, as happens while a bad merge
//      sits on main,
//   3. undoes it with `git revert -m 1` and a normal push (the suite goes green), and
//   4. shows the other way, `git reset` and a force push, on a second copy of the same
//      situation: git shows the teammate no error at all, and their next ordinary push
//      sends the bad merge back to the shared branch.
// The suite run is `node --test` in the scratch repository; it stands in for CI, which
// would run the same suite on the pushed commit.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GOOD = `export const total = (prices) => prices.reduce((sum, p) => sum + p, 0);\n`;
const BAD = `export const total = (prices) => prices.reduce((sum, p) => sum + p, 0) + 1; // a stray +1\n`;
const SUITE = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from './total.js';
test('adds the prices', () => assert.equal(total([2, 3]), 5));
test('an empty basket is zero', () => assert.equal(total([]), 0));
`;
const PACKAGE = `{ "type": "module" }\n`;

export interface Step {
  step: string;
  command: string;
  suite?: 'green' | 'red';
}

export interface Walkthrough {
  steps: Step[];
  /**
   * Milliseconds from the bad merge being pushed to the suite going green after the revert,
   * without the time the teammate's pull and commit took (that is not part of the recovery).
   */
  msBadToGreen: number;
  /** `git log` of main after the revert, newest first: the bad merge is still in it. */
  history: string[];
  /** The revert went up with an ordinary push: no --force. */
  revertPushedWithoutForce: boolean;
  /** After the revert, the teammate's ordinary pull works, keeps their commit and their suite is green. */
  teammate: { pullWorked: boolean; keepsTheirCommit: boolean; hasTheRevert: boolean; suite: 'green' | 'red' };
  /** After reset and force push: what the teammate sees, and what their ordinary push does. */
  forcePush: { teammatePullShowedAnError: boolean; teammatePushAccepted: boolean; badChangeReturned: boolean };
  /** The scratch folder, removed unless keep is set. */
  folder: string;
}

// The scratch repositories ignore the user's own git settings (global config, hooks, a
// language), so the walkthrough behaves the same on every machine.
// (An empty file, because git on Windows does not accept the null device as a config path.)
const EMPTY_CONFIG = path.join(os.tmpdir(), 'revert-walkthrough-empty-gitconfig');
fs.writeFileSync(EMPTY_CONFIG, '');
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: EMPTY_CONFIG, GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', LANGUAGE: 'C' };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Scratch', '-c', 'user.email=scratch@example.test', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: GIT_ENV }).trim();
}

function tryGit(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  try { return { ok: true, out: git(cwd, ...args) }; } catch (error) { return { ok: false, out: String((error as { stderr?: string }).stderr ?? error) }; }
}

/** Runs the scratch suite. NODE_TEST_CONTEXT is removed so it is a plain run, not a nested one. */
export function runSuite(cwd: string): 'green' | 'red' {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test'], { cwd, env, encoding: 'utf8', timeout: 60_000 });
  return result.status === 0 ? 'green' : 'red';
}

const write = (cwd: string, file: string, text: string) => fs.writeFileSync(path.join(cwd, file), text);

/** A fresh origin plus the author's and the teammate's clones, with the good first commit pushed. */
function setup(root: string, name: string) {
  const origin = path.join(root, `${name}-origin.git`);
  fs.mkdirSync(origin, { recursive: true });
  git(origin, 'init', '--bare', '--initial-branch=main');
  const author = path.join(root, `${name}-author`);
  const teammate = path.join(root, `${name}-teammate`);
  git(root, 'clone', origin, author);
  write(author, 'package.json', PACKAGE);
  write(author, 'total.js', GOOD);
  write(author, 'total.test.js', SUITE);
  git(author, 'add', '-A');
  git(author, 'commit', '-m', 'Add total and its tests');
  git(author, 'push', '-u', 'origin', 'main');
  git(root, 'clone', origin, teammate);
  return { origin, author, teammate };
}

/** The bad change is a branch merged with a merge commit, as a pull request merge is. */
function mergeBadChange(author: string): string {
  git(author, 'switch', '-c', 'tweak-total');
  write(author, 'total.js', BAD);
  git(author, 'commit', '-am', 'Tweak total');
  git(author, 'switch', 'main');
  git(author, 'merge', '--no-ff', 'tweak-total', '-m', 'Merge pull request: tweak total');
  git(author, 'push', 'origin', 'main');
  return git(author, 'rev-parse', 'HEAD');
}

function teammateWorksOnTopOfIt(teammate: string) {
  git(teammate, 'pull', '--ff-only');
  write(teammate, 'README.md', 'Prices are added up by total().\n');
  git(teammate, 'add', '-A');
  git(teammate, 'commit', '-m', 'Document total');
}

export function walkthrough(options: { keep?: boolean; now?: () => number } = {}): Walkthrough {
  const now = options.now ?? Date.now;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revert-walkthrough-'));
  try {
    const steps: Step[] = [];

    // The right way.
    const a = setup(root, 'revert');
    steps.push({ step: 'The good commit is on main and the suite is green', command: 'git push -u origin main', suite: runSuite(a.author) });
    const badMerge = mergeBadChange(a.author);
    const badPushedAt = now();
    steps.push({ step: 'A bad change is merged and pushed; the suite goes red', command: 'git merge --no-ff tweak-total && git push origin main', suite: runSuite(a.author) });

    const teammateStart = now();
    teammateWorksOnTopOfIt(a.teammate);
    const teammateMs = now() - teammateStart;
    steps.push({ step: 'A teammate pulls it and commits new work on top of it', command: 'git pull --ff-only && git commit -m "Document total"' });

    git(a.author, 'revert', '-m', '1', '--no-edit', badMerge);
    const push = tryGit(a.author, 'push', 'origin', 'main');
    const suite = runSuite(a.author);
    const msBadToGreen = now() - badPushedAt - teammateMs;
    steps.push({ step: 'The merge is reverted (-m 1 keeps the first parent, main) and pushed normally; the suite goes green', command: `git revert -m 1 <merge> && git push origin main`, suite });
    const history = git(a.author, 'log', '--topo-order', '--format=%s').split('\n');

    const pull = tryGit(a.teammate, 'pull', '--no-rebase', '--no-edit');
    const teammateLog = git(a.teammate, 'log', '--format=%s');
    const teammateSuite = runSuite(a.teammate);
    steps.push({ step: 'The teammate pulls: their commit stays and the revert arrives, no force needed', command: 'git pull', suite: teammateSuite });

    // The wrong way, on a second copy of the same situation.
    const b = setup(root, 'force');
    const badMerge2 = mergeBadChange(b.author);
    teammateWorksOnTopOfIt(b.teammate);
    git(b.author, 'reset', '--hard', `${badMerge2}~1`);
    git(b.author, 'push', '--force', 'origin', 'main');
    steps.push({ step: 'The other way: reset the shared branch and force-push it. The suite is green, and the history now has no trace of the bad merge', command: 'git reset --hard HEAD~1 && git push --force origin main', suite: runSuite(b.author) });
    // The teammate's clone still holds the bad merge. Origin is now an ancestor of it, so
    // a pull says "up to date" and a plain push is accepted as a fast-forward.
    const forcePull = tryGit(b.teammate, 'pull', '--ff-only');
    const forcePush = tryGit(b.teammate, 'push', 'origin', 'main');
    git(b.author, 'pull', '--ff-only');
    const returned = runSuite(b.author) === 'red';
    steps.push({ step: 'The teammate pulls (no error: they are up to date) and pushes their next commit; the bad merge is back on the shared branch', command: 'git pull --ff-only && git push origin main', suite: returned ? 'red' : 'green' });

    return {
      steps,
      msBadToGreen,
      history,
      revertPushedWithoutForce: push.ok,
      teammate: { pullWorked: pull.ok, keepsTheirCommit: teammateLog.split(/\r?\n/).includes('Document total'), hasTheRevert: teammateLog.includes('Revert "Merge pull request: tweak total"'), suite: teammateSuite },
      forcePush: { teammatePullShowedAnError: !forcePull.ok, teammatePushAccepted: forcePush.ok, badChangeReturned: returned },
      folder: root,
    };
  } finally {
    if (!options.keep) fs.rmSync(root, { recursive: true, force: true });
  }
}

/** What git says to `git revert <merge>` without -m: it cannot know which side to keep. */
export function revertMergeWithoutParent(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revert-no-m-'));
  try {
    const repo = setup(root, 'nom').author;
    const merge = mergeBadChange(repo);
    return tryGit(repo, 'revert', '--no-edit', merge).out;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
