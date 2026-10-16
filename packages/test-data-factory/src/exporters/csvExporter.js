import fs from 'fs';
import path from 'path';

function flatten(obj, prefix = '') {
  return Object.entries(obj).reduce((acc, [key, val]) => {
    const fullKey = prefix ? `${prefix}_${key}` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      Object.assign(acc, flatten(val, fullKey));
    } else {
      acc[fullKey] = val ?? '';
    }
    return acc;
  }, {});
}

export function toCsvString(records) {
  if (!records.length) return '';
  const flat    = records.map(r => flatten(r));
  const headers = Object.keys(flat[0]);
  const escape  = (v) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const rows = flat.map(r => headers.map(h => escape(r[h] ?? '')).join(','));
  return [headers.join(','), ...rows].join('\n');
}

export function exportCsv(data, outputPath) {
  const dir = path.dirname(outputPath);
  if (dir !== '.') fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, toCsvString(data), 'utf8');
  return outputPath;
}
