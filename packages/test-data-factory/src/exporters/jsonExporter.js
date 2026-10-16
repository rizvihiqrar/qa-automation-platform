import fs from 'fs';
import path from 'path';

export function exportJson(data, outputPath) {
  const dir = path.dirname(outputPath);
  if (dir !== '.') fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
  return outputPath;
}

export function toJsonString(data) {
  return JSON.stringify(data, null, 2);
}
