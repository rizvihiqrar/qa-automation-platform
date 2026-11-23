// A small sanctions list and the name matching against it (BK-R44). Every name here is
// invented: there is no real person on the list, and no real list is read.

export interface Listed {
  id: string;
  // The name and the spellings it is known by (transliterations).
  names: string[];
}

export const SANCTIONS_DEMO: Listed[] = [
  { id: 'S-001', names: ['Viktor Ostrovsky', 'Victor Ostrovskiy'] },
  { id: 'S-002', names: ['Muhammad Al-Rahimi'] },
  { id: 'S-003', names: ['Elena Voronina', 'Yelena Voronina'] },
  { id: 'S-004', names: ['Yusuf Karimov', 'Youssef Karimoff'] },
];

// Spellings that mean one name; the first of each group is the one kept.
const SPELLINGS = [
  ['muhammad', 'mohammed', 'mohamed', 'mohammad', 'muhammed'],
  ['yusuf', 'youssef', 'yousef', 'yosef'],
];
const CANONICAL = new Map(SPELLINGS.flatMap((group) => group.map((spelling) => [spelling, group[0]!] as const)));
// Letters that are not an accent on another letter, so NFD leaves them: written as the letters they sound like.
const FOLD: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ß: 'ss', æ: 'ae', œ: 'oe' };
// Particles that belong to the name after them: "Al-Rahimi", "Al Rahimi" and "Alrahimi" are one name.
const PARTICLES = new Set(['al', 'el']);

// Letters only, no accents, no case, no punctuation; particles joined to the next word;
// known spellings made one; words sorted, so "Ostrovsky, Viktor" and "Viktor Ostrovsky"
// are the same. A name with no Latin letters has no words and matches nothing.
export function normalize(name: string): string {
  const words = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[łøđðþßæœ]/g, (c) => FOLD[c]!).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const joined: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = words[i + 1];
    if (PARTICLES.has(word) && next !== undefined) {
      joined.push(word + next);
      i++;
    } else {
      joined.push(word);
    }
  }
  return joined.map((word) => CANONICAL.get(word) ?? word).sort().join(' ');
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]!;
}

// Shorter than this, one wrong letter is a different name, so only an exact match counts.
export const NEAR_MIN_LENGTH = 10;

export type Match = { kind: 'exact' | 'near'; listed: string };

// The listed name this one is: `exact` when the two normalize to the same words, `near`
// when they differ by one letter (a typing slip or another transliteration) and are long
// enough for that to mean something. An exact match anywhere beats a near one.
export function matchName(name: string, list: Listed[] = SANCTIONS_DEMO): Match | null {
  const key = normalize(name);
  if (key === '') return null;
  let near: Match | null = null;
  for (const entry of list) {
    for (const listedName of entry.names) {
      const listedKey = normalize(listedName);
      if (key === listedKey) return { kind: 'exact', listed: entry.id };
      if (!near && key.length >= NEAR_MIN_LENGTH && distance(key, listedKey) === 1) near = { kind: 'near', listed: entry.id };
    }
  }
  return near;
}
