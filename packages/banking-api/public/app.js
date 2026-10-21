// The banking UI: plain JavaScript, no framework and no build, served by banking-api
// itself. Money is text from the input to the request to the screen: this file never
// turns an amount into a number, never does sums, and shows balances only as the API
// returns them (BK-R33, BK-R36). Every page is built with textContent, never HTML
// strings, so an owner's name can't become markup (BK-R32).

const DECIMALS = { CAD: 2, USD: 2, JPY: 0, KWD: 3 };
const RETRIES = 3; // after the first attempt
const RETRYABLE = new Set([409, 502, 503, 504]);
const main = document.getElementById('main');

// ---- Small helpers -------------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) el.append(child);
  }
  return el;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ids are whole numbers in the API (BK-R17); they are the only numbers this file sends.
const toId = (text) => (/^[1-9][0-9]{0,14}$/.test(text) ? Number(text) : null);

function amountHint(currency) {
  const decimals = DECIMALS[currency];
  if (decimals === 0) return `Whole ${currency}, no decimals, for example 1250`;
  return `Up to ${decimals} decimals, for example 12.${'5'.padEnd(decimals, '0')}`;
}

// When the database stays busy past five seconds, the API asks for a retry after Retry-After seconds.
function retryDelay(reply, attempt) {
  const after = reply?.headers.get('Retry-After');
  if (after && /^[0-9]{1,2}$/.test(after)) return Number(after) * 1000;
  return 250 * 2 ** attempt;
}

// ---- The API -------------------------------------------------------------------

async function api(method, path, body, headers = {}) {
  const init = { method, headers: { Accept: 'application/json', ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

// One Idempotency-Key per filled form: made at the first submit and reused until the
// API gives a final answer, so a double click, a second Enter or a retry after a lost
// reply moves the money once. Change what the form asks for and it gets a new key
// (BK-R35).
const keys = new WeakMap();

function keyFor(form, request) {
  const signature = JSON.stringify(request);
  let entry = keys.get(form);
  if (!entry || entry.signature !== signature) {
    entry = { signature, key: crypto.randomUUID() };
    keys.set(form, entry);
  }
  return entry.key;
}

// Sends a movement, retrying with the same key when no final answer came back: no
// reply at all, 409 (the first try is still running), or 502/503/504. Returns the
// last reply, or null if the API was never reached.
async function sendMovement(form, path, body) {
  const key = keyFor(form, [path, body]);
  let reply = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      reply = await api('POST', path, body, { 'Idempotency-Key': key });
    } catch {
      reply = null;
    }
    if (reply && !RETRYABLE.has(reply.status)) break;
    if (attempt < RETRIES) await wait(retryDelay(reply, attempt));
  }
  if (reply && !RETRYABLE.has(reply.status)) keys.delete(form);
  return reply;
}

// ---- Routing -------------------------------------------------------------------

function route() {
  const hash = location.hash || '#/';
  if (!hash.startsWith('#/')) return; // the skip link, not a page
  const account = /^#\/accounts\/([^/]+)$/.exec(hash);
  if (hash === '#/') return showAccounts();
  if (account) {
    const id = toId(account[1]);
    return id === null ? showNotFound() : showAccount(id);
  }
  return showNotFound();
}

function setPage(title, ...content) {
  const heading = h('h1', { tabindex: -1, 'data-cy': 'title' }, title);
  main.replaceChildren(heading, ...content);
  document.title = `${title} · Banking Demo`;
  heading.focus();
}

function showUnreachable(retry) {
  setPage('Bank Unavailable',
    h('p', { class: 'lead', role: 'alert' }, 'The bank could not be reached. Nothing was changed.'),
    h('button', { type: 'button', class: 'btn', onclick: retry }, 'Try Again'));
}

function showNotFound() {
  setPage('Account Not Found',
    h('p', { class: 'lead' }, 'There is no account at this address.'),
    h('a', { href: '#/' }, 'Back to Accounts'));
}

// ---- Accounts ------------------------------------------------------------------

async function showAccounts() {
  let reply;
  try {
    reply = await api('GET', '/accounts');
  } catch {
    return showUnreachable(showAccounts);
  }
  const accounts = reply.data?.accounts ?? [];
  const list = accounts.length === 0
    ? h('p', { 'data-cy': 'no-accounts' }, 'No accounts yet.')
    : h('div', { class: 'table-wrap', tabindex: 0, role: 'region', 'aria-label': 'All Accounts' }, h('table', { 'data-cy': 'accounts' },
      h('caption', {}, 'All Accounts'),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Owner'), h('th', { scope: 'col' }, 'Account'),
        h('th', { scope: 'col' }, 'Currency'), h('th', { scope: 'col', class: 'money' }, 'Balance'))),
      h('tbody', {}, accounts.map((a) => h('tr', { 'data-cy': `account-${a.id}` },
        h('td', {}, h('a', { href: `#/accounts/${a.id}` }, a.owner)),
        h('td', {}, `#${a.id}`),
        h('td', {}, a.currency),
        h('td', { class: 'money', 'data-cy': 'balance' }, a.balance))))));
  setPage('Accounts', h('p', { class: 'lead' }, 'Every account at the bank, oldest first.'), list, openAccountForm());
}

