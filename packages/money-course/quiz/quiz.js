// The quiz: one question per fieldset, feedback at once for the option chosen, a result per
// objective at the end and one line to copy back. Nothing is stored or sent anywhere.
// ?mode=before (default), ?mode=after (same questions), ?mode=retention (six new ones).
(() => {
  const MODES = {
    before: { title: 'Before the course', set: 'questions', lede: 'The same questions come again after the course. It is fine not to know: this shows where you start. Nothing here is graded.' },
    after: { title: 'After the course', set: 'questions', lede: 'The same questions as before the course. Nothing here is graded.' },
    retention: { title: 'Two weeks later', set: 'retention', lede: 'Six new questions, one for each objective, two weeks after the course. Nothing here is graded.' },
  };
  const mode = MODES[new URLSearchParams(location.search).get('mode')] ? new URLSearchParams(location.search).get('mode') : 'before';
  const $ = (id) => document.getElementById(id);
  const answers = new Map(); // question id -> chosen option index
  let data;

  function text(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = value;
    return el;
  }

  function render() {
    const { title, set, lede } = MODES[mode];
    $('title').textContent = `Testing money in software: ${title.toLowerCase()}`;
    document.title = `Testing money in software: quiz, ${title.toLowerCase()}`;
    $('lede').textContent = lede;
    $('intro').hidden = false;
    const holder = $('questions');
    for (const objective of data.objectives) {
      const questions = data[set].filter((q) => q.objective === objective.id);
      const heading = text('h2', '', `${objective.id}. `);
      heading.append(text('span', 'tag', objective.text));
      holder.append(heading);
      for (const q of questions) holder.append(questionEl(q));
    }
    update();
  }

  function questionEl(q) {
    const field = document.createElement('fieldset');
    field.className = 'question';
    field.dataset.id = q.id;
    field.append(text('legend', '', q.text));
    const options = document.createElement('div');
    options.className = 'options';
    q.options.forEach((option, i) => {
      const label = document.createElement('label');
      label.className = 'option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = q.id;
      input.value = String(i);
      input.addEventListener('change', () => choose(q, field, i));
      label.append(input, text('span', '', option.text));
      options.append(label);
    });
    const feedback = document.createElement('div');
    feedback.setAttribute('role', 'status');
    field.append(options, feedback);
    return field;
  }

  function choose(q, field, i) {
    if (answers.has(q.id)) return;
    answers.set(q.id, i);
    const right = i === q.correct;
    const labels = field.querySelectorAll('.option');
    labels[i].classList.add(right ? 'right' : 'wrong');
    labels[q.correct].classList.add('right');
    for (const input of field.querySelectorAll('input')) input.disabled = true;
    const box = field.querySelector('[role="status"]');
    box.className = `feedback ${right ? 'right' : 'wrong'}`;
    box.replaceChildren(text('strong', '', right ? 'Correct.' : 'Not quite.'), document.createTextNode(q.options[i].feedback));
    if (!right) box.append(text('strong', '', 'The right answer'), document.createTextNode(`${q.options[q.correct].text}. ${q.options[q.correct].feedback}`));
    update();
  }

  function update() {
    const total = data[MODES[mode].set].length;
    const left = total - answers.size;
    $('show-results').disabled = left > 0;
    $('left').textContent = left > 0 ? `${left} of ${total} questions left.` : 'All answered.';
  }

  function results() {
    const questions = data[MODES[mode].set];
    const score = (list) => list.filter((q) => answers.get(q.id) === q.correct).length;
    const missed = [];
    const list = $('by-objective');
    list.replaceChildren();
    for (const objective of data.objectives) {
      const mine = questions.filter((q) => q.objective === objective.id);
      const got = score(mine);
      if (got < mine.length) missed.push(objective.id);
      list.append(text('li', '', `${objective.id}: ${got} of ${mine.length}`));
    }
    const all = score(questions);
    $('total').textContent = `${all} of ${questions.length}`;
    const code = $('code').value.trim() || 'no code';
    $('summary').value = `${code} | ${mode} | ${all}/${questions.length} | missed: ${missed.length ? missed.join(', ') : 'none'}`;
    $('results').hidden = false;
    $('results').scrollIntoView({ block: 'nearest' });
  }

  async function start() {
    try {
      const res = await fetch('questions.json');
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
    } catch {
      $('lede').textContent = 'The questions could not be loaded. Open this page through a web server (npm run quiz in packages/money-course) or from the published site.';
      return;
    }
    $('show-results').addEventListener('click', results);
    render();
  }

  start();
})();
