// Career saves (WORLD_SPEC §14): a world is too big for local storage after a few seasons, so it goes
// to IndexedDB, compressed. Three career slots, apart from the Quick League's. Every save carries a
// format version (W1 version 2 started again at 1: the first W1's saves never shipped): an older one
// is upgraded step by step, a newer one (from a later version of the game) is not loaded, a broken one is reported and never crashes the game. The store is passed in, so the
// tests use one in memory.

import { startSeason } from '../season/play';
import { fitMarket } from './generate';
import { clubById, competitionsOf } from './query';
import { REGION_NAME, type World } from './types';

/** The career save format this version of the game writes (W1 version 2 started again at 1; 2: the season, slice W2a; 3: postseason, cups, history, slice W2b; 4: the wage market, contracts running out). */
export const WORLD_FORMAT = 4;
export const WORLD_SLOTS = 3;

/** Where the bytes go: IndexedDB in the browser, a Map in tests. */
export interface WorldStore {
  get(slot: number): Promise<Uint8Array | undefined>;
  put(slot: number, bytes: Uint8Array): Promise<void>;
  remove(slot: number): Promise<void>;
}

export interface WorldSummary {
  club: string;
  league: string;
  region: string;
  manager?: string;
  season: number;
}

interface WorldFile {
  format: number;
  kind: 'world';
  savedAt: string;
  summary: WorldSummary;
  data: World;
}

export type WorldSlot =
  | { slot: number; status: 'empty' }
  | { slot: number; status: 'ok'; savedAt: string; summary: WorldSummary; data: World }
  | { slot: number; status: 'newer' | 'broken'; message: string };

/** Upgrades by the format they start from: MIGRATIONS[1] turns a format-1 save into format 2. */
const MIGRATIONS: Record<number, (file: WorldFile) => WorldFile> = {
  // W1 careers get their season: the schedule, the day before the first.
  1: (f) => ({ ...f, format: 2, data: startSeason(f.data) }),
  // W2a seasons get their postseason (made as Continue goes on). Their calendar had no free cup
  // weekends, so that season has no cups; the next one does. A season ended at the regular season's
  // end carries on into its postseason.
  2: (f) => {
    const p = f.data.play;
    if (!p) return { ...f, format: 3 };
    const play = { ...p, ties: p.ties ?? [], made: p.made ?? {}, moment: null, noCups: true as const, ...(p.phase === 'review' ? { phase: 'regular' as const, done: true } : {}) };
    return { ...f, format: 3, data: { ...f.data, play } };
  },
  // The wage market (WORLD_SPEC §7.1): fitted from the save's current contracts, then stored.
  3: (f) => ({ ...f, format: 4, data: { ...f.data, market: f.data.market ?? fitMarket(f.data) } }),
};

export function summariseWorld(w: World): WorldSummary {
  const club = w.human ? clubById(w, w.human.club) : undefined;
  return {
    club: club?.name ?? '—',
    league: club ? competitionsOf(w, club.id).map((c) => c.name).join(' · ') : '—',
    region: club ? REGION_NAME[club.region] : '—',
    ...(w.human?.manager ? { manager: w.human.manager } : {}),
    season: w.season,
  };
}

// ---------------------------------------------------------------------------
// Bytes: the first byte says how the rest is stored (1 gzip, 0 plain JSON).

async function gzip(bytes: Uint8Array, mode: 'compress' | 'decompress'): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(mode === 'compress' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encode(value: unknown): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const canZip = typeof CompressionStream !== 'undefined';
  const body = canZip ? await gzip(json, 'compress') : json;
  const out = new Uint8Array(body.length + 1);
  out[0] = canZip ? 1 : 0;
  out.set(body, 1);
  return out;
}

export async function decode(bytes: Uint8Array): Promise<unknown> {
  const body = bytes.subarray(1);
  const json = bytes[0] === 1 ? await gzip(body, 'decompress') : body;
  return JSON.parse(new TextDecoder().decode(json));
}

