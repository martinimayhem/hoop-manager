// The career shell (GAME_FLOW §6.1, §6.1b; slice briefs W1 §6, W2a §4): the top bar shared by every
// screen (Back, the main menu, the path to this screen; here also your club, the date, the money and
// Continue) and a sidebar with only the sections that work: Home, Squad, Tactics, Schedule,
// Competitions, Club. Which screen is open comes from the page address (nav.tsx), so the browser's
// back, Escape and a reload all work.

import { CalendarDays, ClipboardList, FastForward, LayoutDashboard, Shield, Trophy, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { GamePlan } from '../../../engine/types';
import { shortDate } from '../../../game/season/calendar';
import { compName, humanGameToday, isKey, placeIn, playOf, regularOver } from '../../../game/season/play';
import { cupsOf, stillPlaying } from '../../../game/season/post';
import { CupScreen, HistoryScreen } from './postseason';
import { clubById, competitionById, competitionsOf, leagueOf, moneySummary } from '../../../game/world/query';
import type { World } from '../../../game/world/types';
import { TopBar, type Crumb } from '../../components/TopBar';
import { NextIcon } from '../../icons';
import { useNav, type Route } from '../../nav';
import { Badge, moneyLine } from './parts';
import { ClubPage, CompetitionsScreen, CompetitionTable, PlayerPage, SquadScreen, type Nav, type View } from './screens';
import { GameScreen, HomeScreen, ScheduleScreen, TacticsScreen } from './season';
import './career.css';

type Item = 'home' | 'squad' | 'tactics' | 'schedule' | 'competitions' | 'club';

/** Lucide icons (GAME_FLOW §6.1a: one SVG icon set). Only sections that work are shown (§6.1b). */
const ITEMS: { id: Item; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard },
  { id: 'squad', label: 'Squad', icon: Users },
  { id: 'tactics', label: 'Tactics', icon: ClipboardList },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'competitions', label: 'Competitions', icon: Trophy },
  { id: 'club', label: 'Club', icon: Shield },
];

/** Which sidebar section a screen belongs to. */
function itemOf(w: World, v: View): Item {
  switch (v.kind) {
    case 'home':
    case 'squad':
    case 'tactics':
    case 'schedule':
      return v.kind;
    case 'club':
      return v.id === w.human?.club ? 'club' : 'competitions';
    case 'player':
      return w.players[v.id]?.club === w.human?.club ? 'squad' : 'competitions';
    case 'game': {
      const g = w.play?.games[Number(v.id)];
      return g && w.human && (g.home === w.human.club || g.away === w.human.club) ? 'schedule' : 'competitions';
    }
    default:
      return 'competitions';
  }
}

