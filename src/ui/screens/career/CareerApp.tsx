// A career while it is open (slice brief W2a): the world as it changes, Continue (day by day, the
// world's games simulated in the background worker), your game day (match preparation, Watch or
// Simulate, the match, the result), the season review, and saving: after every matchday, and when you
// leave the career (GAME_FLOW §6.1b).

import { useEffect, useRef, useState } from 'react';
import type { GamePlan, MatchState, Side } from '../../../engine/types';
import { longDate } from '../../../game/season/calendar';
import {
  advance,
  finishGameDay,
  finishMatch,
  humanGameToday,
  humanPlan,
  isKey,
  matchFor,
  type AdvanceMode,
  inputFor,
  lastDay,
  outputFrom,
  playInput,
  playOf,
  plansFor,
  setHumanPlan,
  sideOf,
  squadTeam,
  startSeason,
  type SimInput,
} from '../../../game/season/play';
import { lastTiming, simulateDay } from '../../../game/season/simClient';
import type { SeasonGame, SeasonPlay } from '../../../game/season/types';
import { DEFAULT_SCOUT_ACCURACY } from '../../../game/scouting';
import { clubById } from '../../../game/world/query';
import { writeWorld } from '../../../game/world/saves';
import type { World } from '../../../game/world/types';
import type { Setup } from '../../App';
import { useConfirm } from '../../components/Confirm';
import type { ScoutView } from '../../components/ScoutingReport';
import { NextIcon } from '../../icons';
import { useNav, type CareerView } from '../../nav';
import { MatchScreen } from '../MatchScreen';
import { lastSpeed, VIEW_3D_KEY } from '../MainMenu';
import { PrepScreen } from '../PrepScreen';
import { ResultScreen } from '../ResultScreen';
import { CareerShell, crumbsOf } from './CareerShell';
import { KeyMomentsScreen, MomentScreen, SeasonReview } from './postseason';
import { playToNextStop, type KeyStop } from '../../../game/season/keymoments';
import { startNextSeason } from '../../../game/season/rollover';
import { careerStore } from './store';
import { autoFill, closeContracts, closeFreeAgency, expiring, letGo, offer, offseasonOf } from '../../../game/season/contracts';
import type { DealActions } from './contracts';

/** Timings for the console and the headless checks (slice brief W2a: a matchday under 1 s). */
export interface MatchdayTiming {
  games: number;
  /** Playing the games (worker round trip). */
  sim: number;
  /** Everything for the day: the games, the results into the world, the screen. */
  day: number;
  /** Writing the save. */
  save: number;
}
const timings: MatchdayTiming[] = [];
if (import.meta.env.DEV) (window as unknown as { __matchdays?: MatchdayTiming[] }).__matchdays = timings;

function setupFor(w: World, g: { home: string; away: string }): Setup {
  let view: Setup['view'] = '2d';
  try {
    view = localStorage.getItem(VIEW_3D_KEY) === '1' ? '3d' : '2d';
  } catch {
    /* 2D */
  }
  return { names: [clubById(w, g.home)!.name, clubById(w, g.away)!.name], speed: lastSpeed(), view };
}

