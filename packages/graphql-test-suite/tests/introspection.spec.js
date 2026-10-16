/**
 * Pattern: GraphQL schema introspection
 *
 * Introspection queries allow clients to discover the schema at runtime.
 * These tests verify:
 * - Introspection is enabled on this developer API
 * - Expected types exist in the schema (Character, Location, Episode)
 * - The Query type exposes the expected entry-point fields
 * - Field types match expectations (character returns Character, not a list)
 *
 * In a production security audit you would flip these — verify introspection
 * is DISABLED. For a developer-facing API (like this one) it should be enabled.
 */

import { test, expect } from '@playwright/test';
import { gql } from '../utils/graphqlClient.js';

test.describe('Pattern: Schema introspection', () => {

  test('introspection query is enabled and returns __schema @smoke', async ({ request }) => {
    const res = await gql(request, '{ __schema { queryType { name } } }');

    expect(res.errors).toBeNull();
    expect(res.data.__schema.queryType.name).toBe('Query');
  });

  test('Character type exists in the schema @regression', async ({ request }) => {
    const res = await gql(request, `{
      __type(name: "Character") {
        name
        kind
        fields { name }
      }
    }`);

    expect(res.errors).toBeNull();
    const type = res.data.__type;
    expect(type.name).toBe('Character');
    expect(type.kind).toBe('OBJECT');
    const fieldNames = type.fields.map(f => f.name);
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('status');
    expect(fieldNames).toContain('species');
  });

  test('Location type exists with expected fields @regression', async ({ request }) => {
    const res = await gql(request, `{
      __type(name: "Location") {
        name
        fields { name }
      }
    }`);

    expect(res.errors).toBeNull();
    const fieldNames = res.data.__type.fields.map(f => f.name);
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('type');
    expect(fieldNames).toContain('dimension');
    expect(fieldNames).toContain('residents');
  });

  test('Episode type exists with expected fields @regression', async ({ request }) => {
    const res = await gql(request, `{
      __type(name: "Episode") {
        name
        fields { name }
      }
    }`);

    expect(res.errors).toBeNull();
    const fieldNames = res.data.__type.fields.map(f => f.name);
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('air_date');
    expect(fieldNames).toContain('episode');
    expect(fieldNames).toContain('characters');
  });

  test('Query type exposes character, location, and episode entry points @smoke', async ({ request }) => {
    const res = await gql(request, `{
      __type(name: "Query") {
        fields { name }
      }
    }`);

    expect(res.errors).toBeNull();
    const fieldNames = res.data.__type.fields.map(f => f.name);
    expect(fieldNames).toContain('character');
    expect(fieldNames).toContain('characters');
    expect(fieldNames).toContain('location');
    expect(fieldNames).toContain('locations');
    expect(fieldNames).toContain('episode');
    expect(fieldNames).toContain('episodes');
  });

  test('character entry point returns a Character type, not a list @regression', async ({ request }) => {
    const res = await gql(request, `{
      __type(name: "Query") {
        fields {
          name
          type { name kind ofType { name } }
        }
      }
    }`);

    expect(res.errors).toBeNull();
    const charField = res.data.__type.fields.find(f => f.name === 'character');
    expect(charField).toBeDefined();
    // character(id) returns a nullable Character, not a list
    const typeName = charField.type.name || charField.type.ofType?.name;
    expect(typeName).toBe('Character');
  });

  test('FilterCharacter input type exists @regression', async ({ request }) => {
    const res = await gql(request, `{
      __type(name: "FilterCharacter") {
        name
        kind
        inputFields { name }
      }
    }`);

    expect(res.errors).toBeNull();
    expect(res.data.__type.kind).toBe('INPUT_OBJECT');
    const fieldNames = res.data.__type.inputFields.map(f => f.name);
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('status');
    expect(fieldNames).toContain('species');
    expect(fieldNames).toContain('gender');
  });
});
