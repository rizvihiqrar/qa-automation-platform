'use strict';

function createBookmarkService() {
  const store = new Map();
  let nextId = 1;

  function getAll() {
    return Array.from(store.values());
  }

  function getById(id) {
    return store.get(id) || null;
  }

  function create({ url, title, tags = [] }) {
    if (!url || typeof url !== 'string') throw new Error('url is required');
    if (!title || typeof title !== 'string') throw new Error('title is required');
    if (!Array.isArray(tags)) throw new Error('tags must be an array');

    const bookmark = { id: nextId++, url, title, tags, createdAt: new Date().toISOString() };
    store.set(bookmark.id, bookmark);
    return bookmark;
  }

  function update(id, changes) {
    const existing = store.get(id);
    if (!existing) return null;

    if (changes.url !== undefined && typeof changes.url !== 'string') throw new Error('url must be a string');
    if (changes.title !== undefined && typeof changes.title !== 'string') throw new Error('title must be a string');
    if (changes.tags !== undefined && !Array.isArray(changes.tags)) throw new Error('tags must be an array');

    const updated = { ...existing, ...changes };
    store.set(id, updated);
    return updated;
  }

  function remove(id) {
    return store.delete(id);
  }

  function reset() {
    store.clear();
    nextId = 1;
  }

  return { getAll, getById, create, update, remove, reset };
}

module.exports = { createBookmarkService };
