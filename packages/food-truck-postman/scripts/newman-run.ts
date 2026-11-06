import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import newman from 'newman';
import type { NewmanRunOptions, NewmanRunSummary } from 'newman';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const path = (file: string): string => `${ROOT}${file}`;

export const COLLECTION = path('postman/food-truck.postman_collection.json');

// Each pass is one Newman run. A data file applies to a whole run, so the data folders
// can't share a run with the others, or with each other.
export interface Pass { name: string; folders: string[]; data?: string }

const orders: Pass = { name: 'orders-csv', folders: ['Orders from CSV'], data: path('data/orders.csv') };
const cards: Pass = { name: 'cards-json', folders: ['Cards from JSON'], data: path('data/cards.json') };
// Named index so the dashboard's reports page links to this report, not a data run.
const everyFolder: Pass = {
  name: 'index',
  folders: ['01 Smoke', '02 Menu', '03 Orders (validation)', '04 Payments (test cards)', '05 Order flow', '06 Access'],
};

export const PLANS: Record<string, Pass[]> = {
  all: [everyFolder, orders, cards],
  smoke: [{ name: 'smoke', folders: ['01 Smoke'] }],
  flow: [{ name: 'flow', folders: ['05 Order flow'] }],
  data: [orders, cards],
};

export interface PassResult { assertions: number; failed: string[]; requests: number; requestErrors: number }

// The login replies hold live tokens, and reports get published: they are left out,
// along with the Authorization header (docs/rca/05-tokens-in-published-reports.md).
const LOGINS = 'Login - customer,Login - other customer,Login - staff';

function reporters(pass: Pass, report: boolean, quiet: boolean): Pick<NewmanRunOptions, 'reporters' | 'reporter'> {
  const cli = quiet ? [] : ['cli'];
  if (!report) return { reporters: cli };
  return {
    reporters: [...cli, 'htmlextra', 'junit'],
    reporter: {
      htmlextra: { export: path(`reports/${pass.name}.html`), skipHeaders: 'Authorization,Cookie,Set-Cookie', hideResponseBody: LOGINS },
      junit: { export: path(`reports/${pass.name}.xml`) },
    },
  };
}

// The API's tokens are 64 hex characters. The dashboard's own scan looks for Bearer and
// JWT shapes, so it would not see one that slipped into a report some other way.
export const TOKEN = /\b[0-9a-f]{64}\b/g;

export function reportsWithTokens(dir = path('reports')): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => readFileSync(`${dir}/${file}`, 'utf8').search(TOKEN) !== -1);
}

export function runPass(pass: Pass, baseUrl: string, { report = false, quiet = false } = {}): Promise<PassResult> {
  const environment = JSON.parse(readFileSync(path(`postman/${process.env.CI ? 'ci' : 'local'}.postman_environment.json`), 'utf8'));
  return new Promise((resolve, reject) => {
    const options: NewmanRunOptions = {
      collection: JSON.parse(readFileSync(COLLECTION, 'utf8')),
      environment,
      envVar: [{ key: 'baseUrl', value: baseUrl }],
      folder: pass.folders,
      ...(pass.data ? { iterationData: pass.data } : {}),
      ...reporters(pass, report, quiet),
    };
    newman.run(options, (err: Error | null, summary: NewmanRunSummary) => {
      if (err) return reject(err);
      const { assertions, requests } = summary.run.stats;
      resolve({
        assertions: assertions.total ?? 0,
        failed: summary.run.failures.map((failure) => `${failure.source?.name ?? 'collection'}: ${failure.error.test ?? failure.error.message}`),
        requests: requests.total ?? 0,
        requestErrors: requests.failed ?? 0,
      });
    });
  });
}