function openAccountForm() {
  const error = h('p', { id: 'open-error', class: 'error', role: 'alert', 'data-cy': 'error' });
  const owner = h('input', { id: 'open-owner', name: 'owner', type: 'text', autocomplete: 'off', 'aria-describedby': 'open-error', 'data-cy': 'owner' });
  const currency = h('select', { id: 'open-currency', name: 'currency', 'data-cy': 'currency' },
    Object.keys(DECIMALS).map((c) => h('option', { value: c }, c)));
  const button = h('button', { type: 'submit', class: 'btn', 'data-cy': 'submit' }, 'Open Account');
  const form = h('form', { class: 'card', 'data-cy': 'open-form', novalidate: true },
    h('h2', {}, 'Open an Account'),
    h('div', { class: 'field' }, h('label', { for: 'open-owner' }, 'Owner'), owner),
    h('div', { class: 'field' }, h('label', { for: 'open-currency' }, 'Currency'), currency),
    button, error);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    error.textContent = '';
    owner.removeAttribute('aria-invalid');
    try {
      const reply = await api('POST', '/accounts', { owner: owner.value, currency: currency.value });
      if (reply.status === 201) {
        location.hash = `#/accounts/${reply.data.id}`;
        return;
      }
      error.textContent = reply.data?.error ?? `The bank answered ${reply.status}.`;
      if (reply.data?.code === 'invalid_owner') owner.setAttribute('aria-invalid', 'true');
    } catch {
      error.textContent = 'The bank could not be reached. Nothing was changed.';
    } finally {
      button.disabled = false;
    }
  });
  return h('div', { class: 'grid narrow' }, form);
}

// ---- One account ---------------------------------------------------------------

async function showAccount(id) {
  let reply;
  let others;
  try {
    [reply, others] = await Promise.all([api('GET', `/accounts/${id}/entries`), api('GET', '/accounts')]);
  } catch {
    return showUnreachable(() => showAccount(id));
  }
  if (reply.status === 404) return showNotFound();
  if (reply.status !== 200) return showUnreachable(() => showAccount(id));
  const account = reply.data;
  const balance = h('strong', { 'data-cy': 'balance' }, account.balance);
  // Scrolls sideways on a phone, so it can take focus and be scrolled with the keys.
  const statement = h('div', { class: 'table-wrap', tabindex: 0, role: 'region', 'aria-label': 'Statement', 'data-cy': 'statement' });
  const view = { account, balance, statement };
  fillStatement(view, account);

  const targets = (others.data?.accounts ?? []).filter((a) => a.id !== account.id);
  setPage(`${account.owner}'s ${account.currency} Account`,
    h('p', { class: 'balance' }, 'Balance ', balance, ` ${account.currency}`),
    h('div', { class: 'grid' },
      movementForm(view, 'deposit', 'Deposit', `/accounts/${id}/deposits`),
      movementForm(view, 'withdraw', 'Withdraw', `/accounts/${id}/withdrawals`),
      movementForm(view, 'transfer', 'Transfer', '/transfers', targets)),
    statement);
}

// The balance and statement are always the API's, read again after every answer, so
// a page left open while another tab spends the money never shows a stale balance
// once it tries (BK-R36).
async function refresh(view) {
  try {
    const reply = await api('GET', `/accounts/${view.account.id}/entries`);
    if (reply.status === 200) fillStatement(view, reply.data);
  } catch {
    // Keep what is shown; the next answer will try again.
  }
}

function describe(entry) {
  if (entry.kind === 'deposit') return 'Deposit';
  if (entry.kind === 'withdrawal') return 'Withdrawal';
  const outgoing = entry.amount.startsWith('-');
  return `Transfer ${outgoing ? 'to' : 'from'} #${entry.counterparty_account_id}`;
}

