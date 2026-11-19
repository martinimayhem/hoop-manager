// A Quick League season: the hub between matchdays, and the player's
// game each matchday played live through the usual prep, match and result screens. The rest of the
// matchday is then simulated and the league saved (SEASON_SPEC R2.4, R11.2). Closing mid-match loses only that
// matchday's progress: the save is from its start.

import { useEffect, useRef, useState } from 'react';
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
import { useNav } from '../../nav';
import type { Crumb } from '../../components/TopBar';
import { leagueName } from '../../../game/league/leagues';

interface Game {
  game: number;
  fixture: Fixture;
  /** The team index on each side of the live match (the player on side 0). */
  sides: [number, number];
}

/** This matchday's games in progress: what the address can't carry. */
interface Day {
  matchday: number;
  games: Game[];
  at: number;
  played: Record<number, GameRecord>;
  plans?: [GamePlan, GamePlan];
  seed?: number;
  match?: LiveMatch;
}

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

export function LeagueFlow({ initial, slot, step, onSaved }: { initial: QuickLeague; slot: number; step: 'hub' | 'prep' | 'match' | 'result'; onSaved: (q: QuickLeague) => void }) {
  const nav = useNav();
  // An old save stopped mid-draft: the computer makes the rest of the picks, the player's club's too.
  const [league, setLeagueState] = useState(() => (initial.phase === 'draft' ? finishDraft(initial) : initial));
  const [speed, setSpeed] = useState<Speed>(lastSpeed);
  const [saveFailed, setSaveFailed] = useState(false);
  const confirm = useConfirm();
  const day = useRef<Day | null>(null);

  /** Every change of league state is saved at once (after a pick, after a matchday). */
  const setLeague = (q: QuickLeague) => {
    setLeagueState(q);
    onSaved(q);
    setSaveFailed(!writeSlot(browserStorage, slot, q));
  };
  const banner = saveFailed ? (
    <div className="panel" style={{ borderColor: 'var(--away)' }}>
      <WarningIcon /> The browser would not save this league (storage full or blocked). Progress may be lost when you close the page.
    </div>
  ) : null;
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
  const to = (s: 'hub' | 'prep' | 'match' | 'result', replace = false) => nav.go({ s: 'quick', slot, step: s }, { replace });
  const finish = (played: Record<number, GameRecord>) => {
    setLeague(completeMatchday(league, played));
    day.current = null;
  };
  // Back to the hub: the screen before the game plan, or (opened by its address) the hub itself.
  const toHub = () => (nav.canBack ? nav.back() : to('hub', true));
  const name = leagueName(league.league, league.region);
  const hubCrumb: Crumb = { label: name, route: { s: 'quick', slot, step: 'hub' } };
  const here = (label: string): Crumb[] => [hubCrumb, { label, route: { s: 'quick', slot, step } }];

  // This matchday, if a game of it is under way; the address alone (after a reload) starts it again.
  const d = day.current && day.current.matchday === league.matchday ? day.current : null;
  if (step !== 'hub' && !d) {
    const games = gamesOf(league);
    if (step === 'prep' && games.length > 0 && league.phase === 'season') day.current = { matchday: league.matchday, games, at: 0, played: {} };
    else return <Back to={() => to(games.length > 0 && league.phase === 'season' ? 'prep' : 'hub', true)} />;
  }
  const cur = day.current;
  if (step === 'match' && !(cur?.plans && cur.seed !== undefined)) return <Back to={() => to('prep', true)} />;
  if (step === 'result' && !cur?.match) return <Back to={() => to('prep', true)} />;

  switch (step) {
    case 'hub':
      return (
        <>
          {banner}
          <LeagueHub
            league={league}
            speed={speed}
            onSpeed={setSpeed}
            crumbs={[hubCrumb]}
            onNewLeague={() => nav.menu()}
            onPlay={() => {
              const games = gamesOf(league);
              if (games.length === 0) finish({});
              else {
                day.current = { matchday: league.matchday, games, at: 0, played: {} };
                to('prep');
              }
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
      const g = cur!.games[cur!.at];
      return (
        <PrepScreen
          key={`${league.matchday}-${cur!.at}`}
          teams={teamsOf(g)}
          scout={scoutOf(g)}
          crumbs={here(`Matchday ${league.matchday + 1}: game plan`)}
          onLeave={toHub}
          onReady={(plans) => {
            cur!.plans = plans;
            cur!.seed = gameSeed(league, league.matchday, g.game);
            cur!.match = undefined;
            to('match', true);
          }}
        />
      );
    }
    case 'match': {
      const g = cur!.games[cur!.at];
      return (
        <MatchScreen
          key={`${league.matchday}-${cur!.at}`}
          setup={setupOf(g)}
          teams={teamsOf(g)}
          plans={cur!.plans!}
          seed={cur!.seed!}
          crumbs={here(`Matchday ${league.matchday + 1}: ${league.teams[g.sides[0]].name} v ${league.teams[g.sides[1]].name}`)}
          onLeave={toHub}
          onFinish={(match) => {
            cur!.match = match;
            to('result', true);
          }}
        />
      );
    }
    case 'result': {
      const g = cur!.games[cur!.at];
      // The result counts once it is seen: Continue and Leave both record it.
      const record = () => {
        const rec = recordFrom(league.matchday, g.fixture, gameSeed(league, league.matchday, g.game), cur!.match!.s, g.sides);
        return { ...cur!.played, [g.game]: rec };
      };
      const onContinue = () => {
        const played = record();
        if (cur!.at + 1 < cur!.games.length) {
          day.current = { ...cur!, at: cur!.at + 1, played, plans: undefined, match: undefined };
          to('prep', true);
        } else {
          finish(played);
          toHub();
        }
      };
      return (
        <ResultScreen
          match={cur!.match!}
          crumbs={here(`Matchday ${league.matchday + 1}: result`)}
          onLeave={() => {
            finish(record());
            toHub();
          }}
          onContinue={onContinue}
        />
      );
    }
  }
}

/** Goes to another step at once (the address asked for something that can't be rebuilt). */
function Back({ to }: { to: () => void }) {
  useEffect(() => {
    to();
    // Once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}