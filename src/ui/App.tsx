// Screen flow: menu → choose the league → choose the club → the season (hub, game plan, live match,
// result); or a friendly: menu → game plan → live match → result (→ rematch).

import { useState } from 'react';
import { HARBOR_HAMMERS, SKYLINE_SPARKS } from '../data/teams';
import type { GamePlan, Team } from '../engine/types';
import type { LiveMatch, Speed } from './match/controller';
import { MainMenu } from './screens/MainMenu';
import { MatchScreen } from './screens/MatchScreen';
import { PrepScreen } from './screens/PrepScreen';
import { ResultScreen } from './screens/ResultScreen';
import { LeagueFlow } from './screens/league/LeagueFlow';
import { LeagueMenu } from './screens/league/LeagueMenu';
import { ClubPicker } from './screens/league/ClubPicker';
import type { QuickLeague } from '../game/league/quickLeague';
import type { LeagueId } from '../game/league/leagues';
import { abbrOf } from './labels';

export interface Setup {
  names: [string, string];
  speed: Speed;
  /** How the court is shown in the match: the 2D court or the 3D view. Switchable during the match too. */
  view: '2d' | '3d';
}

type Screen =
  | { kind: 'menu' }
  | { kind: 'league-menu' }
  | { kind: 'club'; league: LeagueId }
  | { kind: 'league'; league: QuickLeague; slot: number; key: number }
  | { kind: 'prep'; setup: Setup; teams: [Team, Team] }
  | { kind: 'match'; setup: Setup; teams: [Team, Team]; plans: [GamePlan, GamePlan]; seed: number }
  | { kind: 'result'; setup: Setup; teams: [Team, Team]; match: LiveMatch };

/** Quick match: the fixed test squads, renamed for the players. */
function quickTeams(setup: Setup): [Team, Team] {
  return [
    { ...HARBOR_HAMMERS, id: 'home', name: setup.names[0], abbr: abbrOf(setup.names[0]) },
    { ...SKYLINE_SPARKS, id: 'away', name: setup.names[1], abbr: abbrOf(setup.names[1]) },
  ];
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' });
  const menu = () => setScreen({ kind: 'menu' });

  switch (screen.kind) {
    case 'menu':
      return (
        <div className="app">
          <MainMenu
            onFriendly={(setup) => setScreen({ kind: 'prep', setup, teams: quickTeams(setup) })}
            onLeague={(league) => setScreen({ kind: 'club', league })}
            onLoad={() => setScreen({ kind: 'league-menu' })}
            onContinue={(league, slot) => setScreen({ kind: 'league', league, slot, key: Date.now() })}
          />
        </div>
      );
    case 'club':
      return (
        <div className="app">
          <ClubPicker league={screen.league} onBack={menu} onStart={(league, slot) => setScreen({ kind: 'league', league, slot, key: Date.now() })} />
        </div>
      );
    case 'league-menu':
      return (
        <div className="app">
          <LeagueMenu onBack={menu} onOpen={(league, slot) => setScreen({ kind: 'league', league, slot, key: Date.now() })} />
        </div>
      );
    case 'league':
      return (
        <div className="app">
          <LeagueFlow key={screen.key} initial={screen.league} slot={screen.slot} onMenu={menu} onNewLeague={menu} />
        </div>
      );
    case 'prep':
      return (
        <div className="app">
          <PrepScreen
            teams={screen.teams}
            onMenu={menu}
            onReady={(plans) => setScreen({ kind: 'match', setup: screen.setup, teams: screen.teams, plans, seed: Date.now() >>> 0 })}
          />
        </div>
      );
    case 'match':
      return (
        <div className="app">
          <MatchScreen
            setup={screen.setup}
            teams={screen.teams}
            plans={screen.plans}
            seed={screen.seed}
            onFinish={(match) => setScreen({ kind: 'result', setup: screen.setup, teams: screen.teams, match })}
          />
        </div>
      );
    case 'result':
      return (
        <div className="app">
          <ResultScreen match={screen.match} onMenu={menu} onRematch={() => setScreen({ kind: 'prep', setup: screen.setup, teams: screen.teams })} />
        </div>
      );
  }
}
