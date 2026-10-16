// Parses log lines, reduces each message to a "signature" with the variable parts
// replaced, and groups entries by signature.

const LEVELS = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
const LEVEL_ALIASES = { WARNING: 'WARN', ERR: 'ERROR', CRITICAL: 'FATAL' };

const normLevel = (raw) => {
  const up = String(raw ?? '').toUpperCase();
  return LEVEL_ALIASES[up] ?? (LEVELS.includes(up) ? up : 'UNKNOWN');
};

const PLAIN = /^(\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?)\s+([A-Za-z]+)\s+(?:\[([^\]]+)\]\s+)?(.*)$/;

// One line -> { timestamp, level, service, message } or null for blank lines.
export function parseLine(line) {
  const text = line.trimEnd();
  if (!text.trim()) return null;

  if (text.trimStart().startsWith('{')) {
    try {
      const j = JSON.parse(text);
      return {
        timestamp: j.time ?? j.timestamp ?? j['@timestamp'] ?? null,
        level: normLevel(j.level ?? j.severity),
        service: j.service ?? j.logger ?? null,
        message: String(j.msg ?? j.message ?? ''),
      };
    } catch { /* not JSON after all; fall through */ }
  }

  const m = text.match(PLAIN);
  if (m) return { timestamp: m[1], level: normLevel(m[2]), service: m[3] ?? null, message: m[4] };

  const found = text.match(/\b(FATAL|ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/i);
  return { timestamp: null, level: found ? normLevel(found[1]) : 'UNKNOWN', service: null, message: text };
}

// Stack-trace lines ("    at foo (file.js:1:2)") belong to the entry above them.
const isContinuation = (line) => /^\s+\S/.test(line) || /^\s*at\s/.test(line) || /^Caused by:/.test(line);

export function parseLog(text) {
  const entries = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (entries.length && isContinuation(line) && !line.trimStart().startsWith('{')) {
      entries[entries.length - 1].detail.push(line.trim());
      continue;
    }
    const e = parseLine(line);
    if (e) entries.push({ ...e, detail: [] });
  }
  return entries;
}

// Order matters: specific shapes first, plain numbers last.
const MASKS = [
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, '<ts>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '<email>'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>'],
  [/"[^"]*"|'[^']*'/g, '<str>'],
  [/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, '<hex>'],
  [/\b\d+(?:\.\d+)?/g, '<num>'],
];

export function signature(message) {
  let s = message;
  for (const [re, token] of MASKS) s = s.replace(re, token);
  return s.replace(/\s+/g, ' ').trim();
}

// Groups entries at the given levels by level + signature, most frequent first.
export function groupEntries(entries, { levels = ['FATAL', 'ERROR', 'WARN'] } = {}) {
  const groups = new Map();
  for (const e of entries) {
    if (!levels.includes(e.level)) continue;
    const sig = signature(e.message);
    const key = `${e.level} ${sig}`;
    const g = groups.get(key) ?? { key, level: e.level, signature: sig, count: 0, firstSeen: e.timestamp, lastSeen: e.timestamp, services: new Set(), sample: e.message };
    g.count += 1;
    if (e.timestamp && (!g.firstSeen || e.timestamp < g.firstSeen)) g.firstSeen = e.timestamp;
    if (e.timestamp && (!g.lastSeen || e.timestamp > g.lastSeen)) g.lastSeen = e.timestamp;
    if (e.service) g.services.add(e.service);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, services: [...g.services].sort() }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

// What changed between a baseline log and the current one.
export function compareGroups(baseline, current) {
  const before = new Map(baseline.map((g) => [g.key, g]));
  const after = new Map(current.map((g) => [g.key, g]));
  return {
    new: current.filter((g) => !before.has(g.key)),
    gone: baseline.filter((g) => !after.has(g.key)),
    grew: current
      .filter((g) => before.has(g.key) && g.count >= 2 * before.get(g.key).count && g.count - before.get(g.key).count >= 3)
      .map((g) => ({ ...g, before: before.get(g.key).count })),
  };
}