/** The path to a screen, every part leading to its own screen. */
export function crumbsOf(w: World, slot: number, v: View): Crumb[] {
  const at = (view: View): Route => ({ s: 'career', slot, view });
  const comps: Crumb = { label: 'Competitions', route: at({ kind: 'competitions' }) };
  const home: Crumb = { label: 'Home', route: at({ kind: 'home' }) };
  const clubTrail = (clubId: string): Crumb[] => {
    const club = clubById(w, clubId);
    if (!club) return [comps];
    if (clubId === w.human?.club) return [{ label: 'Squad', route: at({ kind: 'squad' }) }];
    const league = leagueOf(w, clubId);
    return [comps, { label: league.name, route: at({ kind: 'competition', id: league.id }) }, { label: club.name, route: at({ kind: 'club', id: clubId }) }];
  };
  switch (v.kind) {
    case 'home':
      return [home];
    case 'squad':
      return [{ label: 'Squad', route: at(v) }];
    case 'tactics':
      return [{ label: 'Tactics', route: at(v) }];
    case 'schedule':
      return [{ label: 'Schedule', route: at(v) }];
    case 'competitions':
      return [comps];
    case 'competition':
      return [comps, { label: competitionById(w, v.id)?.name ?? '?', route: at(v) }];
    case 'club':
      return v.id === w.human?.club ? [{ label: 'Club', route: at(v) }] : clubTrail(v.id);
    case 'player': {
      const wp = w.players[v.id];
      return [...(wp?.club ? clubTrail(wp.club) : [comps]), { label: wp?.p.name ?? '?', route: at(v) }];
    }
    case 'game': {
      const g = w.play?.games[Number(v.id)];
      const label = g ? `${clubById(w, g.home)?.abbr ?? '?'} v ${clubById(w, g.away)?.abbr ?? '?'}` : 'Game';
      const mine = g && w.human && (g.home === w.human.club || g.away === w.human.club);
      return [mine ? { label: 'Schedule', route: at({ kind: 'schedule' }) } : comps, ...(g && !mine ? [{ label: compName(w, g.comp), route: at({ kind: 'competitions' }) }] : []), { label, route: at(v) }];
    }
    case 'prep': {
      // A key game says so in the path (WORLD_SPEC §1.1: marked on match preparation).
      const g = w.play ? humanGameToday(w) : undefined;
      return [home, { label: g && isKey(w, g) ? 'Key game' : 'Game day', route: at(v) }];
    }
    case 'match':
      return [home, { label: 'Match', route: at(v) }];
    case 'result':
      return [home, { label: 'Result', route: at(v) }];
    case 'review':
      return [home, { label: 'Season review', route: at(v) }];
    case 'moment':
      return [home, { label: w.play?.moment?.title ?? 'News', route: at(v) }];
    case 'keymoments':
      return [home, { label: 'Key moments', route: at(v) }];
    case 'cup':
      return [comps, { label: cupsOf(w).find((c) => c.id === v.id)?.name ?? 'Cup', route: at(v) }];
    case 'history':
      return [comps, { label: 'History', route: at(v) }];
  }
}

export interface ShellActions {
  /** Continue (GAME_FLOW §3.3); on your game day it opens match preparation. */
  onContinue: () => void;
  /** Simulate ahead (asks first): to your next key game, the end of the regular season, the end of the season. */
  onSim: (mode: 'toKey' | 'toRegularEnd' | 'toEnd') => void;
  onPlan: (p: GamePlan) => void;
  onPrepare: () => void;
  /** Saves and goes to the main menu. */
  onMenu: () => void;
  /** Days are being played (Continue is busy). */
  busy: boolean;
}

