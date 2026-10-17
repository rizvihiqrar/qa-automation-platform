// Limits sign-in attempts per (client, email): after `max` attempts that did not
// succeed, every attempt for that pair is refused until the window that began with
// the first of them ends. A successful sign-in clears the count.
//
// An attempt is counted when it starts, not when its password turns out wrong.
// Checking the password takes tens of milliseconds, so counting only finished
// failures would let a burst of parallel guesses all pass the check before the
// first one was recorded.

export interface Attempt {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface Entry {
  attempts: number;
  resetAt: number;
}

export class AttemptLimiter {
  #entries = new Map<string, Entry>();
  #nextSweep = 0;
  readonly max: number;
  readonly windowMs: number;
  readonly now: () => number;

  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  // Records an attempt for `key` and says whether it may go ahead.
  attempt(key: string): Attempt {
    const now = this.now();
    let entry = this.#entries.get(key);
    if (!entry || entry.resetAt <= now) {
      this.#sweep(now);
      entry = { attempts: 0, resetAt: now + this.windowMs };
      this.#entries.set(key, entry);
    }
    if (entry.attempts >= this.max) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
    }
    entry.attempts++;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  succeeded(key: string): void {
    this.#entries.delete(key);
  }

  get size(): number {
    return this.#entries.size;
  }

  // Expired entries are dropped at most once a window, so a stream of made-up
  // emails can't grow the map past about two windows' worth, and the sweep stays
  // cheap per request.
  #sweep(now: number): void {
    if (now < this.#nextSweep) return;
    this.#nextSweep = now + this.windowMs;
    for (const [key, entry] of this.#entries) if (entry.resetAt <= now) this.#entries.delete(key);
  }
}