// ---------------------------------------------------------------------------

function upgrade(raw: unknown): { file: WorldFile } | { status: 'newer' | 'broken'; message: string } {
  const f = raw as Partial<WorldFile> | null;
  if (!f || typeof f !== 'object' || typeof f.format !== 'number' || f.kind !== 'world' || !f.data || f.data.kind !== 'world') return { status: 'broken', message: "This save can't be read." };
  if (f.format > WORLD_FORMAT) return { status: 'newer', message: 'Made by a newer version of the game.' };
  let file = f as WorldFile;
  while (file.format < WORLD_FORMAT) {
    const step = MIGRATIONS[file.format];
    if (!step) return { status: 'broken', message: "This save can't be read." };
    file = step(file);
  }
  return { file };
}

export async function readWorld(store: WorldStore, slot: number): Promise<WorldSlot> {
  let bytes: Uint8Array | undefined;
  try {
    bytes = await store.get(slot);
  } catch {
    return { slot, status: 'broken', message: "This save can't be read." };
  }
  if (!bytes) return { slot, status: 'empty' };
  try {
    const r = upgrade(await decode(bytes));
    if ('status' in r) return { slot, ...r };
    return { slot, status: 'ok', savedAt: r.file.savedAt, summary: r.file.summary, data: r.file.data };
  } catch (err) {
    // Say why (and log it), so a broken save can be looked into.
    const why = err instanceof Error ? err.message : String(err);
    console.error(`[saves] career slot ${slot + 1} can't be read:`, err);
    return { slot, status: 'broken', message: `This save can't be read (${why.slice(0, 120)}).` };
  }
}

export async function listWorlds(store: WorldStore): Promise<WorldSlot[]> {
  return Promise.all(Array.from({ length: WORLD_SLOTS }, (_, i) => readWorld(store, i)));
}

/** Saves a world. Returns false if the browser refused (storage full or blocked). */
export async function writeWorld(store: WorldStore, slot: number, w: World, now = new Date()): Promise<boolean> {
  const file: WorldFile = { format: WORLD_FORMAT, kind: 'world', savedAt: now.toISOString(), summary: summariseWorld(w), data: w };
  try {
    await store.put(slot, await encode(file));
    return true;
  } catch {
    return false;
  }
}

export async function clearWorld(store: WorldStore, slot: number): Promise<void> {
  try {
    await store.remove(slot);
  } catch {
    /* nothing to clear */
  }
}

/** A store in memory (tests, and a browser that blocks IndexedDB: nothing outlives the page). */
export function memoryStore(): WorldStore {
  const m = new Map<number, Uint8Array>();
  return {
    get: async (slot) => m.get(slot),
    put: async (slot, bytes) => void m.set(slot, bytes),
    remove: async (slot) => void m.delete(slot),
  };
}

/** The browser's IndexedDB: database "hoop-manager", object store "careers", keyed by slot. */
export function indexedDbStore(): WorldStore {
  let opening: Promise<IDBDatabase> | null = null;
  const db = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('hoop-manager', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('careers');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await db();
    return new Promise<T>((resolve, reject) => {
      const tx = d.transaction('careers', mode);
      const req = f(tx.objectStore('careers'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: async (slot) => {
      const v = await run('readonly', (s) => s.get(slot) as IDBRequest<ArrayBuffer | Uint8Array | undefined>);
      return v ? new Uint8Array(v as ArrayBuffer) : undefined;
    },
    put: async (slot, bytes) => void (await run('readwrite', (s) => s.put(bytes, slot))),
    remove: async (slot) => void (await run('readwrite', (s) => s.delete(slot))),
  };
}

/** IndexedDB if the browser allows it, else memory. */
export function browserWorldStore(): WorldStore {
  try {
    if (typeof indexedDB !== 'undefined') return indexedDbStore();
  } catch {
    /* blocked */
  }
  return memoryStore();
}