export function CareerShell({ world, slot, view, actions }: { world: World; slot: number; view: View; actions: ShellActions }) {
  const app = useNav();
  const mine = clubById(world, world.human!.club)!;
  // A new screen starts at its top.
  // (Braces: newer browsers' scrollTo returns a promise, which React would take for a clean-up.)
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  const nav: Nav = {
    go: (v) => app.go({ s: 'career', slot, view: v }),
  };
  const open = (item: Item) => app.go({ s: 'career', slot, view: item === 'club' ? { kind: 'club', id: mine.id } : { kind: item } });

  const comps = competitionsOf(world, mine.id);
  const m = moneyLine(moneySummary(world, mine));
  const active = itemOf(world, view);
  const p = playOf(world);
  const today = humanGameToday(world);
  // Continue only while it does something (GAME_FLOW §6.1b): hidden once the regular season is over.
  const canContinue = p.phase !== 'review';
  const [ahead, setAhead] = useState(false);
  const playing = stillPlaying(world, p.games, p.ties, p.made);
  const choices: { mode: 'toKey' | 'toRegularEnd' | 'toEnd'; label: string; note: string }[] = [
    ...(playing ? [{ mode: 'toKey' as const, label: 'To your next key game', note: 'Your games are simulated until a key game: a playoff, a cup tie from the quarter-finals, a season decider.' }] : []),
    ...(!regularOver(world) ? [{ mode: 'toRegularEnd' as const, label: 'To the end of the regular season', note: 'Every game until the last regular-season game, yours too.' }] : []),
    ...(!playing ? [{ mode: 'toEnd' as const, label: 'To the end of the season', note: 'Your season is over: the rest of the world plays to the season review.' }] : []),
  ];

  return (
    <div className="cr">
      <TopBar
        crumbs={crumbsOf(world, slot, view)}
        onMenu={actions.onMenu}
        right={
          <>
            <div className="cr-top-club">
              <Badge club={mine} size={34} />
              <div>
                <span className="cr-top-name">{mine.name}</span>
                <span className="cr-top-comps">{comps.map((c) => `${c.name} ${placeIn(world, c.id, mine.id)}`).join(' · ')}</span>
              </div>
            </div>
            <div className="cr-top-money">
              <span className="cr-label">{m.label}</span>
              <span className={`cr-big ${m.warn ? 'warn' : ''}`}>{m.value}</span>
            </div>
            <div className="cr-top-date">
              <span className="cr-label">{p.phase === 'before' ? 'Preseason' : 'Today'}</span>
              <span className="cr-date">{p.phase === 'before' ? shortDate(world.season, 0).replace(/^\w+ /, 'to ') : shortDate(world.season, p.day)}</span>
            </div>
            {canContinue && (
              <>
                <button className="cr-sim-end" onClick={() => setAhead(true)} disabled={actions.busy} title="Simulate ahead" aria-label="Simulate ahead" aria-haspopup="dialog">
                  <FastForward size={18} aria-hidden="true" />
                  <span className="cr-sim-end-label">Simulate ahead</span>
                </button>
                <button className="primary cr-continue-top" onClick={actions.onContinue} disabled={actions.busy}>
                  {today ? 'Game day' : 'Continue'} <NextIcon />
                </button>
              </>
            )}
          </>
        }
      />

      {ahead && (
        <div className="overlay slot-picker" onClick={(e) => e.target === e.currentTarget && setAhead(false)}>
          <div className="panel slot-picker-box" role="dialog" aria-label="Simulate ahead">
            <div className="slot-picker-head">
              <h3>Simulate ahead</h3>
              <button className="brk-close" onClick={() => setAhead(false)} aria-label="Close" title="Close">
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="slot-picker-list">
              {choices.map((c) => (
                <button
                  key={c.mode}
                  className="mm-career-slot"
                  onClick={() => {
                    setAhead(false);
                    actions.onSim(c.mode);
                  }}
                >
                  <span>
                    <b>{c.label}</b>
                    <small className="muted">{c.note}</small>
                  </span>
                  <span className="mm-go">
                    Go <NextIcon />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="cr-body">
        <nav className="cr-side" aria-label="Sections">
          {ITEMS.map((it) => (
            <button key={it.id} className={`cr-nav ${active === it.id ? 'on' : ''}`} aria-current={active === it.id ? 'page' : undefined} title={it.label} onClick={() => open(it.id)}>
              <it.icon size={22} strokeWidth={1.9} aria-hidden="true" />
              <span className="cr-nav-label">{it.label}</span>
            </button>
          ))}
        </nav>

        <main className="cr-main">
          {view.kind === 'home' && <HomeScreen w={world} nav={nav} onPrepare={actions.onPrepare} />}
          {view.kind === 'squad' && <SquadScreen w={world} club={mine} nav={nav} />}
          {view.kind === 'tactics' && <TacticsScreen w={world} onPlan={actions.onPlan} />}
          {view.kind === 'schedule' && <ScheduleScreen w={world} nav={nav} />}
          {view.kind === 'player' && <PlayerPage key={view.id} w={world} id={view.id} nav={nav} />}
          {view.kind === 'competitions' && <CompetitionsScreen w={world} nav={nav} />}
          {view.kind === 'competition' && <CompetitionTable key={view.id} w={world} id={view.id} nav={nav} />}
          {view.kind === 'club' && <ClubPage key={view.id} w={world} id={view.id} nav={nav} />}
          {view.kind === 'game' && <GameScreen key={view.id} w={world} id={view.id} nav={nav} />}
          {view.kind === 'cup' && <CupScreen key={view.id} w={world} id={view.id} nav={nav} />}
          {view.kind === 'history' && <HistoryScreen w={world} nav={nav} />}
        </main>
      </div>
    </div>
  );
}
