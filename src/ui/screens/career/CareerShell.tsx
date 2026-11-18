// The career shell (GAME_FLOW §6.1, slice brief W1 §6): a left sidebar (icons only below about 1024 px)
// and a top bar with your club, its competitions and position, the money summary and Continue. In W1
// Continue and the sidebar items with nothing to show yet are disabled: tapping one says "Coming soon"
// (a tooltip alone would be hover-only on a tablet).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clubById, competitionsOf, moneySummary, positionIn } from '../../../game/world/query';
import type { World } from '../../../game/world/types';
import { Badge, moneyLine } from './parts';
import { ClubPage, CompetitionsScreen, CompetitionTable, PlayerPage, SquadScreen, type Nav, type View } from './screens';
import './career.css';

type Item = 'home' | 'squad' | 'tactics' | 'schedule' | 'competitions' | 'transfers' | 'scouting' | 'club' | 'manager';

const ICON: Record<Item, ReactNode> = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  squad: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.2c2.8.3 5 2.6 5 5.8" />
    </>
  ),
  tactics: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9l3 3M11 9l-3 3M15 14a1.6 1.6 0 1 0 0 .1M9 16c2-3 4-5 7-6" />
    </>
  ),
  schedule: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  competitions: <path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6v4H9z" />,
  transfers: <path d="M4 8h14l-3-3M20 16H6l3 3" />,
  scouting: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5.5 5.5" />
    </>
  ),
  club: <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />,
  manager: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </>
  ),
};

const ITEMS: { id: Item; label: string; ready: boolean }[] = [
  { id: 'home', label: 'Home', ready: false },
  { id: 'squad', label: 'Squad', ready: true },
  { id: 'tactics', label: 'Tactics', ready: false },
  { id: 'schedule', label: 'Schedule', ready: false },
  { id: 'competitions', label: 'Competitions', ready: true },
  { id: 'transfers', label: 'Transfers', ready: false },
  { id: 'scouting', label: 'Scouting', ready: false },
  { id: 'club', label: 'Club', ready: true },
  { id: 'manager', label: 'Manager', ready: false },
];

function Icon({ id }: { id: Item }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON[id]}
    </svg>
  );
}

/** Which sidebar item a view belongs to. */
function itemOf(w: World, v: View): Item {
  if (v.kind === 'squad') return 'squad';
  if (v.kind === 'club' && v.id === w.human?.club) return 'club';
  if (v.kind === 'player') return w.players[v.id]?.club === w.human?.club ? 'squad' : 'competitions';
  return 'competitions';
}

export function CareerShell({ world, slot, onMenu }: { world: World; slot: number; onMenu: () => void }) {
  const mine = clubById(world, world.human!.club)!;
  const [stack, setStack] = useState<View[]>([{ kind: 'squad' }]);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const main = useRef<HTMLElement>(null);
  const view = stack[stack.length - 1];

  const say = (msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2200);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A new screen starts at its top.
  // (Braces: newer browsers' scrollTo returns a promise, which React would take for a clean-up.)
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [stack.length, view]);

  const nav: Nav = {
    go: (v) => setStack((s) => [...s, v]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    canBack: stack.length > 1,
  };
  const open = (item: Item) => {
    const it = ITEMS.find((i) => i.id === item)!;
    if (!it.ready) return say(`${it.label}: coming soon`);
    setStack([item === 'squad' ? { kind: 'squad' } : item === 'competitions' ? { kind: 'competitions' } : { kind: 'club', id: mine.id }]);
  };

  const comps = competitionsOf(world, mine.id);
  const m = moneyLine(moneySummary(world, mine));
  const active = itemOf(world, view);

  return (
    <div className="cr">
      <header className="cr-top">
        <div className="cr-top-club">
          <Badge club={mine} />
          <div>
            <span className="cr-top-name">{mine.name}</span>
            <span className="cr-top-comps">{comps.map((c) => `${c.name} ${positionIn(world, c, mine.id)}`).join(' · ')}</span>
          </div>
        </div>
        <div className="cr-top-right">
          <div className="cr-top-money">
            <span className="cr-label">{m.label}</span>
            <span className={`cr-big ${m.warn ? 'warn' : ''}`}>{m.value}</span>
          </div>
          <button className="cr-continue" aria-disabled="true" title="Coming soon: the season starts in the next slice" onClick={() => say('Continue: coming soon. The season starts in the next slice.')}>
            Continue
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </header>

      <div className="cr-body">
        <nav className="cr-side" aria-label="Main">
          {ITEMS.map((it) => (
            <button
              key={it.id}
              className={`cr-nav ${active === it.id ? 'on' : ''} ${it.ready ? '' : 'soon'}`}
              aria-disabled={!it.ready}
              aria-current={active === it.id ? 'page' : undefined}
              title={it.ready ? it.label : `${it.label}: coming soon`}
              onClick={() => open(it.id)}
            >
              <Icon id={it.id} />
              <span className="cr-nav-label">{it.label}</span>
              {!it.ready && <span className="cr-soon">Soon</span>}
            </button>
          ))}
          <div className="cr-side-foot">
            <span className="cr-saved">
              Saved · career slot {slot + 1}
              {world.human?.manager ? ` · ${world.human.manager}` : ''}
            </span>
            <button className="cr-nav" onClick={onMenu} title="Main menu">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
              <span className="cr-nav-label">Main menu</span>
            </button>
          </div>
        </nav>

        <main className="cr-main" ref={main}>
          {view.kind === 'squad' && <SquadScreen w={world} club={mine} nav={nav} />}
          {view.kind === 'player' && <PlayerPage key={view.id} w={world} id={view.id} nav={nav} />}
          {view.kind === 'competitions' && <CompetitionsScreen w={world} nav={nav} />}
          {view.kind === 'competition' && <CompetitionTable key={view.id} w={world} id={view.id} nav={nav} />}
          {view.kind === 'club' && <ClubPage key={view.id} w={world} id={view.id} nav={nav} />}
        </main>
      </div>
      {toast && (
        <div className="cr-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
