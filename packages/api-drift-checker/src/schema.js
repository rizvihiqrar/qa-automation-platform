// A small validator for the OpenAPI schema features this checker needs:
// type, nullable, required, properties, additionalProperties: false, items,
// enum, minimum, format: date-time, and local $refs. It returns every problem
// it finds (not just the first), each with a JSON path.

const resolve = (spec, schema) => {
  let s = schema;
  for (let guard = 0; s && s.$ref && guard < 20; guard++) {
    const path = s.$ref.replace(/^#\//, '').split('/');
    s = path.reduce((node, key) => node?.[key], spec);
    if (!s) throw new Error(`Unresolved $ref ${schema.$ref}`);
  }
  return s;
};

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
};

const matchesType = (expected, value) => {
  const actual = typeOf(value);
  return expected === actual || (expected === 'number' && actual === 'integer');
};

export function validate(spec, schema, value, path = '$') {
  const s = resolve(spec, schema);
  const issues = [];
  const add = (kind, message, at = path) => issues.push({ kind, path: at, message });

  if (value === null) {
    if (!s.nullable && s.type) add('type', `expected ${s.type}, got null`);
    return issues;
  }
  if (s.type && !matchesType(s.type, value)) {
    add('type', `expected ${s.type}, got ${typeOf(value)}`);
    return issues;
  }
  if (s.enum && !s.enum.includes(value)) add('enum', `${JSON.stringify(value)} is not one of ${s.enum.join(', ')}`);
  if (typeof s.minimum === 'number' && typeof value === 'number' && value < s.minimum) add('range', `${value} is below the minimum ${s.minimum}`);
  if (s.format === 'date-time' && typeof value === 'string' && Number.isNaN(Date.parse(value))) add('format', `"${value}" is not a date-time`);

  if (typeOf(value) === 'object') {
    for (const key of s.required ?? []) {
      if (!(key in value)) add('missing', `required field "${key}" is missing`, `${path}.${key}`);
    }
    for (const [key, v] of Object.entries(value)) {
      const prop = s.properties?.[key];
      if (prop) issues.push(...validate(spec, prop, v, `${path}.${key}`));
      else if (s.additionalProperties === false) add('extra', `field "${key}" is not in the spec`, `${path}.${key}`);
    }
  }
  if (Array.isArray(value) && s.items) {
    value.forEach((item, i) => issues.push(...validate(spec, s.items, item, `${path}[${i}]`)));
  }
  return issues;
}

// Finds the spec operation for a concrete method + path, e.g. GET /orders/7 -> /orders/{id}.
export function findOperation(spec, method, path) {
  const clean = path.split('?')[0];
  for (const [template, ops] of Object.entries(spec.paths)) {
    const re = new RegExp('^' + template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+') + '$');
    const op = ops[method.toLowerCase()];
    if (op && re.test(clean)) return { template, operation: op };
  }
  return null;
}

// Checks one response against the spec. Returns a list of drift issues.
export function checkResponse(spec, { method, path, status, body }) {
  const found = findOperation(spec, method, path);
  if (!found) return [{ kind: 'undocumented-endpoint', path: '$', message: `${method} ${path} is not in the spec` }];
  const response = found.operation.responses[String(status)];
  if (!response) {
    return [{ kind: 'undocumented-status', path: '$', message: `${status} is not a documented response for ${method} ${found.template} (documented: ${Object.keys(found.operation.responses).join(', ')})` }];
  }
  const schema = response.content?.['application/json']?.schema;
  if (!schema) return [];
  return validate(spec, schema, body);
}
