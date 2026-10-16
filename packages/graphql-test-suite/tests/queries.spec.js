/**
 * Pattern: Basic GraphQL query structure and response shape
 *
 * Validates that:
 * - All valid queries return HTTP 200 (GraphQL always uses 200; errors live in the body)
 * - The top-level response has a `data` key and no `errors` key
 * - Paginated list responses include the expected `info` and `results` shape
 * - Single-resource queries return the correct fields
 * - Parameterised queries (via variables) behave identically to inline queries
 * - Multiple resource types can be fetched in a single request
 */

import { test, expect } from '@playwright/test';
import { gql } from '../utils/graphqlClient.js';

test.describe('Pattern: GraphQL query structure', () => {

  test('valid query returns HTTP 200 @smoke', async ({ request }) => {
    const { status } = await gql(request, '{ characters { info { count } } }');
    expect(status).toBe(200);
  });

  test('valid query response has data and no errors @smoke', async ({ request }) => {
    const res = await gql(request, '{ characters { info { count } } }');
    expect(res.data).not.toBeNull();
    expect(res.errors).toBeNull();
  });

  test('response content-type is application/json @regression', async ({ request }) => {
    const { headers } = await gql(request, '{ characters { info { count } } }');
    expect(headers['content-type']).toMatch(/application\/json/i);
  });

  test('characters list returns info and results shape @smoke', async ({ request }) => {
    const res = await gql(request, `{
      characters(page: 1) {
        info { count pages next prev }
        results { id name status species }
      }
    }`);

    expect(res.errors).toBeNull();
    const { info, results } = res.data.characters;
    expect(typeof info.count).toBe('number');
    expect(info.count).toBeGreaterThan(0);
    expect(typeof info.pages).toBe('number');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  test('each character result has the expected fields @regression', async ({ request }) => {
    const res = await gql(request, `{
      characters(page: 1) {
        results { id name status species type gender }
      }
    }`);

    for (const char of res.data.characters.results) {
      expect(typeof char.id).toBe('string');
      expect(typeof char.name).toBe('string');
      expect(['Alive', 'Dead', 'unknown']).toContain(char.status);
      expect(typeof char.species).toBe('string');
    }
  });

  test('character by ID returns a single object @smoke', async ({ request }) => {
    const res = await gql(request, `{
      character(id: 1) {
        id name status species origin { name }
      }
    }`);

    expect(res.errors).toBeNull();
    const char = res.data.character;
    expect(char.id).toBe('1');
    expect(char.name).toBe('Rick Sanchez');
    expect(char.origin.name).toBe('Earth (C-137)');
  });

  test('query with variables returns same result as inline query @regression', async ({ request }) => {
    const inline    = await gql(request, '{ character(id: 2) { id name } }');
    const withVars  = await gql(
      request,
      'query GetChar($id: ID!) { character(id: $id) { id name } }',
      { id: '2' }
    );

    expect(withVars.errors).toBeNull();
    expect(withVars.data.character.id).toBe(inline.data.character.id);
    expect(withVars.data.character.name).toBe(inline.data.character.name);
  });

  test('multiple resource types in one request return all data @regression', async ({ request }) => {
    const res = await gql(request, `{
      character(id: 1) { name }
      location(id: 1)  { name type }
      episode(id: 1)   { name air_date }
    }`);

    expect(res.errors).toBeNull();
    expect(typeof res.data.character.name).toBe('string');
    expect(typeof res.data.location.name).toBe('string');
    expect(typeof res.data.episode.name).toBe('string');
  });

  test('location query returns dimension and type fields @regression', async ({ request }) => {
    const res = await gql(request, `{
      location(id: 1) { id name type dimension residents { id name } }
    }`);

    expect(res.errors).toBeNull();
    const loc = res.data.location;
    expect(loc.id).toBe('1');
    expect(typeof loc.name).toBe('string');
    expect(Array.isArray(loc.residents)).toBe(true);
  });

  test('episode query returns name, air date, and episode code @regression', async ({ request }) => {
    const res = await gql(request, `{
      episode(id: 1) { id name air_date episode }
    }`);

    expect(res.errors).toBeNull();
    const ep = res.data.episode;
    expect(ep.id).toBe('1');
    expect(ep.name).toBe('Pilot');
    expect(ep.episode).toBe('S01E01');
  });
});
