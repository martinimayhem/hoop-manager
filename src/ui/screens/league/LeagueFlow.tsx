// A Quick League season: the hub between matchdays, and the player's
// game each matchday played live through the usual prep, match and result screens. The rest of the
// matchday is then simulated and the league saved (SEASON_SPEC R2.4, R11.2). Closing mid-match loses only that
// matchday's progress: the save is from its start.

import { useEffect, useState } from 'react';
import type { GamePlan, Team } from '../../../engine/types';
import { leaguePool } from '../../../game/league/leagues';
import { MATCHDAYS, SCOUT_MIN_HALF, completeMatchday, finishDraft, gameSeed, humanGames, recordFrom, scoutAccuracy, teamOf, type QuickLeague } from '../../../game/league/quickLeague';
import { writeSlot } from '../../../game/league/saves';
import type { GameRecord } from '../../../game/league/standings';
import type { Fixture } from '../../../game/league/schedule';
import type { Setup } from '../../App';
import type { LiveMatch, Speed } from '../../match/controller';
import type { ScoutView } from '../../components/ScoutingReport';
import { MatchScreen } from '../MatchScreen';
import { useConfirm } from '../../components/Confirm';
import { PrepScreen } from '../PrepScreen';
import { ResultScreen } from '../ResultScreen';
import { VIEW_3D_KEY, lastSpeed } from '../MainMenu';
import { LeagueHub } from './LeagueHub';
import { browserStorage } from './storage';
import { WarningIcon } from '../../icons';

interface Game {
  game: number;
  fixture: Fixture;
  /** The team index on each side of the live match (the player on side 0). */
  sides: [number, number];
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

/** This matchday's game for the player: his team on side 0 of the live match. */
function gamesOf(q: QuickLeague): Game[] {
  return humanGames(q).map(({ game, fixture }) => ({
    game,
    fixture,
    sides: (q.teams[fixture.home].human !== null ? [fixture.home, fixture.away] : [fixture.away, fixture.home]) as [number, number],
  }));
}

export function LeagueFlow({ initial, slot, onMenu, onNewLeague }: { initial: QuickLeague; slot: number; onMenu: () => void; onNewLeague: () => void }) {
  // An old save stopped mid-draft: the computer makes the rest of the picks, the player's club's too.
  const [league, setLeagueState] = useState(() => (initial.phase === 'draft' ? finishDraft(initial) : initial));
  const [step, setStep] = useState<Step>({ kind: 'hub' });
  const [speed, setSpeed] = useState<Speed>(lastSpeed);
  const [saveFailed, setSaveFailed] = useState(false);
  const confirm = useConfirm();

  /** Every change of league state is saved at once (after a pick, after a matchday). */
  const setLeague = (q: QuickLeague) => {
    setLeagueState(q);
    setSaveFailed(!writeSlot(browserStorage, slot, q));
  };
  const banner = saveFailed ? <div className="panel" style={{ borderColor: 'var(--away)' }}>
      <WarningIcon /> The browser would not save this league (storage full or blocked). Progress may be lost when you close the page.</div> : null;
  // Saved as soon as it opens: a new game (or a finished draft) is there to continue at once.
  useEffect(() => {
    setSaveFailed(!writeSlot(browserStorage, slot, league));
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teamsOf = (g: Game): [Team, Team] => [teamOf(league, g.sides[0]), teamOf(league, g.sides[1])];
  const setupOf = (g: Game): Setup => ({
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
          <LeagueHub
            league={league}
            speed={speed}
            onSpeed={setSpeed}
            onMenu={onMenu}
            onNewLeague={onNewLeague}
            onPlay={() => {
              const games = gamesOf(league);
              if (games.length === 0) finish({});
              else setStep({ kind: 'prep', games, at: 0, played: {} });
            }}
            onSimMine={() => finish({})}
            onSimSeason={() =>
              confirm.ask(
                {
                  title: 'Sim to the end of the season?',
                  body: `The computer plays all ${MATCHDAYS - league.matchday} remaining matchdays, your matches included, with the plans it would choose. The results stand.`,
                  confirm: 'Sim the season',
                  cancel: 'Keep playing',
                },
                () => {
                  let q = league;
                  while (q.phase === 'season') q = completeMatchday(q);
                  setLeague(q);
                },
              )
            }
          />
          {confirm.dialog}
        </>
      );
    case 'prep': {
      const g = step.games[step.at];
      return (
        <PrepScreen
          key={`${league.matchday}-${step.at}`}
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
