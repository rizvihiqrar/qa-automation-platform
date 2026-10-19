// One promptfoo test per case: the prompt variables, plus the human label the
// verdict is asserted against (the template never uses `label`, so the judge can't see it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(PKG, rel), 'utf8').replace(/\r\n/g, '\n');

export default function tests() {
  const items = JSON.parse(read('cases/items.json'));
  const key = JSON.parse(read('labels/key.json'));
  return items.map((item) => ({
    description: `${item.id} ${key[item.id].feature} ${key[item.id].criterion}${key[item.id].variant ? ` ${key[item.id].variant}` : ''}`,
    vars: {
      id: item.id,
      label: key[item.id].label,
      feature: read(`cases/${item.feature}`).trimEnd(),
      criterion: item.criterion,
      spec: read(`cases/${item.spec}`).trimEnd(),
    },
    assert: [
      { type: 'is-json' },
      { type: 'javascript', value: 'JSON.parse(output).verdict === context.vars.label', metric: 'agrees with human' },
    ],
  }));
}
