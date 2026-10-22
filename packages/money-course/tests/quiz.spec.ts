import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface Option { text: string; feedback: string }
interface Question { id: string; objective: string; text: string; options: Option[]; correct: number }
const data = JSON.parse(readFileSync(new URL('../quiz/questions.json', import.meta.url), 'utf8')) as { questions: Question[]; retention: Question[] };

const question = (page: Page, id: string) => page.locator(`fieldset.question[data-id="${id}"]`);
const pick = (page: Page, q: Question, index: number) => question(page, q.id).getByRole('radio').nth(index).check();
// Answers every question: all right, or all with the first wrong option.
async function answerAll(page: Page, questions: Question[], right: boolean) {
  for (const q of questions) await pick(page, q, right ? q.correct : (q.correct + 1) % 4);
}

test.describe('the quiz page', () => {
  test('shows all 18 questions, grouped under 6 objectives, and no results yet @smoke', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('fieldset.question')).toHaveCount(18);
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'Show my results' })).toBeDisabled();
    await expect(page.getByText('18 of 18 questions left.')).toBeVisible();
    await expect(page.locator('#results')).toBeHidden();
  });

  test('a wrong answer shows its own feedback and the right answer, and locks the question', async ({ page }) => {
    await page.goto('/');
    const q = data.questions[0]!;
    const wrong = (q.correct + 1) % 4;
    await pick(page, q, wrong);
    const box = question(page, q.id).getByRole('status');
    await expect(box).toContainText('Not quite.');
    await expect(box).toContainText(q.options[wrong]!.feedback);
    await expect(box).toContainText(q.options[q.correct]!.text);
    await expect(question(page, q.id).getByRole('radio').first()).toBeDisabled();
    await expect(page.getByText('17 of 18 questions left.')).toBeVisible();
  });

  test('the results button stays disabled until the last question is answered', async ({ page }) => {
    await page.goto('/');
    const last = data.questions.at(-1)!;
    for (const q of data.questions.slice(0, -1)) await pick(page, q, q.correct);
    await expect(page.getByText('1 of 18 questions left.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show my results' })).toBeDisabled();
    await pick(page, last, last.correct);
    await expect(page.getByRole('button', { name: 'Show my results' })).toBeEnabled();
  });

  test('a right answer says so, with the reason', async ({ page }) => {
    await page.goto('/');
    const q = data.questions[3]!;
    await pick(page, q, q.correct);
    const box = question(page, q.id).getByRole('status');
    await expect(box).toContainText('Correct.');
    await expect(box).toContainText(q.options[q.correct]!.feedback);
    await expect(box).not.toContainText('The right answer');
  });

  test('all answers right: 18 of 18, 3 of 3 for every objective, and a line to copy @regression', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/Your code/).fill('P7');
    await answerAll(page, data.questions, true);
    await expect(page.getByText('All answered.')).toBeVisible();
    await page.getByRole('button', { name: 'Show my results' }).click();
    await expect(page.locator('#total')).toHaveText('18 of 18');
    await expect(page.locator('#by-objective li')).toHaveText(['O1: 3 of 3', 'O2: 3 of 3', 'O3: 3 of 3', 'O4: 3 of 3', 'O5: 3 of 3', 'O6: 3 of 3']);
    await expect(page.locator('#summary')).toHaveValue('P7 | before | 18/18 | missed: none');
  });

  test('all answers wrong: 0 of 18 and every objective is listed as missed', async ({ page }) => {
    await page.goto('/?mode=after');
    await answerAll(page, data.questions, false);
    await page.getByRole('button', { name: 'Show my results' }).click();
    await expect(page.locator('#total')).toHaveText('0 of 18');
    await expect(page.locator('#summary')).toHaveValue('no code | after | 0/18 | missed: O1, O2, O3, O4, O5, O6');
  });

  test('one wrong answer is traced to its objective', async ({ page }) => {
    await page.goto('/');
    const target = data.questions.find((q) => q.objective === 'O4')!;
    for (const q of data.questions) await pick(page, q, q === target ? (q.correct + 2) % 4 : q.correct);
    await page.getByRole('button', { name: 'Show my results' }).click();
    await expect(page.locator('#total')).toHaveText('17 of 18');
    await expect(page.locator('#by-objective li').nth(3)).toHaveText('O4: 2 of 3');
    await expect(page.locator('#summary')).toHaveValue('no code | before | 17/18 | missed: O4');
  });

  test('the retention check has six new questions, one for each objective', async ({ page }) => {
    await page.goto('/?mode=retention');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('two weeks later');
    await expect(page.locator('fieldset.question')).toHaveCount(6);
    await answerAll(page, data.retention, true);
    await page.getByRole('button', { name: 'Show my results' }).click();
    await expect(page.locator('#summary')).toHaveValue('no code | retention | 6/6 | missed: none');
  });

  test('works with the keyboard alone', async ({ page }) => {
    await page.goto('/');
    const q = data.questions[0]!;
    await question(page, q.id).getByRole('radio').first().focus();
    await page.keyboard.press('Space');
    await expect(question(page, q.id).getByRole('status')).not.toBeEmpty();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 700 } });

    test('the page fits the screen without sideways scrolling', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('fieldset.question')).toHaveCount(18);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    });
  });
});
