'use strict';

const express = require('express');
const request = require('supertest');
const { createBookmarkRouter } = require('../../src/routes');

function mockService(overrides = {}) {
  return {
    getAll: jest.fn(() => []),
    getById: jest.fn(() => null),
    create: jest.fn(() => ({ id: 1, url: 'https://example.com', title: 'Test', tags: [], createdAt: '2025-01-01T00:00:00.000Z' })),
    update: jest.fn(() => null),
    remove: jest.fn(() => false),
    ...overrides,
  };
}

function buildApp(service) {
  const app = express();
  app.use(express.json());
  app.use('/api/bookmarks', createBookmarkRouter(service));
  return app;
}

describe('GET /api/bookmarks', () => {
  test('returns 200 with empty array', async () => {
    const app = buildApp(mockService());
    const res = await request(app).get('/api/bookmarks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns list from service', async () => {
    const bookmark = { id: 1, url: 'https://example.com', title: 'Test', tags: [] };
    const app = buildApp(mockService({ getAll: jest.fn(() => [bookmark]) }));
    const res = await request(app).get('/api/bookmarks');
    expect(res.body).toHaveLength(1);
  });
});

describe('GET /api/bookmarks/:id', () => {
  test('returns 200 with bookmark when found', async () => {
    const bookmark = { id: 1, url: 'https://example.com', title: 'Test', tags: [] };
    const app = buildApp(mockService({ getById: jest.fn(() => bookmark) }));
    const res = await request(app).get('/api/bookmarks/1');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Test');
  });

  test('returns 404 when not found', async () => {
    const app = buildApp(mockService({ getById: jest.fn(() => null) }));
    const res = await request(app).get('/api/bookmarks/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Bookmark not found');
  });
});

describe('POST /api/bookmarks', () => {
  test('returns 201 with created bookmark', async () => {
    const app = buildApp(mockService());
    const res = await request(app)
      .post('/api/bookmarks')
      .send({ url: 'https://example.com', title: 'Test' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
  });

  test('returns 400 when service throws validation error', async () => {
    const app = buildApp(mockService({ create: jest.fn(() => { throw new Error('url is required'); }) }));
    const res = await request(app).post('/api/bookmarks').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('url is required');
  });
});

describe('PUT /api/bookmarks/:id', () => {
  test('returns 200 with updated bookmark', async () => {
    const updated = { id: 1, url: 'https://example.com', title: 'Updated', tags: [] };
    const app = buildApp(mockService({ update: jest.fn(() => updated) }));
    const res = await request(app).put('/api/bookmarks/1').send({ title: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated');
  });

  test('returns 404 when not found', async () => {
    const app = buildApp(mockService({ update: jest.fn(() => null) }));
    const res = await request(app).put('/api/bookmarks/999').send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  test('returns 400 when service throws validation error', async () => {
    const app = buildApp(mockService({ update: jest.fn(() => { throw new Error('tags must be an array'); }) }));
    const res = await request(app).put('/api/bookmarks/1').send({ tags: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('tags must be an array');
  });
});

describe('DELETE /api/bookmarks/:id', () => {
  test('returns 204 when deleted', async () => {
    const app = buildApp(mockService({ remove: jest.fn(() => true) }));
    const res = await request(app).delete('/api/bookmarks/1');
    expect(res.status).toBe(204);
  });

  test('returns 404 when not found', async () => {
    const app = buildApp(mockService({ remove: jest.fn(() => false) }));
    const res = await request(app).delete('/api/bookmarks/999');
    expect(res.status).toBe(404);
  });
});
