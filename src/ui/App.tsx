// Screen flow (GAME_FLOW §6.1b): every screen is a route in the page address (nav.tsx), so Back, the
// browser's back, Escape and a reload all work the same everywhere. Menu → Quick League (choose the
// league and club, then the season: hub, game plan, live match, result); or a friendly (game plan,
// match, result); or a career (new career, then the career screens).
//
// A full-screen sequence (game plan → match → result) replaces its own history entries, so Back or
// Leave from any of them returns to where it started. What can't be rebuilt from the address after a
// reload (a match under way, a result) falls back to the screen before it.

import { useEffect, useRef, useState } from 'react';
import { HARBOR_HAMMERS, SKYLINE_SPARKS } from '../data/teams';
import type { GamePlan, Team } from '../engine/types';
import type { LiveMatch, Speed } from './match/controller';
import { MainMenu, VIEW_3D_KEY, lastSpeed } from './screens/MainMenu';
import { MatchScreen } from './screens/MatchScreen';
import { PrepScreen } from './screens/PrepScreen';
import { ResultScreen } from './screens/ResultScreen';
import { LeagueFlow } from './screens/league/LeagueFlow';
import { LeagueMenu } from './screens/league/LeagueMenu';
import { ClubPicker } from './screens/league/ClubPicker';
import type { QuickLeague } from '../game/league/quickLeague';
import { listSlots } from '../game/league/saves';
import { abbrOf } from './labels';
import { CareerNew } from './screens/career/CareerNew';
import { CareerShell } from './screens/career/CareerShell';
import { careerStore } from './screens/career/store';
import { readWorld } from '../game/world/saves';
import type { World } from '../game/world/types';
import { browserStorage } from './screens/league/storage';
import { NavProvider, useNav, type Route } from './nav';
import { TopBar, type Crumb } from './components/TopBar';

export interface Setup {
  names: [string, string];
  speed: Speed;
  /** How the court is shown in the match: the 2D court or the 3D view. Switchable during the match too. */
  view: '2d' | '3d';
}

/** Quick match: the fixed test squads, renamed for the players. */
function quickTeams(setup: Setup): [Team, Team] {
  return [
    { ...HARBOR_HAMMERS, id: 'home', name: setup.names[0], abbr: abbrOf(setup.names[0]) },
    { ...SKYLINE_SPARKS, id: 'away', name: setup.names[1], abbr: abbrOf(setup.names[1]) },
  ];
}

/** A friendly's setup when the page was reloaded on it: the usual teams, the last speed and view. */
function defaultSetup(): Setup {
  let view: Setup['view'] = '2d';
  try {
    view = localStorage.getItem(VIEW_3D_KEY) === '1' ? '3d' : '2d';
  } catch {
    /* blocked */
  }
  return { names: ['Harbor Hammers', 'Skyline Sparks'], speed: lastSpeed(), view };
}

interface Friendly {
  setup: Setup;
  teams: [Team, Team];
  plans?: [GamePlan, GamePlan];
  seed?: number;
  match?: LiveMatch;
}

export function App() {
  return (
    <NavProvider>
      <Screens />
    </NavProvider>
  );
}

