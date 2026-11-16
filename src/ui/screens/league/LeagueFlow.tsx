// A Quick League from the draft to the end of the season: the hub between matchdays, and a matchday's
// human games played live through the usual prep, match and result screens. When the humans meet it
// is one hot-seat match; otherwise Player 1 plays, then Player 2. The rest of the matchday is then
// simulated and the league saved (SEASON_SPEC R2.4, R11.2). Closing mid-match loses only that
// matchday's progress: the save is from its start.

import { useState } from 'react';
import type { GamePlan, Team } from '../../../engine/types';
import { leaguePool } from '../../../game/league/leagues';
import { SCOUT_MIN_HALF, completeMatchday, gameSeed, humanGames, recordFrom, scoutAccuracy, teamOf, type QuickLeague } from '../../../game/league/quickLeague';
import { writeSlot } from '../../../game/league/saves';
import type { GameRecord } from '../../../game/league/standings';
import type { Fixture } from '../../../game/league/schedule';
import type { Setup } from '../../App';
import type { LiveMatch, Speed } from '../../match/controller';
import type { ScoutView } from '../../components/ScoutingReport';
import { MatchScreen } from '../MatchScreen';
import { PrepScreen } from '../PrepScreen';
import { ResultScreen } from '../ResultScreen';
import { VIEW_3D_KEY } from '../MainMenu';
import { LeagueDraft } from './LeagueDraft';
import { LeagueHub } from './LeagueHub';
import { browserStorage } from './storage';

interface Game {
  game: number;
  fixture: Fixture;
  /** The team index on each side of the live match (a human on side 0). */
  sides: [number, number];
  pvp: boolean;
}

type Step =
  | { kind: 'hub' }
  | { kind: 'prep'; games: Game[]; at: number; played: Record<number, GameRecord> }
  | { kind: 'match'; games: Game[]; at: number; played: Record<number, GameRecord>; plans: [GamePlan, GamePlan] }
  | { kind: 'result'; games: Game[]; at: number; played: Record<number, GameRecord>; match: LiveMatch };

function lastView(): Setup['view'] {
  try {
    return localStorage.getItem(VIEW_3D_KEY) === '1' ? '3d' : '2d';
  } catch {
    return '2d';
  }
}

/** This matchday's human games, Player 1's first; a meeting of the two humans is one game. */
function gamesOf(q: QuickLeague): Game[] {
  return humanGames(q)
    .map(({ game, fixture }) => {
      const h = q.teams[fixture.home].human;
      const a = q.teams[fixture.away].human;
      const pvp = h !== null && a !== null;
      const homeFirst = pvp ? h! <= a! : h !== null;
      return { game, fixture, pvp, sides: (homeFirst ? [fixture.home, fixture.away] : [fixture.away, fixture.home]) as [number, number] };
    })
    // A human is on side 0 of each: Player 1's game first.
    .sort((x, y) => q.teams[x.sides[0]].human! - q.teams[y.sides[0]].human!);
}

export function LeagueFlow({ initial, slot, onMenu, onNewLeague }: { initial: QuickLeague; slot: number; onMenu: () => void; onNewLeague: () => void }) {
  const [league, setLeagueState] = useState(initial);
  const [step, setStep] = useState<Step>({ kind: 'hub' });
  const [speed, setSpeed] = useState<Speed>('normal');
  const [saveFailed, setSaveFailed] = useState(false);

  /** Every change of league state is saved at once (after a pick, after a matchday). */
  const setLeague = (q: QuickLeague) => {
    setLeagueState(q);
    setSaveFailed(!writeSlot(browserStorage, slot, q));
  };
  const banner = saveFailed ? <div className="panel" style={{ borderColor: 'var(--away)' }}>⚠ The browser would not save this league (storage full or blocked). Progress may be lost when you close the page.</div> : null;

  if (league.phase === 'draft') {
    return (
      <>
        {banner}
        <LeagueDraft league={league} onChange={setLeague} onMenu={onMenu} />
      </>
    );
  }

  const teamsOf = (g: Game): [Team, Team] => [teamOf(league, g.sides[0]), teamOf(league, g.sides[1])];
  const setupOf = (g: Game): Setup => ({
    mode: g.pvp ? 'pvp' : 'ai',
    draft: 'snake',
    names: [league.teams[g.sides[0]].name, league.teams[g.sides[1]].name],
    speed,
    view: lastView(),
  });
  const hypes = new Map(leaguePool(league.league).map((p) => [p.player.id, p.hype]));
  const scoutOf = (g: Game): [ScoutView, ScoutView] => [
    { accuracy: scoutAccuracy(league, g.sides[0], g.sides[1]), minHalf: SCOUT_MIN_HALF, hypes },
    { accuracy: scoutAccuracy(league, g.sides[1], g.sides[0]), minHalf: SCOUT_MIN_HALF, hypes },
  ];
  const finish = (played: Record<number, GameRecord>) => {
    setLeague(completeMatchday(league, played));
    setStep({ kind: 'hub' });
  };

  switch (step.kind) {
    case 'hub':
      return (
        <>
          {banner}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <span className="muted small">Match speed</span>
            <button className={speed === 'normal' ? 'active small' : 'small'} onClick={() => setSpeed('normal')}>
              Normal
            </button>
            <button className={speed === 'fast' ? 'active small' : 'small'} onClick={() => setSpeed('fast')}>
              Fast
            </button>
          </div>
          <LeagueHub
            league={league}
            onMenu={onMenu}
            onNewLeague={onNewLeague}
            onPlay={() => {
              const games = gamesOf(league);
              if (games.length === 0) finish({});
              else setStep({ kind: 'prep', games, at: 0, played: {} });
            }}
            onSimMine={() => finish({})}
            onSimSeason={() => {
              if (!window.confirm('The computer plays every remaining match, yours included. Results stand. Go ahead?')) return;
              let q = league;
              while (q.phase === 'season') q = completeMatchday(q);
              setLeague(q);
            }}
          />
        </>
      );
    case 'prep': {
      const g = step.games[step.at];
      return (
        <PrepScreen
          key={`${league.matchday}-${step.at}`}
          setup={setupOf(g)}
          teams={teamsOf(g)}
          scout={scoutOf(g)}
          onMenu={() => setStep({ kind: 'hub' })}
          onReady={(plans) => setStep({ ...step, kind: 'match', plans })}
        />
      );
    }
    case 'match': {
      const g = step.games[step.at];
      return (
        <MatchScreen
          setup={setupOf(g)}
          teams={teamsOf(g)}
          plans={step.plans}
          seed={gameSeed(league, league.matchday, g.game)}
          onFinish={(match) => setStep({ kind: 'result', games: step.games, at: step.at, played: step.played, match })}
        />
      );
    }
    case 'result': {
      const g = step.games[step.at];
      const onContinue = () => {
        const record = recordFrom(league.matchday, g.fixture, gameSeed(league, league.matchday, g.game), step.match.s, g.sides);
        const played = { ...step.played, [g.game]: record };
        if (step.at + 1 < step.games.length) setStep({ kind: 'prep', games: step.games, at: step.at + 1, played });
        else finish(played);
      };
      return <ResultScreen match={step.match} onMenu={onMenu} onContinue={onContinue} />;
    }
  }
}
