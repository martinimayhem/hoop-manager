// The career shell (GAME_FLOW §6.1, §6.1b; slice brief W1 §6): the top bar shared by every screen (Back,
// the main menu, the path to this screen; here also your club and its money) and a sidebar with only the
// sections that work. Which screen is open comes from the page address (nav.tsx), so the browser's back,
// Escape and a reload all work. Continue appears when the season does (slice W2).

import { Shield, Trophy, Users, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { clubById, competitionById, competitionsOf, leagueOf, moneySummary, positionIn } from '../../../game/world/query';
import { writeWorld } from '../../../game/world/saves';
import type { World } from '../../../game/world/types';
import { TopBar, type Crumb } from '../../components/TopBar';
import { useNav, type Route } from '../../nav';
import { Badge, moneyLine } from './parts';
import { ClubPage, CompetitionsScreen, CompetitionTable, PlayerPage, SquadScreen, type Nav, type View } from './screens';
import { careerStore } from './store';
import './career.css';
type Item = 'squad' | 'competitions' | 'club';

/** Lucide icons (GAME_FLOW §6.1a: one SVG icon set). Only sections that work are shown (§6.1b). */
const ITEMS: { id: Item; label: string; icon: LucideIcon }[] = [
  { id: 'squad', label: 'Squad', icon: Users },
  { id: 'competitions', label: 'Competitions', icon: Trophy },
  { id: 'club', label: 'Club', icon: Shield },
];

/** Which sidebar section a screen belongs to. */
function itemOf(w: World, v: View): Item {
  if (v.kind === 'squad') return 'squad';
  if (v.kind === 'club' && v.id === w.human?.club) return 'club';
  if (v.kind === 'player') return w.players[v.id]?.club === w.human?.club ? 'squad' : 'competitions';
  return 'competitions';
}

/** The path to a screen, every part leading to its own screen. */
function crumbsOf(w: World, slot: number, v: View): Crumb[] {
  const at = (view: View): Route => ({ s: 'career', slot, view });
  const comps: Crumb = { label: 'Competitions', route: at({ kind: 'competitions' }) };
  const clubTrail = (clubId: string): Crumb[] => {
    const club = clubById(w, clubId);
    if (!club) return [comps];
    if (clubId === w.human?.club) return [{ label: 'Squad', route: at({ kind: 'squad' }) }];
    const league = leagueOf(w, clubId);
    return [comps, { label: league.name, route: at({ kind: 'competition', id: league.id }) }, { label: club.name, route: at({ kind: 'club', id: clubId }) }];
  };
  switch (v.kind) {
    case 'squad':
      return [{ label: 'Squad', route: at(v) }];
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
  }
}

export function CareerShell({ world, slot, view }: { world: World; slot: number; view: View }) {
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
  const open = (item: Item) => app.go({ s: 'career', slot, view: item === 'squad' ? { kind: 'squad' } : item === 'competitions' ? { kind: 'competitions' } : { kind: 'club', id: mine.id } });
  // Leaving a career saves it first, and says so (GAME_FLOW §6.1b).
  const toMenu = async () => {
    const ok = await writeWorld(careerStore, slot, world);
    app.setFlash(ok ? `Your career is saved (career slot ${slot + 1}).` : `Your career could not be saved just now; it was last saved in career slot ${slot + 1}.`);
    app.menu();
  };

  const comps = competitionsOf(world, mine.id);
  const m = moneyLine(moneySummary(world, mine));
  const active = itemOf(world, view);

  return (
    <div className="cr">
      <TopBar
        crumbs={crumbsOf(world, slot, view)}
        onMenu={() => void toMenu()}
        right={
          <>
            <div className="cr-top-club">
              <Badge club={mine} size={34} />
              <div>
                <span className="cr-top-name">{mine.name}</span>
                <span className="cr-top-comps">{comps.map((c) => `${c.name} ${positionIn(world, c, mine.id)}`).join(' · ')}</span>
              </div>
            </div>
            <div className="cr-top-money">
              <span className="cr-label">{m.label}</span>
              <span className={`cr-big ${m.warn ? 'warn' : ''}`}>{m.value}</span>
            </div>
          </>
        }
      />

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
          {view.kind === 'squad' && <SquadScreen w={world} club={mine} nav={nav} />}
          {view.kind === 'player' && <PlayerPage key={view.id} w={world} id={view.id} nav={nav} />}
          {view.kind === 'competitions' && <CompetitionsScreen w={world} nav={nav} />}
          {view.kind === 'competition' && <CompetitionTable key={view.id} w={world} id={view.id} nav={nav} />}
          {view.kind === 'club' && <ClubPage key={view.id} w={world} id={view.id} nav={nav} />}
        </main>
      </div>
    </div>
  );
}