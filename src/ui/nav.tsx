// Navigation (GAME_FLOW §6.1b): every screen has an address in the page's URL (after the #), and
// moving between screens uses the browser's own history. So the Back button, the browser's back
// button, a mouse's back button, Escape and a tablet's swipe all go to the previous screen, and a
// reload comes back to the same screen. A screen with something to lose (a match under way) sets a
// guard that is asked before anything leaves it.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LeagueId, Region } from '../game/league/leagues';

/** A career screen (the sidebar sections and what opens from them). */
export type CareerView = { kind: 'squad' } | { kind: 'player'; id: string } | { kind: 'competitions' } | { kind: 'competition'; id: string } | { kind: 'club'; id: string };

export type Route =
  | { s: 'menu' }
  | { s: 'saves' }
  | { s: 'quick-new'; league: LeagueId; region: Region }
  | { s: 'quick'; slot: number; step: 'hub' | 'prep' | 'match' | 'result' }
  | { s: 'friendly'; step: 'prep' | 'match' | 'result' }
  | { s: 'career-new' }
  | { s: 'career'; slot: number; view: CareerView };

const LEAGUE_IDS: LeagueId[] = ['street', 'pro', 'legends'];

export function toPath(r: Route): string {
  switch (r.s) {
    case 'menu':
      return '/';
    case 'saves':
      return '/saves';
    case 'quick-new':
      return `/quick/new/${r.league}/${r.region}`;
    case 'quick':
      return `/quick/${r.slot}/${r.step}`;
    case 'friendly':
      return `/friendly/${r.step}`;
    case 'career-new':
      return '/career/new';
    case 'career': {
      const v = r.view;
      const tail = v.kind === 'player' || v.kind === 'competition' || v.kind === 'club' ? `${v.kind}/${encodeURIComponent(v.id)}` : v.kind;
      return `/career/${r.slot}/${tail}`;
    }
  }
}

export function fromPath(path: string): Route {
  const p = path.replace(/^#/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const slot = (x: string | undefined) => (x !== undefined && /^\d+$/.test(x) ? Number(x) : null);
  if (p[0] === 'saves') return { s: 'saves' };
  if (p[0] === 'quick' && p[1] === 'new' && LEAGUE_IDS.includes(p[2] as LeagueId)) return { s: 'quick-new', league: p[2] as LeagueId, region: p[3] === 'europe' ? 'europe' : 'america' };
  if (p[0] === 'quick' && slot(p[1]) !== null) {
    const step = (['hub', 'prep', 'match', 'result'] as const).find((x) => x === p[2]) ?? 'hub';
    return { s: 'quick', slot: slot(p[1])!, step };
  }
  if (p[0] === 'friendly') return { s: 'friendly', step: (['prep', 'match', 'result'] as const).find((x) => x === p[1]) ?? 'prep' };
  if (p[0] === 'career' && p[1] === 'new') return { s: 'career-new' };
  if (p[0] === 'career' && slot(p[1]) !== null) {
    const kind = p[2];
    const id = p[3];
    const view: CareerView =
      kind === 'player' && id ? { kind, id } : kind === 'competition' && id ? { kind, id } : kind === 'club' && id ? { kind, id } : kind === 'competitions' ? { kind } : { kind: 'squad' };
    return { s: 'career', slot: slot(p[1])!, view };
  }
  return { s: 'menu' };
}

interface Entry {
  /** How many screens of this game are before this one in the tab's history (0: none, Back greyed). */
  idx: number;
  path: string;
}

/** Asked before a screen with something to lose is left; resolves true to go. */
export type Guard = () => Promise<boolean>;

export interface Nav {
  route: Route;
  /** Open another screen (a new history entry); `replace`: instead of this one. */
  go: (r: Route, opts?: { replace?: boolean }) => void;
  /** The previous screen (like the browser's back). */
  back: () => void;
  canBack: boolean;
  /** The main menu. */
  menu: () => void;
  /** A screen with something to lose sets this while it is open (null to clear). */
  setGuard: (g: Guard | null) => void;
  /** A one-off message for the next screen ("Your career is saved"). */
  flash: string | null;
  setFlash: (s: string | null) => void;
}

const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useNav outside NavProvider');
  return n;
}

function currentEntry(): Entry {
  const st = history.state as Partial<Entry> | null;
  const path = window.location.hash.replace(/^#/, '') || '/';
  return { idx: typeof st?.idx === 'number' ? st.idx : 0, path };
}

export function NavProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<Entry>(() => {
    const e = currentEntry();
    history.replaceState({ idx: e.idx, path: e.path }, '', `#${e.path}`);
    return e;
  });
  const [flash, setFlash] = useState<string | null>(null);
  const guard = useRef<Guard | null>(null);
  // Set while the history is put back after a refused leave, so that pop is ignored.
  const restoring = useRef(false);
  const latest = useRef(entry);
  latest.current = entry;

  useEffect(() => {
    const onPop = () => {
      const next = currentEntry();
      if (restoring.current) {
        restoring.current = false;
        return;
      }
      const g = guard.current;
      if (g) {
        // Undo the move at once (the screen stays), then ask; go only if confirmed.
        const steps = latest.current.idx - next.idx;
        restoring.current = true;
        history.go(steps);
        void g().then((ok) => {
          if (!ok) return;
          guard.current = null;
          history.go(-steps);
        });
        return;
      }
      setEntry(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const leaveThen = useCallback(async (f: () => void) => {
    const g = guard.current;
    if (g && !(await g())) return;
    guard.current = null;
    f();
  }, []);

  const go = useCallback(
    (r: Route, opts?: { replace?: boolean }) =>
      void leaveThen(() => {
        const path = toPath(r);
        const cur = latest.current;
        if (path === cur.path) return;
        const e: Entry = { idx: opts?.replace ? cur.idx : cur.idx + 1, path };
        if (opts?.replace) history.replaceState(e, '', `#${path}`);
        else history.pushState(e, '', `#${path}`);
        setEntry(e);
      }),
    [leaveThen],
  );
  const back = useCallback(() => {
    if (latest.current.idx <= 0) return;
    // A guarded screen is asked in the pop handler.
    history.back();
  }, []);

  const nav = useMemo<Nav>(
    () => ({
      route: fromPath(entry.path),
      go,
      back,
      canBack: entry.idx > 0,
      menu: () => go({ s: 'menu' }),
      setGuard: (g) => (guard.current = g),
      flash,
      setFlash,
    }),
    [entry, go, back, flash],
  );

  // Escape goes back, unless a pop-up is open (it closes itself) or you are typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (document.querySelector('.overlay, [role="alertdialog"], [role="dialog"]')) return;
      if (latest.current.idx > 0) history.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}
