// Rolls several measured sessions into one debrief: what was covered, what was
// found, what's still open, and how the time was used.

export function summarizeSessions(sessions) {
  const timed = sessions.filter((s) => s.duration !== null);
  const minutes = timed.reduce((n, s) => n + s.duration, 0);
  const bugs = sessions.reduce((n, s) => n + s.counts.BUG, 0);
  return {
    sessions: sessions.length,
    minutes,
    bugs,
    bugsPerHour: minutes ? Math.round((bugs / minutes) * 60 * 10) / 10 : null,
    areas: [...new Set(sessions.map((s) => s.area).filter(Boolean))].sort(),
    overTimebox: sessions.filter((s) => s.pace === 'over').length,
    openQuestions: sessions.flatMap((s) => s.questions.map((q) => ({ source: s.source, text: q }))),
    blockers: sessions.flatMap((s) => s.issues.map((q) => ({ source: s.source, text: q }))),
    withWarnings: sessions.filter((s) => s.warnings.length).length,
  };
}

export function formatDebrief(sessions) {
  const t = summarizeSessions(sessions);
  const lines = [
    '# Exploratory testing debrief',
    '',
    `${t.sessions} session(s), ${t.minutes} min, ${t.bugs} bug(s)` + (t.bugsPerHour !== null ? `, ${t.bugsPerHour} bugs/hour` : ''),
    `Areas covered: ${t.areas.join(', ') || 'none recorded'}`,
    '',
    '| Session | Area | Time | Pace | Bugs | Questions | First bug after |',
    '|---|---|---|---|---:|---:|---|',
    ...sessions.map((s) => `| ${s.charter || s.source} | ${s.area || '—'} | ${s.duration ?? '?'} / ${s.timebox ?? '?'} min | ${s.pace ?? '—'} | ${s.counts.BUG} | ${s.counts.QUESTION} | ${s.timeToFirstBug === null ? '—' : `${s.timeToFirstBug} min`} |`),
    '',
    '## Bugs',
    ...(sessions.flatMap((s) => s.bugs.map((b) => `- ${b} _(${s.area || s.source})_`)).length
      ? sessions.flatMap((s) => s.bugs.map((b) => `- ${b} _(${s.area || s.source})_`)) : ['None found.']),
    '',
    '## Open questions for the team',
    ...(t.openQuestions.length ? t.openQuestions.map((q) => `- ${q.text}`) : ['None.']),
    '',
    '## Blockers',
    ...(t.blockers.length ? t.blockers.map((q) => `- ${q.text}`) : ['None.']),
  ];
  const warned = sessions.filter((s) => s.warnings.length);
  if (warned.length) {
    lines.push('', '## Session hygiene');
    for (const s of warned) lines.push(`- **${s.source}:** ${s.warnings.join('; ')}`);
  }
  return lines.join('\n') + '\n';
}
