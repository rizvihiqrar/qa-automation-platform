'use strict';

const { Router } = require('express');

function createBookmarkRouter(service) {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  router.get('/', (_req, res) => {
    res.json(service.getAll());
  });

  router.get('/:id', (req, res) => {
    const bookmark = service.getById(Number(req.params.id));
    if (!bookmark) return res.status(404).json({ error: 'Bookmark not found' });
    res.json(bookmark);
  });

  router.post('/', (req, res) => {
    try {
      const bookmark = service.create(req.body);
      res.status(201).json(bookmark);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/:id', (req, res) => {
    try {
      const bookmark = service.update(Number(req.params.id), req.body);
      if (!bookmark) return res.status(404).json({ error: 'Bookmark not found' });
      res.json(bookmark);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/:id', (req, res) => {
    const deleted = service.remove(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Bookmark not found' });
    res.status(204).end();
  });

  return router;
}

module.exports = { createBookmarkRouter };
