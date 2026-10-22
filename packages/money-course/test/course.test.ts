// The course's own rules, checked: objectives written as observable behaviour, a quiz and a
// planted bug for every objective, and every promise the documents make about the others.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BUGS } from '../src/plant.ts';

interface Option { text: string; feedback: string }
interface Question { id: string; objective: string; text: string; options: Option[]; correct: number }
interface Objective { id: string; module: number; text: string }
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const { objectives, questions, retention } = JSON.parse(read('quiz/questions.json')) as { objectives: Objective[]; questions: Question[]; retention: Question[] };

// Verbs that name something a person does and an observer can see.
const OBSERVABLE = ['send', 'list', 'add', 'predict', 'write', 'show', 'run', 'compare', 'tell'];
const VAGUE = /\b(know|understand|learn|appreciate|be aware|become familiar|grasp)\b/i;

test('there are six objectives, numbered O1 to O6', () => {
  assert.deepEqual(objectives.map((o) => o.id), ['O1', 'O2', 'O3', 'O4', 'O5', 'O6']);
});

test('every objective is observable behaviour: "The learner can <verb> ...", and never "know" or "understand"', () => {
  for (const o of objectives) {
    const verb = /^The learner can (\w+) /.exec(o.text)?.[1];
    assert.ok(verb && OBSERVABLE.includes(verb), `${o.id} starts with "${o.text.split(' ').slice(0, 4).join(' ')}"; use one of: ${OBSERVABLE.join(', ')}`);
    assert.ok(!VAGUE.test(o.text), `${o.id} uses a word nobody can observe`);
  }
});

test('objectives.md says what questions.json says, and each module file exists', () => {
  const doc = read('content/objectives.md');
  for (const o of objectives) {
    assert.ok(doc.includes(o.text), `${o.id} text differs in content/objectives.md`);
    const module = [1, 2, 3].includes(o.module) ? read(`content/module-${o.module}-${['exact-money', 'ledger-and-retries', 'overlap-and-refusals'][o.module - 1]}.md`) : '';
    assert.ok(module.includes(`(${o.id}`) || module.includes(`${o.id},`) || module.includes(`${o.id})`), `module ${o.module} never mentions ${o.id}`);
  }
});

test('every objective has at least three quiz questions and one retention question', () => {
  for (const o of objectives) {
    assert.ok(questions.filter((q) => q.objective === o.id).length >= 3, `${o.id} has fewer than 3 questions`);
    assert.ok(retention.filter((q) => q.objective === o.id).length >= 1, `${o.id} has no retention question`);
  }
});

test('no question points at an objective that does not exist, and ids are unique', () => {
  const ids = [...questions, ...retention].map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate question id');
  for (const q of [...questions, ...retention]) assert.ok(objectives.some((o) => o.id === q.objective), `${q.id} has objective ${q.objective}`);
});

test('every question has four options, one right answer and feedback on every option', () => {
  for (const q of [...questions, ...retention]) {
    assert.equal(q.options.length, 4, `${q.id} options`);
    assert.ok(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4, `${q.id} correct index`);
    for (const [i, o] of q.options.entries()) {
      assert.ok(o.text.trim().length > 0, `${q.id} option ${i} has no text`);
      assert.ok(o.feedback.trim().length > 15, `${q.id} option ${i} has no real feedback`);
    }
    assert.equal(new Set(q.options.map((o) => o.text)).size, 4, `${q.id} has two identical options`);
  }
});

test('the right answer is not always in the same place', () => {
  for (const set of [questions, retention]) {
    const counts = [0, 0, 0, 0];
    for (const q of set) counts[q.correct]!++;
    assert.ok(Math.max(...counts) <= Math.ceil(set.length / 2), `right answers by position: ${counts}`);
  }
});

test('every objective has one planted bug, one checklist row and one model-answer section', () => {
  const checklist = read('practical/checklist.md');
  const answer = read('practical/model-answer.md');
  for (const o of objectives) {
    const bug = BUGS.filter((b) => b.id === o.id);
    assert.equal(bug.length, 1, `${o.id} bugs`);
    assert.ok(checklist.includes(`| ${o.id} |`), `${o.id} not in checklist.md`);
    assert.ok(answer.includes(`## ${o.id}. ${bug[0]!.title}`), `model-answer.md has no section "## ${o.id}. ${bug[0]!.title}"`);
  }
});

test('the practical gives no score and the pilot is not reported as an evaluation', () => {
  assert.match(read('practical/brief.md'), /no score/i);
  assert.match(read('pilot/pilot.md'), /not an evaluation/i);
});

test('the retention check is written with a due date rule, in the pilot plan', () => {
  const pilot = read('pilot/pilot.md');
  assert.match(pilot, /14 days/);
  assert.match(pilot, /2026-11-06/);
  assert.ok(existsSync(new URL('../quiz/index.html', import.meta.url)));
});