function Screens() {
  const nav = useNav();
  const r = nav.route;
  // What a route can't carry: the friendly's teams and match, the leagues and worlds already open.
  const friendly = useRef<Friendly | null>(null);
  const leagues = useRef(new Map<number, QuickLeague>());
  const worlds = useRef(new Map<number, World>());
  const [, loaded] = useState(0);

  // A career opened by its address (a reload): read its save.
  const wantWorld = r.s === 'career' && !worlds.current.has(r.slot) ? r.slot : null;
  useEffect(() => {
    if (wantWorld === null) return;
    let live = true;
    void readWorld(careerStore, wantWorld).then((s) => {
      if (!live) return;
      if (s.status === 'ok') {
        worlds.current.set(wantWorld, s.data);
        loaded((n) => n + 1);
      } else {
        nav.setFlash(s.status === 'empty' ? 'That career slot is empty.' : `That career can't be opened: ${s.message}`);
        nav.go({ s: 'menu' }, { replace: true });
      }
    });
    return () => {
      live = false;
    };
  }, [wantWorld, nav]);

  const openLeague = (league: QuickLeague, slot: number, replace = false) => {
    leagues.current.set(slot, league);
    nav.go({ s: 'quick', slot, step: 'hub' }, { replace });
  };
  const openCareer = (world: World, slot: number, replace = false) => {
    worlds.current.set(slot, world);
    nav.go({ s: 'career', slot, view: { kind: 'squad' } }, { replace });
  };
  // Leaving a full-screen moment: to the screen before it, or (opened by its address) its start.
  const leaveTo = (home: Route) => () => (nav.canBack ? nav.back() : nav.go(home, { replace: true }));

  switch (r.s) {
    case 'menu':
      return (
        <div className="app">
          <MainMenu
            onFriendly={(setup) => {
              friendly.current = { setup, teams: quickTeams(setup) };
              nav.go({ s: 'friendly', step: 'prep' });
            }}
            onLeague={(league) => nav.go({ s: 'quick-new', league })}
            onLoad={() => nav.go({ s: 'saves' })}
            onContinue={(league, slot) => openLeague(league, slot)}
            onCareerNew={() => nav.go({ s: 'career-new' })}
            onCareerOpen={(world, slot) => openCareer(world, slot)}
          />
        </div>
      );
    case 'saves':
      return (
        <div className="app">
          <LeagueMenu onOpen={(league, slot) => openLeague(league, slot)} onNew={() => nav.menu()} />
        </div>
      );
    case 'quick-new':
      return (
        <div className="app">
          <ClubPicker key={r.league} league={r.league} onStart={(league, slot) => openLeague(league, slot, true)} />
        </div>
      );
    case 'quick': {
      let league = leagues.current.get(r.slot);
      if (!league) {
        const saved = listSlots(browserStorage)[r.slot];
        if (saved?.status === 'ok') {
          league = saved.data;
          leagues.current.set(r.slot, league);
        }
      }
      if (!league) return <Redirect to={{ s: 'menu' }} flash="That Quick League save can't be found." />;
      return (
        <div className="app">
          <LeagueFlow key={r.slot} initial={league} slot={r.slot} step={r.step} onSaved={(q) => leagues.current.set(r.slot, q)} />
        </div>
      );
    }
    case 'friendly': {
      const f = (friendly.current ??= { setup: defaultSetup(), teams: quickTeams(defaultSetup()) });
      // The game plan is the friendly's first screen: the path starts there.
      const crumbs = (here: string): Crumb[] => (r.step === 'prep' ? [{ label: `Friendly match: ${here}`, route: r }] : [{ label: 'Friendly match', route: { s: 'friendly', step: 'prep' } }, { label: here, route: r }]);
      const leave = leaveTo({ s: 'menu' });
      if (r.step === 'match' && !(f.plans && f.seed !== undefined)) return <Redirect to={{ s: 'friendly', step: 'prep' }} />;
      if (r.step === 'result' && !f.match) return <Redirect to={{ s: 'friendly', step: 'prep' }} />;
      if (r.step === 'prep')
        return (
          <div className="app">
            <PrepScreen
              teams={f.teams}
              crumbs={crumbs('Game plan')}
              onLeave={leave}
              onReady={(plans) => {
                f.plans = plans;
                f.seed = Date.now() >>> 0;
                f.match = undefined;
                nav.go({ s: 'friendly', step: 'match' }, { replace: true });
              }}
            />
          </div>
        );
      if (r.step === 'match')
        return (
          <div className="app">
            <MatchScreen
              key={f.seed}
              setup={f.setup}
              teams={f.teams}
              plans={f.plans!}
              seed={f.seed!}
              crumbs={crumbs(`${f.teams[0].name} v ${f.teams[1].name}`)}
              onLeave={leave}
              onFinish={(match) => {
                f.match = match;
                nav.go({ s: 'friendly', step: 'result' }, { replace: true });
              }}
            />
          </div>
        );
      return (
        <div className="app">
          <ResultScreen match={f.match!} crumbs={crumbs('Result')} onLeave={leave} onRematch={() => nav.go({ s: 'friendly', step: 'prep' }, { replace: true })} />
        </div>
      );
    }
    case 'career-new':
      return (
        <div className="app">
          <CareerNew onStart={(world, slot) => openCareer(world, slot, true)} />
        </div>
      );
    case 'career': {
      const world = worlds.current.get(r.slot);
      if (!world)
        return (
          <div className="cr-wait">
            <TopBar crumbs={[{ label: 'Career', route: r }]} />
            <h1>Opening your career…</h1>
          </div>
        );
      return (
        <div className="app">
          <CareerShell key={r.slot} world={world} slot={r.slot} view={r.view} />
        </div>
      );
    }
  }
}

/** Goes elsewhere at once (instead of this screen in the history), with an optional message. */
function Redirect({ to, flash }: { to: Route; flash?: string }) {
  const nav = useNav();
  useEffect(() => {
    if (flash) nav.setFlash(flash);
    nav.go(to, { replace: true });
    // Once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
