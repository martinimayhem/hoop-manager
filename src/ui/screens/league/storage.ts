// The browser's local storage for saves, or a stand-in that saves nothing when the browser blocks it
// (private windows, blocked site data), so the game still runs.

import type { SaveStorage } from '../../../game/league/saves';

function pick(): SaveStorage {
  try {
    const k = 'hm.probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem: Record<string, string> = {};
    return { getItem: (k) => mem[k] ?? null, setItem: (k, v) => void (mem[k] = v), removeItem: (k) => void delete mem[k] };
  }
}

export const browserStorage: SaveStorage = pick();
