import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

// npm run screenshots: the images in docs/, from the real quiz page (start it with npm run quiz
// first). Light and dark, and what a learner sees: a wrong answer with its feedback, then the
// results with the line to copy back.
const BASE = process.env.QUIZ_URL ?? 'http://127.0.0.1:4300/';
const { questions } = JSON.parse(readFileSync(new URL('../quiz/questions.json', import.meta.url), 'utf8')) as {
  questions: { id: string; correct: number }[];
};
const OUT = new URL('../docs/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const browser = await chromium.launch();
for (const scheme of ['light', 'dark'] as const) {
  const page = await browser.newPage({ colorScheme: scheme, viewport: { width: 820, height: 760 }, deviceScaleFactor: 2 });
  const suffix = scheme === 'dark' ? '-dark' : '';

  await page.goto(BASE);
  const q = questions[7]!; // O3: the transfer that creates a cent
  await page.locator(`fieldset[data-id="${q.id}"] input`).nth((q.correct + 1) % 4).check();
  await page.locator(`fieldset[data-id="${q.id}"]`).screenshot({ path: `${OUT}quiz-feedback${suffix}.png` });

  // Everything right except O4, to show a result that points at one objective.
  for (const other of questions) {
    if (other.id === q.id) continue;
    const wrong = other.id === 'Q11' ? (other.correct + 1) % 4 : other.correct;
    await page.locator(`fieldset[data-id="${other.id}"] input`).nth(wrong).check();
  }
  await page.getByLabel(/Your code/).fill('P1');
  await page.getByRole('button', { name: 'Show my results' }).click();
  await page.locator('#results').screenshot({ path: `${OUT}quiz-results${suffix}.png` });
  await page.close();
}
await browser.close();
console.log(`images written to ${OUT}`);
