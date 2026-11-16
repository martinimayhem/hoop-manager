// Player names that always come out (SEASON_SPEC R10.5): every first × last pair in a seeded,
// shuffled order, skipping names (and ids) already taken; when every pair is used, the same order
// again with a suffix ("Jr.", "II", "III", …). Each round of the list yields at least one new name as
// long as fewer names are taken than pairs exist, so asking for n names always ends, in steps in
// proportion to n (never an endless redraw, as a random redraw becomes when the pairs run out).

import { createRng, next } from '../engine/rng';

const SUFFIXES = ['', ' Jr.', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];

/** The suffix for round `r` of the list (after X: " 11", " 12", …, so it never runs out). */
function suffix(r: number): string {
  return r < SUFFIXES.length ? SUFFIXES[r] : ` ${r + 1}`;
}

/**
 * A source of new names. `taken`: full names already in use; `idOf`: a name's id, checked against
 * `takenIds` (so a new player can never share an id with an existing one). Both sets are updated as
 * names are handed out.
 */
export function nameSource(first: readonly string[], last: readonly string[], seed: number, taken: Set<string>, takenIds: Set<string>, idOf: (name: string) => string): () => string {
  const pairs = first.length * last.length;
  if (pairs === 0) throw new Error('nameSource: empty name lists');
  // A seeded Fisher-Yates shuffle of every pair.
  const order = Array.from({ length: pairs }, (_, i) => i);
  const rng = createRng(seed);
  for (let i = pairs - 1; i > 0; i--) {
    const j = Math.floor(next(rng) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let at = 0;
  let round = 0;
  return () => {
    // At most one full pass per round finds a free name or moves to the next suffix; ids clashing
    // by chance with unrelated names are skipped like taken names.
    for (;;) {
      if (at >= pairs) {
        at = 0;
        round++;
      }
      const k = order[at++];
      const name = `${first[Math.floor(k / last.length)]} ${last[k % last.length]}${suffix(round)}`;
      const id = idOf(name);
      if (taken.has(name) || takenIds.has(id)) continue;
      taken.add(name);
      takenIds.add(id);
      return name;
    }
  };
}
