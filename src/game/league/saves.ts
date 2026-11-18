// Saves (SEASON_SPEC R11.2): three slots in the browser's local storage, shared by both modes.
// Every save carries a format version: an older one is upgraded step by step to the current one; a
// newer one (from a later version of the game) is not loaded; a broken or incompatible one is
// reported, never crashes, and leaves the other slots alone. The storage is passed in, so the tests
// can use a plain object.

import { ROSTER_SIZE } from '../draft';
import { leagueName } from './leagues';
import { MATCHDAYS, poolOf, table, type QuickLeague } from './quickLeague';

/** The save format this version of the game writes. */
export const SAVE_FORMAT = 1;
export const SLOTS = 3;
const KEY = (slot: number) => `hm.save.${slot}`;

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface SaveFile {
  format: number;
  kind: 'quick';
  savedAt: string;
  data: QuickLeague;
}

export type SlotInfo =
  | { slot: number; status: 'empty' }
  | { slot: number; status: 'ok'; savedAt: string; label: string; data: QuickLeague }
  | { slot: number; status: 'newer' | 'broken' | 'incompatible'; message: string };

/**
 * Upgrades from one format to the next, by the format they start from: `MIGRATIONS[1]` would turn a
 * format-1 save into format 2. (None yet: format 1 is the first.)
 */
const MIGRATIONS: Record<number, (file: SaveFile) => SaveFile> = {};

/** A save at a glance, for the slot list: the club, its league and manager, and how far it has got. */
export interface SaveSummary {
  club: string;
  league: string;
  manager?: string;
  /** "Draft · pick 8 of 96", "Matchday 6 of 14 · 3rd, 4–1", "Season over · finished 2nd". */
  progress: string;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

export function summarise(q: QuickLeague): SaveSummary {
  const me = q.teams.findIndex((t) => t.human !== null);
  const base = { club: q.teams[me]?.name ?? '?', league: leagueName(q.league, q.region), manager: q.manager };
  if (q.phase === 'draft') return { ...base, progress: `Draft · pick ${q.draft.pickNo + 1} of ${q.teams.length * ROSTER_SIZE}` };
  const rows = table(q);
  const at = rows.findIndex((r) => r.team === me);
  const r = rows[at];
  // A place in the table only once games have been played.
  const place = r && r.played ? ` · ${ordinal(at + 1)}, ${r.won}–${r.lost}` : '';
  if (q.phase === 'finished') return { ...base, progress: `Season over · finished ${ordinal(at + 1)}${r ? `, ${r.won}–${r.lost}` : ''}` };
  return { ...base, progress: `Matchday ${q.matchday + 1} of ${MATCHDAYS}${place}` };
}

/** One line about a save. */
export function describe(q: QuickLeague): string {
  const x = summarise(q);
  return `${x.club} · ${x.league} · ${x.progress}`;
}

/** Brings a save to the current format, or says why it can't be loaded. */
function upgrade(raw: unknown): { file: SaveFile } | { status: 'newer' | 'broken' | 'incompatible'; message: string } {
  const f = raw as Partial<SaveFile> | null;
  if (!f || typeof f !== 'object' || typeof f.format !== 'number' || f.kind !== 'quick' || !f.data) return { status: 'broken', message: "This save can't be read." };
  if (f.format > SAVE_FORMAT) return { status: 'newer', message: 'Made by a newer version of the game.' };
  let file = f as SaveFile;
  while (file.format < SAVE_FORMAT) {
    const step = MIGRATIONS[file.format];
    if (!step) return { status: 'broken', message: "This save can't be read." };
    file = step(file);
  }
  // Every player it names must still exist in its league (the pool is rebuilt from data, not saved).
  const pool = new Set(poolOf(file.data).map((p) => p.player.id));
  const missing = Object.keys(file.data.draft.owner).some((id) => !pool.has(id));
  if (missing) return { status: 'incompatible', message: 'This save needs players this version of the game no longer has.' };
  return { file };
}

export function readSlot(storage: SaveStorage, slot: number): SlotInfo {
  let text: string | null;
  try {
    text = storage.getItem(KEY(slot));
  } catch {
    return { slot, status: 'broken', message: "This save can't be read." };
  }
  if (text === null) return { slot, status: 'empty' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { slot, status: 'broken', message: "This save can't be read." };
  }
  try {
    const r = upgrade(raw);
    if ('status' in r) return { slot, ...r };
    return { slot, status: 'ok', savedAt: r.file.savedAt, label: describe(r.file.data), data: r.file.data };
  } catch {
    return { slot, status: 'broken', message: "This save can't be read." };
  }
}

export function listSlots(storage: SaveStorage): SlotInfo[] {
  return Array.from({ length: SLOTS }, (_, i) => readSlot(storage, i));
}

/** Saves a league to a slot. Returns false if the browser refused (storage full or blocked). */
export function writeSlot(storage: SaveStorage, slot: number, q: QuickLeague, now = new Date()): boolean {
  const file: SaveFile = { format: SAVE_FORMAT, kind: 'quick', savedAt: now.toISOString(), data: q };
  try {
    storage.setItem(KEY(slot), JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

export function clearSlot(storage: SaveStorage, slot: number): void {
  try {
    storage.removeItem(KEY(slot));
  } catch {
    /* nothing to clear */
  }
}
