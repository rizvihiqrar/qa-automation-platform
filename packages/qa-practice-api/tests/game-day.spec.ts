import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { Pager, PAGE_AFTER, RESOLVE_AFTER } from '../scripts/pager.ts';

// The game day's pager (scripts/pager.ts) and the harness (scripts/game-day.ts, run by hand).

const feed = (pager: Pager, answers: boolean[]) => answers.map((ready) => pager.check(ready));

test('GD-01 one or two failed checks page nobody, the third in a row does, and only once @regression', () => {
  const pager = new Pager();
  expect(feed(pager, [false, false])).toEqual([null, null]);
  expect(pager.check(false)).toBe('page');
  expect(feed(pager, [false, false, false])).toEqual([null, null, null]);
  expect(PAGE_AFTER).toBe(3);
});

test('GD-02 a good answer between failures starts the count again @regression', () => {
  const pager = new Pager();
  expect(feed(pager, [false, false, true, false, false])).toEqual([null, null, null, null, null]);
  expect(pager.paging).toBe(false);
});

test('GD-03 the page clears after three good answers in a row, and a bad one in between starts that count again @regression', () => {
  const pager = new Pager();
  feed(pager, [false, false, false]);
  expect(feed(pager, [true, true, false, true, true])).toEqual([null, null, null, null, null]);
  expect(pager.paging).toBe(true);
  expect(pager.check(true)).toBe('resolve');
  expect(RESOLVE_AFTER).toBe(3);
});

test('GD-04 a new outage after a cleared page pages again @regression', () => {
  const pager = new Pager();
  feed(pager, [false, false, false, true, true, true]);
  expect(feed(pager, [false, false, false])).toEqual([null, null, 'page']);
});

test('GD-05 the game day starts the same Postgres and Toxiproxy images as the tests @regression', () => {
  const image = (file: string, name: string) => readFileSync(file, 'utf8').match(new RegExp(String.raw`${name}\s*=\s*'([^']+)'`))?.[1];
  for (const name of ['POSTGRES_IMAGE', 'TOXIPROXY_IMAGE']) {
    const used = image('scripts/game-day.ts', name);
    expect(used, name).toBeTruthy();
    expect(used).toBe(image('scripts/with-postgres.ts', name));
  }
});
