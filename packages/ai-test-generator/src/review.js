// Reviews a generated Playwright spec for the problems AI output most often has:
// tests with no assertions, fixed waits, brittle selectors, leftover markdown,
// focused tests, and missing or duplicate smoke tags.
//
// It is a text-level check, not a parser: it finds test(...) calls and matches
// their braces, which is enough for generated specs but can be fooled by braces
// inside string literals.

const TEST_CALL = /\btest\(\s*(['"`])(.+?)\1\s*,\s*async\b/g;

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

// Returns the test body: the text between the `{` after the arrow and its matching `}`.
// (Searching from the arrow skips the `({ page })` parameter brace.)
function blockBody(source, start) {
  const arrow = source.indexOf('=>', start);
  if (arrow === -1) return '';
  const open = source.indexOf('{', arrow);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  return source.slice(open + 1);
}

export function findTests(source) {
  return [...source.matchAll(TEST_CALL)].map((m) => ({
    title: m[2],
    line: lineOf(source, m.index),
    body: blockBody(source, m.index + m[0].length),
  }));
}

export function reviewSpec(source) {
  const findings = [];
  const add = (severity, rule, line, message) => findings.push({ severity, rule, line, message });

  if (source.includes('```')) add('error', 'markdown-fence', lineOf(source, source.indexOf('```')), 'Output still contains a markdown code fence');

  for (const m of source.matchAll(/\btest\.only\(/g)) add('error', 'focused-test', lineOf(source, m.index), 'test.only would skip every other test');
  for (const m of source.matchAll(/waitForTimeout\(|setTimeout\(/g)) add('warning', 'fixed-wait', lineOf(source, m.index), 'Fixed wait; use an auto-waiting assertion instead');
  for (const m of source.matchAll(/(?:locator|click|fill|waitForSelector|\$)\(\s*['"`](\.[a-zA-Z_-][\w-]*|\/\/[^'"`]*)/g)) {
    add('warning', 'brittle-selector', lineOf(source, m.index), `Selector "${m[1]}" is a CSS class or XPath; prefer [data-test="..."]`);
  }

  const tests = findTests(source);
  if (tests.length === 0) add('error', 'no-tests', 1, 'No test() calls found');
  for (const t of tests) {
    if (!/\bexpect\(/.test(t.body)) add('error', 'no-assertion', t.line, `"${t.title}" has no expect() assertion`);
  }

  const smoke = tests.filter((t) => t.title.includes('@smoke')).length;
  if (tests.length && smoke === 0) add('warning', 'smoke-tag', 1, 'No test is tagged @smoke');
  if (smoke > 1) add('warning', 'smoke-tag', 1, `${smoke} tests are tagged @smoke; expected exactly one`);

  findings.sort((a, b) => a.line - b.line);
  return {
    tests: tests.length,
    findings,
    passed: !findings.some((f) => f.severity === 'error'),
  };
}

export function formatReview({ tests, findings, passed }) {
  const lines = findings.map((f) => `  ${f.severity.padEnd(7)} line ${String(f.line).padStart(3)}  ${f.rule}: ${f.message}`);
  const summary = `${tests} test(s), ${findings.filter((f) => f.severity === 'error').length} error(s), ${findings.filter((f) => f.severity === 'warning').length} warning(s): ${passed ? 'PASS' : 'FAIL'}`;
  return [...lines, summary].join('\n');
}
