// Session-based exploratory testing: parse one session file and measure it.
//
// A session file is Markdown:
//   # Charter: Explore <area> with <approach> to find <risk>
//   **Tester:** Name   **Area:** Checkout   **Timebox:** 60   **Started:** 2026-10-16T09:00
//   ## Notes
//   [09:10] BUG: what happened
//   [09:18] QUESTION: something to ask the team

export const TAGS = ['BUG', 'ISSUE', 'QUESTION', 'IDEA', 'RISK', 'NOTE'];

const FIELD = /^\*\*(Tester|Area|Timebox|Started):\*\*\s*(.+)$/i;
const NOTE = /^\s*(?:[-*]\s*)?(?:\[(\d{1,2}):(\d{2})\]\s*)?(?:(BUG|ISSUE|QUESTION|IDEA|RISK|NOTE)\s*:\s*)?(.+)$/i;

export function parseSession(text, source = 'session.md') {
  const s = { source, charter: '', tester: '', area: '', timebox: null, started: null, notes: [] };
  let inNotes = false;

  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h1 = line.match(/^#\s+(?:Charter:\s*)?(.+)/i);
    if (h1 && !s.charter) { s.charter = h1[1].trim(); continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { inNotes = /^notes$/i.test(h2[1].trim()); continue; }

    const f = line.match(FIELD);
    if (f) {
      const key = f[1].toLowerCase();
      const value = f[2].trim();
      if (key === 'timebox') s.timebox = Number.parseInt(value, 10) || null;
      else if (key === 'started') s.started = value;
      else s[key] = value;
      continue;
    }

    // HTML comments are guidance for the tester (the template has one), not notes.
    if (inNotes && line.trim() && !line.trim().startsWith('<!--')) {
      const m = line.match(NOTE);
      s.notes.push({
        time: m[1] ? `${m[1].padStart(2, '0')}:${m[2]}` : null,
        tag: (m[3] ?? 'NOTE').toUpperCase(),
        text: m[4].trim(),
      });
    }
  }
  return s;
}

const minutesOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Start time as HH:MM, from "2026-10-16T09:00" or "09:00".
const startClock = (started) => started?.match(/(\d{1,2}):(\d{2})/)?.slice(1).map((x, i) => (i === 0 ? x.padStart(2, '0') : x)).join(':') ?? null;

export function measureSession(s) {
  const counts = Object.fromEntries(TAGS.map((t) => [t, 0]));
  for (const n of s.notes) counts[n.tag] += 1;

  const start = startClock(s.started);
  const times = s.notes.filter((n) => n.time).map((n) => minutesOf(n.time));
  const duration = start && times.length ? Math.max(0, Math.max(...times) - minutesOf(start)) : null;
  const firstBug = s.notes.find((n) => n.tag === 'BUG' && n.time);
  const timeToFirstBug = start && firstBug ? minutesOf(firstBug.time) - minutesOf(start) : null;

  let pace = null;
  if (duration !== null && s.timebox) {
    pace = duration > s.timebox * 1.1 ? 'over' : duration < s.timebox * 0.5 ? 'short' : 'on time';
  }

  const warnings = [];
  if (!s.charter) warnings.push('no charter');
  else if (s.charter.split(/\s+/).length < 6) warnings.push('charter is vague: say what to explore, how, and what risk you\'re looking for');
  if (!s.timebox) warnings.push('no timebox');
  if (!s.area) warnings.push('no area');
  if (s.notes.length === 0) warnings.push('no notes');
  else if (times.length < s.notes.length) warnings.push(`${s.notes.length - times.length} note(s) without a time`);
  if (pace === 'over') warnings.push(`ran ${duration - s.timebox} min over the ${s.timebox} min timebox`);

  return {
    source: s.source, charter: s.charter, tester: s.tester, area: s.area,
    timebox: s.timebox, duration, pace, counts, timeToFirstBug,
    bugsPerHour: duration ? Math.round((counts.BUG / duration) * 60 * 10) / 10 : null,
    bugs: s.notes.filter((n) => n.tag === 'BUG').map((n) => n.text),
    questions: s.notes.filter((n) => n.tag === 'QUESTION').map((n) => n.text),
    issues: s.notes.filter((n) => n.tag === 'ISSUE').map((n) => n.text),
    warnings,
  };
}

export function newSessionTemplate({ charter, area = '', tester = '', timebox = 60, started = new Date().toISOString().slice(0, 16) }) {
  if (!charter) throw new Error('A charter is required, e.g. "Explore checkout with invalid discount codes to find pricing errors"');
  return [
    `# Charter: ${charter}`,
    '',
    `**Tester:** ${tester}`,
    `**Area:** ${area}`,
    `**Timebox:** ${timebox}`,
    `**Started:** ${started}`,
    '',
    '## Notes',
    `[${startClock(started) ?? '00:00'}] NOTE: Session started`,
    '',
    '<!-- Tags: BUG, ISSUE (blocked you), QUESTION (ask the team), IDEA (test later), RISK, NOTE -->',
    '',
  ].join('\n');
}
