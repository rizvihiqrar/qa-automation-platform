'use strict';

const express = require('express');
const { createBookmarkService } = require('./bookmarkService');
const { createBookmarkRouter } = require('./routes');

const service = createBookmarkService();
const app = express();

app.disable('x-powered-by');
app.use(express.json());

const router = createBookmarkRouter(service);
app.get('/health', router);
app.use('/api/bookmarks', router);

module.exports = { app, service };