function fillStatement(view, account) {
  view.balance.textContent = account.balance;
  const entries = account.entries;
  view.statement.replaceChildren(entries.length === 0
    ? h('p', { 'data-cy': 'no-entries' }, h('strong', {}, 'Statement: '), 'no entries yet.')
    : h('table', {},
      h('caption', {}, 'Statement'),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Description'),
        h('th', { scope: 'col', class: 'money' }, 'Amount'), h('th', { scope: 'col', class: 'money' }, 'Balance After'))),
      h('tbody', {}, entries.map((e) => h('tr', { 'data-cy': 'entry' },
        h('td', {}, e.created_at.slice(0, 16).replace('T', ' ')),
        h('td', {}, describe(e)),
        h('td', { class: 'money', 'data-cy': 'amount' }, e.amount),
        h('td', { class: 'money', 'data-cy': 'balance-after' }, e.balance_after))))));
}

const PAST = { deposit: 'Deposited', withdraw: 'Withdrew', transfer: 'Transferred' };
// Which field a refusal is about, so it can be marked invalid.
const FIELD_OF = { invalid_amount: 'amount', insufficient_funds: 'amount', limit_exceeded: 'amount', currency_mismatch: 'to', same_account: 'to', invalid_account_id: 'to' };

function movementForm(view, name, title, path, targets) {
  const { account } = view;
  const ids = { amount: `${name}-amount`, hint: `${name}-hint`, to: `${name}-to`, error: `${name}-error` };
  const error = h('p', { id: ids.error, class: 'error', role: 'alert', 'data-cy': 'error' });
  const status = h('p', { class: 'status', role: 'status', 'data-cy': 'status' });
  const amount = h('input', {
    id: ids.amount, name: 'amount', type: 'text', class: 'amount', autocomplete: 'off', spellcheck: 'false',
    inputmode: DECIMALS[account.currency] === 0 ? 'numeric' : 'decimal',
    'aria-describedby': `${ids.hint} ${ids.error}`, 'data-cy': 'amount',
  });
  const fields = { amount };
  const rows = [];
  if (targets) {
    fields.to = h('select', { id: ids.to, name: 'to', 'aria-describedby': ids.error, 'data-cy': 'to' },
      targets.length === 0 ? h('option', { value: '' }, 'No other accounts') : null,
      targets.map((t) => h('option', { value: t.id }, `#${t.id} ${t.owner} (${t.currency})`)));
    rows.push(h('div', { class: 'field' }, h('label', { for: ids.to }, 'To Account'), fields.to));
  }
  rows.push(h('div', { class: 'field' },
    h('label', { for: ids.amount }, `Amount (${account.currency})`),
    h('span', { id: ids.hint, class: 'hint' }, amountHint(account.currency)),
    amount));
  const button = h('button', { type: 'submit', class: 'btn', 'data-cy': 'submit' }, title);
  const form = h('form', { class: 'card', 'data-cy': `${name}-form`, novalidate: true },
    h('h2', {}, title), rows, button, error, status);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return; // a second click or Enter while the first is running
    button.disabled = true;
    error.textContent = '';
    status.textContent = '';
    for (const field of Object.values(fields)) field.removeAttribute('aria-invalid');

    // The amount goes as typed, without spaces around it: a string, never a number.
    const body = { amount: amount.value.trim(), currency: account.currency };
    if (fields.to) {
      body.from_account_id = account.id;
      body.to_account_id = toId(fields.to.value);
    }
    try {
      const reply = await sendMovement(form, path, body);
      if (reply?.status === 201) {
        status.textContent = `${PAST[name]} ${reply.data.amount} ${reply.data.currency}.`;
        amount.value = '';
      } else if (reply && !RETRYABLE.has(reply.status)) {
        error.textContent = reply.data?.error ?? `The bank answered ${reply.status}.`;
        const field = fields[FIELD_OF[reply.data?.code]];
        if (field) field.setAttribute('aria-invalid', 'true');
      } else {
        // The key is kept: sending the same form again can't move the money twice.
        error.textContent = 'The bank did not confirm this. Send it again: it will not move the money twice.';
      }
    } finally {
      button.disabled = false;
      await refresh(view);
    }
  });
  return form;
}

// ---- Theme: light or dark, the device's choice until the visitor picks -----------

const themeButton = document.getElementById('theme');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const next = theme === 'dark' ? 'Light' : 'Dark';
  themeButton.textContent = theme === 'dark' ? '☀' : '☾';
  themeButton.setAttribute('aria-label', `Switch to ${next} Mode`);
  themeButton.title = `Switch to ${next} Mode`;
}

function savedTheme() {
  try {
    return localStorage.getItem('theme');
  } catch {
    return null;
  }
}

applyTheme(savedTheme() ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
themeButton.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // Remembering is a convenience; the switch still works.
  }
});

document.querySelector('.skip').addEventListener('click', (event) => {
  event.preventDefault();
  main.focus();
});

addEventListener('hashchange', route);
route();
