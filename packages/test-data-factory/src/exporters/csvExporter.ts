import fs from 'fs';
import path from 'path';

type Flat = Record<string, unknown>;

function flatten(obj: object, prefix = ''): Flat {
  return Object.entries(obj).reduce<Flat>((acc, [key, val]) => {
    const fullKey = prefix ? `${prefix}_${key}` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      Object.assign(acc, flatten(val, fullKey));
    } else {
      acc[fullKey] = val ?? '';
    }
    return acc;
  }, {});
}

export function toCsvString(records: readonly object[]): string {
  const first = records[0];
  if (!first) return '';
  const flat    = records.map((r) => flatten(r));
  const headers = Object.keys(flatten(first));
  const escape  = (v: unknown): string => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const rows = flat.map((r) => headers.map((h) => escape(r[h] ?? '')).join(','));
  return [headers.join(','), ...rows].join('\n');
}

export function exportCsv(data: readonly object[], outputPath: string): string {
  const dir = path.dirname(outputPath);
  if (dir !== '.') fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, toCsvString(data), 'utf8');
  return outputPath;
}
