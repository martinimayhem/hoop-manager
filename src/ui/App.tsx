// Screen flow: menu → draft → game plan → live match → result (→ rematch).

import { useState } from 'react';
import { HARBOR_HAMMERS, SKYLINE_SPARKS } from '../data/teams';
import type { GamePlan, Team } from '../engine/types';
import type { LiveMatch, Speed } from './match/controller';
import { DraftScreen } from './screens/DraftScreen';
import { MainMenu } from './screens/MainMenu';
import { MatchScreen } from './screens/MatchScreen';
import { PrepScreen } from './screens/PrepScreen';
import { ResultScreen } from './screens/ResultScreen';
import { abbrOf } from './labels';

export interface Setup {
  mode: 'ai' | 'pvp';
  draft: 'free' | 'snake' | 'quick';
  names: [string, string];
  speed: Speed;
}

type Screen =
  | { kind: 'menu' }
  | { kind: 'draft'; setup: Setup }
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
            onStart={(setup) =>
              setScreen(setup.draft === 'quick' ? { kind: 'prep', setup, teams: quickTeams(setup) } : { kind: 'draft', setup })
            }
          />
        </div>
      );
    case 'draft':
      return (
        <div className="app">
          <DraftScreen setup={screen.setup} onDone={(teams) => setScreen({ kind: 'prep', setup: screen.setup, teams })} />
        </div>
      );
    case 'prep':
      return (
        <div className="app">
          <PrepScreen
            setup={screen.setup}
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