export function CareerApp({ initial, slot, view, onWorld }: { initial: World; slot: number; view: CareerView; onWorld: (w: World) => void }) {
  const app = useNav();
  const [world, setWorldState] = useState(() => startSeason(initial));
  const latest = useRef(world);
  const setWorld = (w: World) => {
    latest.current = w;
    setWorldState(w);
    onWorld(w);
  };
  const save = async (w: World) => {
    const t = performance.now();
    const ok = await writeWorld(careerStore, slot, w);
    return { ok, ms: performance.now() - t };
  };
  // A career opened without its season (a new one) gets it, and is saved with it at once.
  useEffect(() => {
    if (world !== initial) {
      onWorld(world);
      void save(world);
    }
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (v: CareerView, replace = false) => app.go({ s: 'career', slot, view: v }, { replace });
  const confirm = useConfirm();
  const [busy, setBusy] = useState<{ title: string; progress: number | null } | null>(null);

  const TITLES: Record<AdvanceMode, string> = {
    continue: 'Playing the world’s games',
    toKey: 'Simulating to your next key game',
    toRegularEnd: 'Simulating to the end of the regular season',
    toEnd: 'Simulating to the end of the season',
  };
  const run = async (mode: AdvanceMode) => {
    if (busy) return;
    const start = latest.current;
    const first = Math.max(0, playOf(start).day);
    const end = lastDay(start);
    const ahead = mode !== 'continue';
    setBusy({ title: TITLES[mode], progress: ahead ? 0 : null });
    let dayStart = performance.now();
    const r = await advance(start, simulateDay, {
      mode,
      onDay: async (w) => {
        const t = performance.now();
        setWorld(w);
        const s = await save(w);
        const timing: MatchdayTiming = { games: lastTiming.games, sim: Math.round(lastTiming.sim), day: Math.round(t - dayStart), save: Math.round(s.ms) };
        timings.push(timing);
        console.info(`[season] ${longDate(w.season, playOf(w).day)}: ${timing.games} games in ${timing.sim} ms (worker), ${timing.day} ms in all; saved in ${timing.save} ms`);
        // The season's last day moves on as the postseason is made: progress against the latest known.
        if (ahead) setBusy({ title: TITLES[mode], progress: Math.min(1, (playOf(w).day - first) / Math.max(1, Math.max(end, lastDay(w)) - first)) });
        dayStart = performance.now();
      },
    });
    setWorld(r.w);
    await save(r.w);
    if (r.stop === 'gameDay') go({ kind: 'prep' });
    else if (r.stop === 'moment' || (r.stop === 'reached' && playOf(r.w).moment)) go({ kind: 'moment' });
    else if (r.stop === 'end') go({ kind: 'review' });
    else if (r.stop === 'offseason') go({ kind: offseasonOf(r.w)!.step === 'contracts' ? 'contracts' : 'freeagents' });
    else go({ kind: 'home' });
    setBusy(null);
  };

  // ---- Before the new season (WORLD_SPEC §7.0): the contract screen, then the free-agent screen ----
  const stepView = (w: World): CareerView | null => {
    const o = offseasonOf(w);
    return o ? { kind: o.step === 'contracts' ? 'contracts' : 'freeagents' } : null;
  };
  const commitDeal = (w: World) => {
    setWorld(w);
    void save(w);
  };
  const deals: DealActions = {
    onOffer: (id, wage, years) => {
      const r = offer(latest.current, id, wage, years);
      commitDeal(r.w);
      return r.talk;
    },
    onLetGo: (id, yes) => commitDeal(letGo(latest.current, id, yes)),
    onContractsDone: () => {
      const w = latest.current;
      const me = w.human!.club;
      const undecided = expiring(w, me).filter((wp) => !offseasonOf(w)!.letGo.includes(wp.p.id));
      const finish = () => {
        commitDeal(closeContracts(latest.current));
        go({ kind: 'freeagents' }, true);
      };
      if (!undecided.length) return finish();
      confirm.ask(
        {
          title: undecided.length === 1 ? '1 player has no new deal' : `${undecided.length} players have no new deal`,
          body: `${undecided.map((wp) => wp.p.name).join(", ")} will leave as free agents. Other clubs can sign them.`,
          confirm: 'Let them go',
          cancel: 'Keep talking',
        },
        finish,
      );
    },
    onAutoFill: () => commitDeal(autoFill(latest.current)),
    onFreeDone: () => {
      setBusy({ title: 'The other clubs sign their free agents', progress: null });
      // Let the screen show the progress box before the work starts.
      window.setTimeout(() => {
        const w = closeFreeAgency(latest.current);
        commitDeal(w);
        toHome();
        setBusy(null);
      }, 30);
    },
  };

  const onContinue = () => {
    const step = stepView(latest.current);
    if (step) {
      if (view.kind !== step.kind) go(step);
      else if (step.kind === 'contracts') deals.onContractsDone();
      else deals.onFreeDone();
      return;
    }
    if (playOf(latest.current).moment) go({ kind: 'moment' });
    else if (humanGameToday(latest.current)) go({ kind: 'prep' });
    else void run('continue');
  };
  const ASK: Record<Exclude<AdvanceMode, 'continue'>, { title: string; body: string }> = {
    toKey: { title: 'Simulate to your next key game?', body: 'Your games will be simulated too, with your current game plan and rotation, until your next key game. The results stand.' },
    toRegularEnd: { title: 'Simulate to the end of the regular season?', body: 'Your games will be simulated too, with your current game plan and rotation. The results stand.' },
    toEnd: { title: 'Simulate to the end of the season?', body: 'The rest of the world plays every game to the season review.' },
  };
  const onSim = (mode: Exclude<AdvanceMode, 'continue'>) => confirm.ask({ ...ASK[mode], confirm: 'Simulate', cancel: 'Not now' }, () => void run(mode));
  /** What Continue stopped for has been read: on with the day. */
  const clearMoment = () => {
    const p = playOf(latest.current);
    if (p.moment) setWorld({ ...latest.current, play: { ...p, moment: null } });
  };

  // Your plan: kept in the world, saved a moment after the last change.
  const planTimer = useRef<number | null>(null);
  const onPlan = (p: GamePlan) => {
    const w = setHumanPlan(latest.current, p);
    setWorld(w);
    if (planTimer.current) window.clearTimeout(planTimer.current);
    planTimer.current = window.setTimeout(() => void save(latest.current), 800);
  };
  const onMenu = async () => {
    const s = await save(latest.current);
    app.setFlash(s.ok ? `Your career is saved (career slot ${slot + 1}).` : `Your career could not be saved just now; it was last saved in career slot ${slot + 1}.`);
    app.menu();
  };

  // ---- Your game day --------------------------------------------------------
  // What a route can't carry: the game being watched, and the finished match for the result screen.
  const live = useRef<{ game: SeasonGame; inp: SimInput; plans: [GamePlan, GamePlan]; from?: MatchState } | null>(null);
  const finished = useRef<{ game: number; state: MatchState } | null>(null);
  const today = humanGameToday(world);

  /** Your game counts, then the rest of the day is played and the career saved (the caller ends the busy state, after moving on). */
  const completeDay = async (game: number, state: MatchState, mode: SeasonPlay['mode']) => {
    setBusy({ title: 'Playing the rest of the day’s games', progress: null });
    const w = await finishGameDay(latest.current, outputFrom(game, state), simulateDay, mode);
    setWorld(w);
    await save(w);
    return w;
  };
  const toResult = () => {
    go({ kind: 'result' }, true);
    live.current = null;
    km.current = null;
    setBusy(null);
  };
  // Key moments: the match as the engine plays it, quarter by quarter, and where it stopped.
  const km = useRef<{ game: SeasonGame; inp: SimInput; plans: [GamePlan, GamePlan]; s: MatchState; stop: KeyStop; side: Side } | null>(null);
  const [, redraw] = useState(0);

  const busyBox = busy && (
    <div className="overlay cr-busy">
      <div className="panel cr-busy-box" role="status" aria-live="polite">
        <b>{busy.title}…</b>
        {busy.progress !== null && (
          <div className="cr-progress" aria-label={`${Math.round(busy.progress * 100)}%`}>
            <i style={{ width: `${Math.round(busy.progress * 100)}%` }} />
          </div>
        )}
        <span className="cr-sub">{longDate(world.season, Math.max(0, playOf(world).day))}</span>
      </div>
    </div>
  );

  const crumbs = crumbsOf(world, slot, view);
  const toHome = () => go({ kind: 'home' }, true);
  const back = () => (app.canBack ? app.back() : toHome());
  const leaveBox = useConfirm();

  if (view.kind === 'moment') {
    if (!playOf(world).moment) return <Redirect to={toHome} />;
    return (
      <>
        <MomentScreen
          w={world}
          crumbs={crumbs}
          onLeave={() => {
            clearMoment();
            back();
          }}
          onContinue={() => {
            clearMoment();
            toHome();
            void run('continue');
          }}
          onSimToEnd={() => {
            clearMoment();
            toHome();
            void run('toEnd');
          }}
        />
        {busyBox}
      </>
    );
  }

  if (view.kind === 'keymoments') {
    const k = km.current;
    if (!k) return <Redirect to={toHome} />;
    const playOn = () => {
      if (k.stop.kind === 'final') {
        finished.current = { game: k.game.id, state: k.s };
        void completeDay(k.game.id, k.s, 'keyMoments').then(toResult);
        return;
      }
      if (k.stop.kind === 'live') {
        // The last 5 minutes (and any overtime) live, from the match as it stands.
        live.current = { game: k.game, inp: k.inp, plans: [k.s.teams[0].plan, k.s.teams[1].plan], from: k.s };
        km.current = null;
        go({ kind: 'match' }, true);
        return;
      }
      k.stop = playToNextStop(k.s);
      redraw((n) => n + 1);
    };
    return (
      <>
        <KeyMomentsScreen
          key={`${k.game.id}-${k.s.quarter}-${k.stop.kind}`}
          w={world}
          g={k.game}
          s={k.s}
          inp={k.inp}
          side={k.side}
          stop={k.stop}
          crumbs={crumbs}
          onPlayOn={playOn}
          onLeave={() =>
            leaveBox.ask({ title: 'Leave the match?', body: 'It is not finished: if you leave, the rest of the match is simulated and the result counts.', confirm: 'Leave the match', cancel: 'Keep playing', danger: true }, () => {
              const state = finishMatch(k.s);
              km.current = null;
              void completeDay(k.game.id, state, 'keyMoments').then(() => {
                toHome();
                setBusy(null);
              });
            })
          }
        />
        {leaveBox.dialog}
        {busyBox}
      </>
    );
  }

  if (view.kind === 'prep' || view.kind === 'match' || view.kind === 'result') {
    const me = clubById(world, world.human!.club)!;
    if (view.kind === 'result') {
      const f = finished.current;
      if (!f) return <Redirect to={toHome} />;
      return (
        <>
          <ResultScreen match={{ s: f.state }} crumbs={crumbs} onLeave={toHome} onContinue={toHome} />
          {busyBox}
        </>
      );
    }
    if (view.kind === 'match') {
      const l = live.current;
      if (!l) return <Redirect to={toHome} />;
      const g = l.game;
      const mode: SeasonPlay['mode'] = l.from ? 'keyMoments' : 'watch';
      return (
        <>
          <MatchScreen
            key={g.id}
            setup={setupFor(world, g)}
            teams={l.inp.teams}
            plans={l.plans}
            seed={l.inp.seed}
            rules={l.inp.rules}
            from={l.from}
            humanSide={sideOf(g, me.id)}
            crumbs={crumbs}
            leaveBody="It is not finished: if you leave, the rest of the match is simulated and the result counts."
            onLeave={back}
            onAbandon={(m) => {
              const state = finishMatch(m.s);
              void completeDay(g.id, state, mode).then(() => setBusy(null));
            }}
            onFinish={(m) => {
              finished.current = { game: g.id, state: m.s };
              void completeDay(g.id, m.s, mode).then(toResult);
            }}
          />
          {busyBox}
        </>
      );
    }
    // Match preparation (while your simulated game's day is being finished: only the progress).
    if (!today) return busy ? busyBox : <Redirect to={toHome} />;
    const g = today;
    const side = sideOf(g, me.id);
    const inp = inputFor(world, g);
    const theirs = plansFor(inp)[1 - side];
    const plan = humanPlan(world);
    const mineTeam = squadTeam(world, me, [...plan.starters, ...plan.bench]);
    const oppTeam = inp.teams[1 - side];
    const hypes = new Map(oppTeam.players.map((p) => [p.id, world.players[p.id].reputation]));
    const scout: [ScoutView, ScoutView] = [
      { accuracy: DEFAULT_SCOUT_ACCURACY, minHalf: 0, hypes },
      { accuracy: DEFAULT_SCOUT_ACCURACY, minHalf: 0, hypes },
    ];
    // A key game pre-selects Watch; any other what you chose last time (GAME_FLOW §3.4).
    const key = isKey(world, g);
    const mode: SeasonPlay['mode'] = key ? 'watch' : playOf(world).mode;
    const commit = (plans: [GamePlan, GamePlan]) => {
      const w = setHumanPlan(latest.current, plans[0]);
      setWorld(w);
      return w;
    };
    const start = (plans: [GamePlan, GamePlan], how: SeasonPlay['mode']) => {
      const w = commit(plans);
      const input = inputFor(w, g);
      if (how === 'simulate') {
        const state = playInput(input);
        finished.current = { game: g.id, state };
        void completeDay(g.id, state, 'simulate').then(toResult);
      } else if (how === 'keyMoments') {
        const ps = plansFor(input);
        const s = matchFor(input, ps);
        km.current = { game: g, inp: input, plans: ps, s, stop: playToNextStop(s), side };
        go({ kind: 'keymoments' }, true);
      } else {
        live.current = { game: g, inp: input, plans: plansFor(input) };
        go({ kind: 'match' }, true);
      }
    };
    return (
      <>
        <PrepScreen
          key={g.id}
          teams={[mineTeam, oppTeam]}
          initial={[plan, theirs]}
          dressed={12}
          scout={scout}
          crumbs={crumbs}
          onLeave={back}
          onPlans={(plans) => commit(plans)}
          onReady={(plans) => start(plans, mode)}
          actions={(plans) => (
            <span className="cr-prep-actions">
              <span className="muted">
                {g.label ?? (g.home === me.id ? 'Home' : 'Away')} · {longDate(world.season, g.day)}
              </span>
              <button className={mode === 'simulate' ? 'primary' : ''} disabled={plans[0].starters.length !== 5} onClick={() => start(plans, 'simulate')} title="The result only">
                Simulate
              </button>
              <button className={mode === 'keyMoments' ? 'primary' : ''} disabled={plans[0].starters.length !== 5} onClick={() => start(plans, 'keyMoments')} title="Quarter cards and the breaks, then the last 5 minutes live">
                Key moments
              </button>
              <button className={mode === 'watch' ? 'primary' : ''} disabled={plans[0].starters.length !== 5} onClick={() => start(plans, 'watch')} title="The whole match, live">
                Watch <NextIcon />
              </button>
            </span>
          )}
        />
        {busyBox}
      </>
    );
  }

  if (view.kind === 'review') {
    if (playOf(world).phase !== 'review') return <Redirect to={toHome} />;
    const next = async () => {
      setBusy({ title: 'Starting the next season', progress: null });
      const w = startNextSeason(latest.current);
      setWorld(w);
      await save(w);
      // First your players whose contract has run out (WORLD_SPEC §7.0).
      go({ kind: 'contracts' }, true);
      setBusy(null);
    };
    return (
      <>
        <SeasonReview w={world} crumbs={crumbs} onLeave={back} onNext={() => void next()} />
        {busyBox}
      </>
    );
  }

  // The offseason's screens only while that step is on (a reload or an old address goes Home).
  if ((view.kind === 'contracts' || view.kind === 'freeagents') && stepView(world)?.kind !== view.kind) return <Redirect to={toHome} />;

  return (
    <>
      <CareerShell world={world} slot={slot} view={view} actions={{ onContinue, onSim, onPlan, onPrepare: () => go({ kind: 'prep' }), onMenu: () => void onMenu(), busy: !!busy, deals }} />
      {confirm.dialog}
      {busyBox}
    </>
  );
}
/** Goes to another screen at once (the address asked for something that can't be rebuilt, e.g. after a reload). */
function Redirect({ to }: { to: () => void }) {
  useEffect(() => {
    to();
    // Once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
