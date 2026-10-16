'use strict';

const { createBookmarkService } = require('../../src/bookmarkService');

let service;

beforeEach(() => {
  service = createBookmarkService();
});

describe('create', () => {
  test('creates a bookmark with required fields', () => {
    const b = service.create({ url: 'https://example.com', title: 'Example' });
    expect(b).toMatchObject({ id: 1, url: 'https://example.com', title: 'Example', tags: [] });
    expect(b.createdAt).toBeDefined();
  });

  test('creates a bookmark with tags', () => {
    const b = service.create({ url: 'https://example.com', title: 'Example', tags: ['a', 'b'] });
    expect(b.tags).toEqual(['a', 'b']);
  });

  test('auto-increments IDs across multiple creates', () => {
    const b1 = service.create({ url: 'https://a.com', title: 'A' });
    const b2 = service.create({ url: 'https://b.com', title: 'B' });
    expect(b2.id).toBe(b1.id + 1);
  });

  test('throws when url is missing', () => {
    expect(() => service.create({ title: 'No URL' })).toThrow('url is required');
  });

  test('throws when title is missing', () => {
    expect(() => service.create({ url: 'https://example.com' })).toThrow('title is required');
  });

  test('throws when tags is not an array', () => {
    expect(() => service.create({ url: 'https://example.com', title: 'T', tags: 'bad' })).toThrow('tags must be an array');
  });
});

describe('getAll', () => {
  test('returns empty array when no bookmarks exist', () => {
    expect(service.getAll()).toEqual([]);
  });

  test('returns all bookmarks', () => {
    service.create({ url: 'https://a.com', title: 'A' });
    service.create({ url: 'https://b.com', title: 'B' });
    expect(service.getAll()).toHaveLength(2);
  });
});

describe('getById', () => {
  test('returns the bookmark by ID', () => {
    const created = service.create({ url: 'https://example.com', title: 'Example' });
    expect(service.getById(created.id)).toMatchObject({ title: 'Example' });
  });

  test('returns null for unknown ID', () => {
    expect(service.getById(999)).toBeNull();
  });
});

describe('update', () => {
  test('updates a bookmark field', () => {
    const b = service.create({ url: 'https://example.com', title: 'Old' });
    const updated = service.update(b.id, { title: 'New' });
    expect(updated.title).toBe('New');
    expect(updated.url).toBe('https://example.com');
  });

  test('returns null for unknown ID', () => {
    expect(service.update(999, { title: 'X' })).toBeNull();
  });

  test('throws when url update is not a string', () => {
    const b = service.create({ url: 'https://example.com', title: 'T' });
    expect(() => service.update(b.id, { url: 123 })).toThrow('url must be a string');
  });

  test('throws when tags update is not an array', () => {
    const b = service.create({ url: 'https://example.com', title: 'T' });
    expect(() => service.update(b.id, { tags: 'bad' })).toThrow('tags must be an array');
  });
});

describe('remove', () => {
  test('removes a bookmark by ID', () => {
    const b = service.create({ url: 'https://example.com', title: 'T' });
    expect(service.remove(b.id)).toBe(true);
    expect(service.getById(b.id)).toBeNull();
  });

  test('returns false for unknown ID', () => {
    expect(service.remove(999)).toBe(false);
  });
});

describe('reset', () => {
  test('clears all bookmarks and resets ID counter', () => {
    service.create({ url: 'https://example.com', title: 'T' });
    service.reset();
    expect(service.getAll()).toHaveLength(0);
    const b = service.create({ url: 'https://example.com', title: 'T' });
    expect(b.id).toBe(1);
  });
});
