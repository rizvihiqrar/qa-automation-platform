'use strict';

const { app } = require('./src/app');

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Bookmark API running on http://localhost:${PORT}`));
