// The career shell (GAME_FLOW §6.1, slice brief W1 §6): a left sidebar (icons only below about 1024 px)
// and a top bar with your club, its competitions and position, the money summary and Continue. In W1
// Continue and the sidebar items with nothing to show yet are disabled: tapping one says "Coming soon"
// (a tooltip alone would be hover-only on a tablet).

import { ArrowLeftRight, ArrowRight, CalendarDays, ChevronLeft, ClipboardList, House, Search, Shield, Trophy, UserRound, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clubById, competitionsOf, moneySummary, positionIn } from '../../../game/world/query';
import type { World } from '../../../game/world/types';
import { Badge, moneyLine } from './parts';
import { ClubPage, CompetitionsScreen, CompetitionTable, PlayerPage, SquadScreen, type Nav, type View } from './screens';
import './career.css';

type Item = 'home' | 'squad' | 'tactics' | 'schedule' | 'competitions' | 'transfers' | 'scouting' | 'club' | 'manager';

/** Lucide icons (GAME_FLOW §6.1a: one SVG icon set). */
const ICON: Record<Item, LucideIcon> = {
  home: House,
  squad: Users,
  tactics: ClipboardList,
  schedule: CalendarDays,
  competitions: Trophy,
  transfers: ArrowLeftRight,
  scouting: Search,
  club: Shield,
  manager: UserRound,
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
  const C = ICON[id];
  return <C size={22} strokeWidth={1.9} aria-hidden="true" />;
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
            <ArrowRight size={18} strokeWidth={2.5} aria-hidden="true" />
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
              <ChevronLeft size={22} strokeWidth={1.9} aria-hidden="true" />
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
