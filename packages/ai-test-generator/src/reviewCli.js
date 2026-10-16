#!/usr/bin/env node
// Usage: node src/reviewCli.js <spec.js> [more specs...]
// Exits 1 if any file has review errors, so it can gate CI.
import fs from 'fs';
import { reviewSpec, formatReview } from './review.js';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node src/reviewCli.js <spec.js> [more specs...]');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  const review = reviewSpec(fs.readFileSync(file, 'utf8'));
  console.log(`${file}\n${formatReview(review)}\n`);
  if (!review.passed) failed = true;
}
process.exitCode = failed ? 1 : 0;
