#!/usr/bin/env node
/**
 * Usage:
 *   node src/index.ts --type users    --count 50  --format json --output output/users.json
 *   node src/index.ts --type orders   --count 100 --format csv  --output output/orders.csv
 *   node src/index.ts --type products --count 20  --format sql  --table products --output output/seed.sql
 *   node src/index.ts --type users    --count 5   --seed 42     # same data every run
 *
 * Defaults: count=10, format=json, output=stdout
 */

import { pathToFileURL } from 'url';
import { faker } from '@faker-js/faker';
import { generateUsers }   from './generators/userGenerator.ts';
import { generateOrders }  from './generators/orderGenerator.ts';
import { generateProducts } from './generators/productGenerator.ts';
import { exportJson, toJsonString } from './exporters/jsonExporter.ts';
import { exportCsv,  toCsvString  } from './exporters/csvExporter.ts';
import { exportSql,  toSqlString  } from './exporters/sqlExporter.ts';
import type { DataType, Format } from './types.ts';

export const GENERATORS: Record<DataType, (count: number) => object[]> = {
  users: generateUsers,
  orders: generateOrders,
  products: generateProducts,
};
const FORMATS: readonly Format[] = ['json', 'csv', 'sql'];

const isType = (t: string): t is DataType => t in GENERATORS;
const isFormat = (f: string): f is Format => (FORMATS as readonly string[]).includes(f);

// Faker dates are relative to "now", so a seed alone doesn't repeat them.
// Seeded runs also pin the reference date so the whole output is identical.
export const SEEDED_REF_DATE = '2026-01-01T00:00:00.000Z';

export function applySeed(seed: number): void {
  faker.seed(seed);
  faker.setDefaultRefDate(SEEDED_REF_DATE);
}

export interface Options {
  type: DataType;
  format: Format;
  count: number;
  seed: number | null;
  output: string | null;
  table: string;
}

export function parseArgs(argv: readonly string[]): Options {
  const get = (flag: string, def: string | null): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] ?? null : def;
  };

  const type = get('--type', 'users') ?? 'users';
  if (!isType(type)) throw new Error(`Unknown type "${type}". Valid options: ${Object.keys(GENERATORS).join(', ')}`);

  const format = get('--format', 'json') ?? 'json';
  if (!isFormat(format)) throw new Error(`Unknown format "${format}". Valid options: ${FORMATS.join(', ')}`);

  // parseInt('abc') is NaN, which used to produce an empty file without any error.
  const rawCount = get('--count', '10');
  const count = Number(rawCount);
  if (!Number.isInteger(count) || count < 1) throw new Error(`--count must be a positive whole number, got "${rawCount}"`);

  const rawSeed = get('--seed', null);
  const seed = rawSeed === null ? null : Number(rawSeed);
  if (seed !== null && !Number.isInteger(seed)) throw new Error(`--seed must be a whole number, got "${rawSeed}"`);

  return { type, format, count, seed, output: get('--output', null), table: get('--table', type) ?? type };
}

export function render(data: readonly object[], format: Format, table: string): string {
  if (format === 'csv') return toCsvString(data);
  if (format === 'sql') return toSqlString(data, table);
  return toJsonString(data);
}

function main(): void {
  const { type, format, count, seed, output, table } = parseArgs(process.argv.slice(2));
  if (seed !== null) applySeed(seed);

  const data = GENERATORS[type](count);

  if (!output) {
    console.log(render(data, format, table));
    return;
  }
  const exporters: Record<Format, () => string> = {
    json: () => exportJson(data, output),
    csv: () => exportCsv(data, output),
    sql: () => exportSql(data, output, table),
  };
  console.log(`Generated ${count} ${type} -> ${exporters[format]()} (${format.toUpperCase()})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
