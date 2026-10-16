#!/usr/bin/env node
/**
 * Usage:
 *   node src/index.js --type users    --count 50  --format json --output output/users.json
 *   node src/index.js --type orders   --count 100 --format csv  --output output/orders.csv
 *   node src/index.js --type products --count 20  --format sql  --table products --output output/seed.sql
 *   node src/index.js --type users    --count 5   --seed 42     # same data every run
 *
 * Defaults: count=10, format=json, output=stdout
 */

import { pathToFileURL } from 'url';
import { faker } from '@faker-js/faker';
import { generateUsers }   from './generators/userGenerator.js';
import { generateOrders }  from './generators/orderGenerator.js';
import { generateProducts } from './generators/productGenerator.js';
import { exportJson, toJsonString } from './exporters/jsonExporter.js';
import { exportCsv,  toCsvString  } from './exporters/csvExporter.js';
import { exportSql,  toSqlString  } from './exporters/sqlExporter.js';

export const GENERATORS = { users: generateUsers, orders: generateOrders, products: generateProducts };
const FORMATS = ['json', 'csv', 'sql'];

// Faker dates are relative to "now", so a seed alone doesn't repeat them.
// Seeded runs also pin the reference date so the whole output is identical.
export const SEEDED_REF_DATE = '2026-01-01T00:00:00.000Z';

export function applySeed(seed) {
  faker.seed(seed);
  faker.setDefaultRefDate(SEEDED_REF_DATE);
}

export function parseArgs(argv) {
  const get = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : def; };

  const type = get('--type', 'users');
  if (!GENERATORS[type]) throw new Error(`Unknown type "${type}". Valid options: ${Object.keys(GENERATORS).join(', ')}`);

  const format = get('--format', 'json');
  if (!FORMATS.includes(format)) throw new Error(`Unknown format "${format}". Valid options: ${FORMATS.join(', ')}`);

  // parseInt('abc') is NaN, which used to produce an empty file without any error.
  const rawCount = get('--count', '10');
  const count = Number(rawCount);
  if (!Number.isInteger(count) || count < 1) throw new Error(`--count must be a positive whole number, got "${rawCount}"`);

  const rawSeed = get('--seed', null);
  const seed = rawSeed === null ? null : Number(rawSeed);
  if (rawSeed !== null && !Number.isInteger(seed)) throw new Error(`--seed must be a whole number, got "${rawSeed}"`);

  return { type, format, count, seed, output: get('--output', null), table: get('--table', type) };
}

export function render(data, format, table) {
  if (format === 'csv') return toCsvString(data);
  if (format === 'sql') return toSqlString(data, table);
  return toJsonString(data);
}

function main() {
  const { type, format, count, seed, output, table } = parseArgs(process.argv.slice(2));
  if (seed !== null) applySeed(seed);

  const data = GENERATORS[type](count);

  if (!output) {
    console.log(render(data, format, table));
    return;
  }
  const exporters = { json: () => exportJson(data, output), csv: () => exportCsv(data, output), sql: () => exportSql(data, output, table) };
  console.log(`Generated ${count} ${type} -> ${exporters[format]()} (${format.toUpperCase()})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
