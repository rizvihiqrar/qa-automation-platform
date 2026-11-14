// Layout changes, applied to the live page. applyVariant runs inside the browser
// (page.evaluate), so it can't use anything outside itself: the three changes are
// inner functions. All of them keep every data-key, every attribute except class,
// and the text, so a person would say it is the same page.
export const VARIANTS = ['wrap', 'rename', 'reorder', 'redesign'] as const;
export type Variant = (typeof VARIANTS)[number];

export function applyVariant(variant: string): void {
  // Extra wrappers: the ones a layout framework or a new grid adds.
  function wrap(): void {
    for (const parent of Array.from(document.querySelectorAll('main, form, nav'))) {
      for (const child of Array.from(parent.children)) {
        const div = document.createElement('div');
        div.className = 'wrapper';
        parent.replaceChild(div, child);
        div.appendChild(child);
      }
    }
    for (const td of Array.from(document.querySelectorAll('td'))) {
      const div = document.createElement('div');
      div.className = 'wrapper';
      while (td.firstChild) div.appendChild(td.firstChild);
      td.appendChild(div);
    }
    const root = document.createElement('div');
    root.id = 'app-root';
    while (document.body.firstChild) root.appendChild(document.body.firstChild);
    document.body.appendChild(root);
    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.textContent = 'New: faster checkout';
    root.insertBefore(banner, root.firstChild);
  }

  // New class names everywhere: a restyle, or a build that hashes class names.
  function rename(): void {
    let n = 0;
    for (const el of Array.from(document.querySelectorAll('[class]'))) el.className = 'x' + (++n * 7919).toString(36);
  }

  // Same things, other order: a sorted table, a nav that puts Help first, fields moved.
  function reorder(): void {
    for (const parent of Array.from(document.querySelectorAll('nav, .chips, tbody, form'))) {
      for (const child of Array.from(parent.children)) parent.insertBefore(child, parent.firstChild);
    }
  }

  if (variant === 'wrap' || variant === 'redesign') wrap();
  if (variant === 'rename' || variant === 'redesign') rename();
  if (variant === 'reorder' || variant === 'redesign') reorder();
}
