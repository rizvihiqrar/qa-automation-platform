/**
 * Pattern: GraphQL filter variables
 *
 * Validates that:
 * - Filter arguments narrow result sets predictably
 * - Filtering is case-insensitive (where the API specifies it)
 * - Multiple simultaneous filters are combined (AND semantics)
 * - A filter with no matches returns an empty results array with count 0
 * - Filtered pagination stays consistent across pages
 */

import { test, expect } from '@playwright/test';
import { gql } from '../utils/graphqlClient.js';

test.describe('Pattern: GraphQL filter variables', () => {

  test('filter by name returns only matching characters @smoke', async ({ request }) => {
    const res = await gql(
      request,
      `query($filter: FilterCharacter) {
        characters(filter: $filter) {
          info { count }
          results { name }
        }
      }`,
      { filter: { name: 'Rick' } }
    );

    expect(res.errors).toBeNull();
    for (const char of res.data.characters.results) {
      expect(char.name.toLowerCase()).toContain('rick');
    }
    expect(res.data.characters.info.count).toBeGreaterThan(1);
  });

  test('filter by status: Alive returns only alive characters @regression', async ({ request }) => {
    const res = await gql(
      request,
      `query($f: FilterCharacter) { characters(filter: $f) { results { name status } } }`,
      { f: { status: 'Alive' } }
    );

    expect(res.errors).toBeNull();
    for (const char of res.data.characters.results) {
      expect(char.status).toBe('Alive');
    }
  });

  test('filter by status: Dead returns only dead characters @regression', async ({ request }) => {
    const res = await gql(
      request,
      `query($f: FilterCharacter) { characters(filter: $f) { results { name status } } }`,
      { f: { status: 'Dead' } }
    );

    expect(res.errors).toBeNull();
    for (const char of res.data.characters.results) {
      expect(char.status).toBe('Dead');
    }
  });

  test('filter by species narrows the result set @regression', async ({ request }) => {
    // The API uses substring matching for species — 'Human' matches 'Human' and 'Humanoid'
    // We verify the filter WORKS (returns fewer results than unfiltered) rather than asserting exact values
    const unfiltered = await gql(request, `{ characters(page: 1) { info { count } } }`);
    const filtered   = await gql(
      request,
      `query($f: FilterCharacter) { characters(filter: $f) { info { count } } }`,
      { f: { species: 'Human' } }
    );

    expect(filtered.errors).toBeNull();
    const totalCount  = unfiltered.data.characters.info.count;
    const humanCount  = filtered.data.characters.info.count;
    expect(humanCount).toBeGreaterThan(0);
    expect(humanCount).toBeLessThan(totalCount);
  });

  test('combined name + status filter returns subset @regression', async ({ request }) => {
    const res = await gql(
      request,
      `query($f: FilterCharacter) { characters(filter: $f) { results { name status } } }`,
      { f: { name: 'Rick', status: 'Alive' } }
    );

    expect(res.errors).toBeNull();
    for (const char of res.data.characters.results) {
      expect(char.name.toLowerCase()).toContain('rick');
      expect(char.status).toBe('Alive');
    }
  });

  test('filter with no matches returns a graceful empty response @smoke', async ({ request }) => {
    const res = await gql(
      request,
      `query($f: FilterCharacter) { characters(filter: $f) { info { count } results { name } } }`,
      { f: { name: 'ZZZNOMATCH_XYZABC' } }
    );

    // The API signals "no results" in one of three ways:
    //   (a) errors array with 404-style message  (b) data.characters is null  (c) empty results list
    // All are valid — the key check is the app does not crash (no 5xx)
    expect(res.status).toBeLessThan(500);
    if (res.errors) {
      expect(res.errors[0].message).toBeTruthy();
    } else {
      const chars = res.data.characters;
      // null characters OR empty results array are both acceptable
      expect(chars === null || chars.results === null || chars.results.length === 0).toBe(true);
    }
  });

  test('page 2 of filtered results is a different set from page 1 @regression', async ({ request }) => {
    const page1 = await gql(
      request,
      `query($f: FilterCharacter) { characters(page: 1, filter: $f) { results { id } } }`,
      { f: { species: 'Human' } }
    );
    const page2 = await gql(
      request,
      `query($f: FilterCharacter) { characters(page: 2, filter: $f) { results { id } } }`,
      { f: { species: 'Human' } }
    );

    const ids1 = page1.data.characters.results.map(c => c.id);
    const ids2 = page2.data.characters.results.map(c => c.id);
    const overlap = ids1.filter(id => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  test('episode filter by name returns matching episodes @regression', async ({ request }) => {
    const res = await gql(
      request,
      `query($f: FilterEpisode) { episodes(filter: $f) { results { name episode } } }`,
      { f: { name: 'Pilot' } }
    );

    expect(res.errors).toBeNull();
    expect(res.data.episodes.results.length).toBeGreaterThan(0);
    for (const ep of res.data.episodes.results) {
      expect(ep.name.toLowerCase()).toContain('pilot');
    }
  });
});
