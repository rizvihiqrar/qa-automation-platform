import fs from 'fs';
import path from 'path';

function sqlValue(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'number')  return String(val);
  if (typeof val === 'object')  return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

export function toSqlString(records: readonly object[], tableName = 'test_data'): string {
  const first = records[0];
  if (!first) return '';
  const columns = Object.keys(first).map((c) => `\`${c}\``).join(', ');
  const rows    = records.map((r) => '  (' + Object.values(r).map(sqlValue).join(', ') + ')');
  return `INSERT INTO \`${tableName}\` (${columns})\nVALUES\n${rows.join(',\n')};\n`;
}

export function exportSql(data: readonly object[], outputPath: string, tableName?: string): string {
  const dir = path.dirname(outputPath);
  if (dir !== '.') fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, toSqlString(data, tableName), 'utf8');
  return outputPath;
}
