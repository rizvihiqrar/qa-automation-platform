import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlanDefinition, Suite } from './types.ts';

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));

function readJson<T>(file: string): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (error) {
    throw new Error('Could not read ' + file + ': ' + (error instanceof Error ? error.message : String(error)));
  }
}

export function loadSuite(dataDir: string = DEFAULT_DATA_DIR): Suite {
  return readJson<Suite>(path.join(dataDir, 'cases.json'));
}

export function loadPlanDefinition(dataDir: string = DEFAULT_DATA_DIR): PlanDefinition {
  return readJson<PlanDefinition>(path.join(dataDir, 'plan.json'));
}
