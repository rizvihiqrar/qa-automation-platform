// The practice page: an order desk with 30 elements the drill looks for. Every element
// the drill cares about has a data-key. That attribute is the answer sheet only: no
// selector may use it, and the layout changes keep it, so "still finds the right
// element" means "finds the element with the same data-key".
export function buildPage(): string {
  const rows = [1001, 1002, 1003, 1004]
    .map((n) => `<tr data-order="${n}" class="row css-r${n}">
        <td><input type="checkbox" name="select-${n}" ${n === 1003 ? 'data-key="row-1003-checkbox"' : ''}></td>
        <td>#${n}</td>
        <td><a href="/orders/${n}" ${n === 1001 ? 'data-key="row-1001-view"' : ''} class="view">View</a></td>
        <td><button type="button" aria-label="Cancel order ${n}" ${n === 1002 ? 'data-key="row-1002-cancel"' : ''} class="btn btn-danger css-c${n}">Cancel</button></td>
      </tr>`)
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Order desk</title></head><body>
<header><h1 data-key="heading" class="title css-h1">Order desk</h1>
<nav aria-label="Main" class="nav css-n1">
  <a href="/home" data-key="nav-home" class="nav-link">Home</a>
  <a href="/orders" data-key="nav-orders" class="nav-link">Orders</a>
  <a href="/help" data-key="nav-help" class="nav-link">Help</a>
  <a href="/account" data-key="nav-account" aria-label="Account menu" class="nav-link">Me</a>
</nav></header>
<main class="main css-m1">
<section class="search css-s1">
  <input type="search" name="q" data-key="search-input" placeholder="Order number" class="input css-i1">
  <button type="submit" aria-label="Search orders" data-key="search-button" class="btn btn-primary css-b1">Go</button>
  <div class="chips css-ch">
    <button type="button" data-filter="open" data-key="chip-open" class="chip chip-open">Open</button>
    <button type="button" data-filter="shipped" data-key="chip-shipped" class="chip chip-shipped">Shipped</button>
    <button type="button" data-filter="late" data-key="chip-late" class="chip chip-late">Late</button>
  </div>
</section>
<section class="orders css-o1">
  <table aria-label="Orders" data-key="orders-table" class="table css-t1"><thead><tr>
    <th><input type="checkbox" aria-label="Select all orders" data-key="select-all"></th><th>Order</th><th></th><th></th></tr></thead>
    <tbody>
${rows}
    </tbody></table>
  <p class="total css-tt">Total: <span data-testid="order-total" data-key="order-total">$412.50</span></p>
</section>
<form class="form css-f1" action="/place" method="post">
  <div class="field"><label>Full name <input name="fullName" data-key="full-name" class="input css-i2"></label></div>
  <div class="field"><label>Email <input type="email" name="email" data-key="email" class="input css-i3"></label></div>
  <div class="field"><label>Phone <input autocomplete="tel" name="phone" data-key="phone" class="input css-i4"></label></div>
  <div class="field"><label>Country <select name="country" data-key="country" class="select css-s2"><option>Canada</option><option>Brazil</option></select></label></div>
  <div class="field"><label><input type="radio" name="speed" value="standard" checked data-key="speed-standard"> Standard</label>
    <label><input type="radio" name="speed" value="express" data-key="speed-express"> Express</label></div>
  <div class="field"><label><input type="checkbox" name="newsletter" data-key="newsletter"> Send me the newsletter</label></div>
  <div class="field"><label>Notes <textarea name="notes" data-key="notes" class="input css-i5"></textarea></label></div>
  <div class="actions css-a1">
    <button type="submit" data-testid="place-order" data-key="place-order" class="btn btn-primary css-b2">Place order</button>
    <button type="reset" data-key="reset" class="btn css-b3">Clear</button>
  </div>
</form>
<dialog open aria-labelledby="help-title" class="dialog css-d1"><h2 id="help-title">Need help?</h2>
  <button type="button" aria-label="Close" data-key="dialog-close" class="btn css-b4">x</button></dialog>
</main>
<footer class="footer css-fo"><a href="/terms" data-key="terms" class="foot-link">Terms</a>
  <a href="/privacy" data-key="privacy" class="foot-link">Privacy</a>
  <a href="mailto:help@example.test" data-key="contact" class="foot-link">Contact</a></footer>
</body></html>`;
}
