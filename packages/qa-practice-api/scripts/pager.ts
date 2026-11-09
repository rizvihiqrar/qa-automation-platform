// The game day's pager (scripts/game-day.ts): it watches the readiness check once a
// tick and pages the responder after `PAGE_AFTER` failures in a row, the way an
// alert rule with "for 3 checks" does. One bad answer pages nobody; the page is
// sent once and cleared only after `RESOLVE_AFTER` good answers in a row.
export const PAGE_AFTER = 3;
export const RESOLVE_AFTER = 3;

export type PagerEvent = 'page' | 'resolve' | null;

export class Pager {
  paging = false;
  #bad = 0;
  #good = 0;

  // `ready` is whether this tick's readiness check answered 200.
  check(ready: boolean): PagerEvent {
    if (ready) {
      this.#bad = 0;
      this.#good++;
      if (this.paging && this.#good >= RESOLVE_AFTER) {
        this.paging = false;
        return 'resolve';
      }
      return null;
    }
    this.#good = 0;
    this.#bad++;
    if (!this.paging && this.#bad >= PAGE_AFTER) {
      this.paging = true;
      return 'page';
    }
    return null;
  }
}
