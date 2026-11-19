import { VIEW_3D_KEY } from './MainMenu';
import { X } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { buildBoxScore } from '../../engine/stats';
import { defenceOptions, estimate, offenceOptions } from '../../game/clutch';
import { Sound } from '../sound';
import { timeoutAllowance } from '../../engine/match';
import { DEFENCE_SCHEMES, OFFENSIVE_FOCI, TEMPOS, type GamePlan, type PossessionCalls, type Side, type Team } from '../../engine/types';
import type { Controller } from '../../game/draft';
import type { Setup } from '../App';
import { BoxScoreTables } from '../components/BoxScoreTable';
import { Portrait, ShirtNumber } from '../components/Portrait';
import { EnergyBar } from '../components/common';
import { PlayerCard, type CardAnchor } from '../components/PlayerCard';
import { BreakScreen } from '../components/BreakScreen';
import { CourtOverlays, Gamecast, PlayByPlay } from '../components/Gamecast';
import { CANVAS_H, CANVAS_W, CourtRenderer } from '../court/render';
import { courtDots } from '../court/dots';
import { DEFENCE_INFO, OFFENCE_INFO, TEAM_COLOURS, TEMPO_INFO, clockString, periodLabel } from '../labels';
import { ARGUE_SECONDS, LiveMatch, type TeamView } from '../match/controller';
import { TopBar, type Crumb } from '../components/TopBar';
import { useConfirm } from '../components/Confirm';
import { useNav } from '../nav';
import { NextIcon, PlayIcon, PauseIcon, HighlightsIcon, SoundOnIcon, SoundOffIcon, Icon } from '../icons';

/** The timeout key, for the player's team (the button beside the court does the same). */
const TIMEOUT_KEY = 'q';
/** What the match screen needs of the 3D scene; the scene itself loads only when the view is turned on. */
interface Scene3DLike {
  render(frame: ReturnType<LiveMatch['frame']>, action: ReturnType<LiveMatch['currentAction']>, holder: string | null, dt: number, next: ReturnType<LiveMatch['upcomingAction']>): void;
  resize(w: number, h: number): void;
  setClocks(game: number, shot: number | null): void;
  setBoard(names: [string, string], score: [number, number], offence: 0 | 1 | null): void;
  react(fx: ReturnType<LiveMatch['drainFx']>): void;
  dispose(): void;
}

export function MatchScreen({
  setup,
  teams,
  plans,
  seed,
  onFinish,
  onLeave,
  crumbs,
}: {
  setup: Setup;
  teams: [Team, Team];
  plans: [GamePlan, GamePlan];
  seed: number;
  onFinish: (m: LiveMatch) => void;
  /** Leave the match (the Back position, labelled Leave); it asks first while the match is on. */
  onLeave: () => void;
  crumbs: Crumb[];
}) {
  // You (side 0) against the computer (side 1).
  const controllers: [Controller, Controller] = ['human', 'ai'];
  const ref = useRef<LiveMatch | null>(null);
  if (!ref.current) {
    ref.current = new LiveMatch(teams[0], teams[1], plans, seed, controllers, setup.speed);
    // ?debugTravels in the address logs every player who walks with the ball in his hands.
    ref.current.debugTravels = new URLSearchParams(window.location.search).has('debugTravels');
  }
  const m = ref.current;
  // Dev only: the live match, for headless checks that play a match to its end quickly.
  if (import.meta.env.DEV) (window as unknown as { __liveMatch?: LiveMatch }).__liveMatch = m;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CourtRenderer | null>(null);
  if (!rendererRef.current) rendererRef.current = new CourtRenderer([TEAM_COLOURS[0], TEAM_COLOURS[1]]);
  const soundRef = useRef<Sound | null>(null);
  if (!soundRef.current) soundRef.current = new Sound();
  const sound = soundRef.current;
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [showBox, setShowBox] = useState(false);
  const [showFeed, setShowFeed] = useState(false);
  // The strip under the court: shown when there is room for it (a tall screen leaves plenty), else
  // the commentary and the assistant open over the court from the button.
  const infoRef = useRef<HTMLDivElement>(null);
  /** Below this height (px) there is no room for the stats under the court. */
  const INFO_MIN_HEIGHT = 230;
  const [roomy, setRoomy] = useState(false);
  useEffect(() => {
    const el = infoRef.current;
    if (!el) return;
    const measure = () => setRoomy(el.clientHeight >= INFO_MIN_HEIGHT);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [seenTip, setSeenTip] = useState(-1);
  const [muted, setMuted] = useState(sound.muted);
  /** Paused because the player switched away; they continue from the overlay. */
  const [away, setAway] = useState(false);

  // The court view chosen on the main menu (2D or 3D), switchable here; remembered in this browser.
  // The 3D code and models load the first time it is on; if it cannot start, the court stays 2D.
  const [view3d, setView3d] = useState(() => setup.view === '3d');
  const [view3dState, setView3dState] = useState<'off' | 'loading' | 'ready' | string>('off');
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const scene3dRef = useRef<Scene3DLike | null>(null);
  const view3dRef = useRef(view3d);
  view3dRef.current = view3d && view3dState === 'ready';
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_3D_KEY, view3d ? '1' : '0');
    } catch {
      // Not remembered: fine.
    }
    if (!view3d || scene3dRef.current) {
      if (scene3dRef.current) setView3dState('ready');
      return;
    }
    let cancelled = false;
    setView3dState('loading');
    (async () => {
      try {
        const [{ Scene3D, loadAssets }, { lookFor3d }] = await Promise.all([import('../court3d/scene3d'), import('../court3d/roster3d')]);
        const assets = await loadAssets();
        const canvas = canvas3dRef.current;
        if (cancelled || !canvas) return;
        const scene = new Scene3D(canvas, assets, (k) => lookFor3d(m, k));
        scene.resize(canvas.clientWidth, canvas.clientHeight);
        scene3dRef.current = scene;
        setView3dState('ready');
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setView3dState(`3D view could not start: ${err instanceof Error ? err.message : String(err)}`);
          setView3d(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view3d, m]);
  useEffect(() => {
    const canvas = canvas3dRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => scene3dRef.current?.resize(canvas.clientWidth, canvas.clientHeight));
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      scene3dRef.current?.dispose();
      scene3dRef.current = null;
    };
  }, []);

  // Animation loop: tick the controller, draw the court, re-render React when something changed.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let seen = -1;
    const syncCanvasSize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      // Hidden (the 3D view is on): keep the size it has, so it draws at once when it is back.
      if (rect.width === 0 || rect.height === 0) return;
      // Sharper than the screen where it is cheap, but never below it; past 2560 wide it costs frames.
      const pixelRatio = Math.min(3, Math.max(window.devicePixelRatio || 1, Math.min(2, 2560 / rect.width)));
      const width = Math.round(rect.width * pixelRatio);
      const height = Math.round(rect.height * pixelRatio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    const canvas = canvasRef.current;
    const resizeObserver = canvas ? new ResizeObserver(syncCanvasSize) : null;
    if (canvas) resizeObserver?.observe(canvas);
    window.addEventListener('resize', syncCanvasSize);
    syncCanvasSize();
    const loop = (now: number) => {
      // Next frame first: one frame that fails must never stop the game for good.
      raf = requestAnimationFrame(loop);
      try {
        frame(now);
      } catch (err) {
        console.error(err);
      }
    };
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      m.tick(dt);
      const fx = m.drainFx();
      sound.play(fx);
      sound.setCrowd(m.crowdLevel());
      rendererRef.current!.react(fx, now / 1000);
      scene3dRef.current?.react(fx);
      const scene3d = view3dRef.current ? scene3dRef.current : null;
      if (scene3d) {
        // The rigs play at match time: slow motion slows their legs too.
        scene3d.setClocks(m.clock, m.shotClock());
        scene3d.setBoard([teams[0].name, teams[1].name], m.score, m.offence());
        scene3d.render(m.frame(), m.currentAction(), m.holderKey(), dt * (m.frame()?.timeScale ?? 1), m.upcomingAction());
        if (badgeRef.current) badgeRef.current.hidden = !m.isFastForwarding();
      }
      const ctx = scene3d ? null : canvasRef.current?.getContext('2d');
      if (ctx) {
        rendererRef.current!.draw(ctx, m.frame(), courtDots(m), now / 1000);
        if (badgeRef.current) badgeRef.current.hidden = !m.isFastForwarding();
      }
      if (m.version !== seen) {
        seen = m.version;
        rerender();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncCanvasSize);
      sound.stop();
    };
  }, [m, sound]);

  // Switching away pauses the game and silences the arena; coming back brings the sound back, and
  // the game waits on the overlay until the player continues. Browsers barely run a page in the
  // background, so carrying on would leave the game crawling rather than playing.
  useEffect(() => {
    const leave = () => {
      if (m.phase === 'playing' && !m.paused) {
        m.togglePause();
        setAway(true);
      }
      sound.suspend();
    };
    const back = () => {
      if (!document.hidden) sound.resume();
    };
    const onVisibility = () => (document.hidden ? leave() : back());
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [m, sound]);

  // However the game was resumed (overlay, button or Space), the overlay goes.
  useEffect(() => {
    if (away && !m.paused) setAway(false);
  });

  const continueGame = () => {
    if (m.paused) m.togglePause();
    setAway(false);
    sound.resume();
  };

  // Keyboard: Q for a timeout, space pauses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      for (const side of [0, 1] as const) {
        if (k === TIMEOUT_KEY && controllers[side] === 'human') m.requestTimeout(side);
        if (k === 'a' && m.phase === 'argue' && m.argue?.side === side && controllers[side] === 'human') m.argueCall();
      }
      if (k === ' ') {
        e.preventDefault();
        m.togglePause();
      }
      if (e.key === 'Escape' && showBox) {
        e.preventDefault();
        setShowBox(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Leaving a match under way loses it: every way out (Leave, the menu, the browser's back, Escape)
  // asks first, with the match paused while it asks (GAME_FLOW §6.1b).
  const nav = useNav();
  const leaveBox = useConfirm();
  useEffect(() => {
    nav.setGuard(
      () =>
        new Promise<boolean>((resolve) => {
          if (m.phase === 'final') return resolve(true);
          const wasPaused = m.paused;
          if (!m.paused && m.phase === 'playing') m.togglePause();
          rerender();
          leaveBox.ask(
            { title: 'Leave the match?', body: 'It is not finished: if you leave, this match is lost and not played again.', confirm: 'Leave the match', cancel: 'Keep playing', danger: true },
            () => resolve(true),
            () => {
              if (!wasPaused && m.paused) m.togglePause();
              rerender();
              resolve(false);
            },
          );
        }),
    );
    return () => nav.setGuard(null);
    // The guard is set once for this match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m]);

  const humanSides = ([0, 1] as const).filter((s) => controllers[s] === 'human');  // Twice as sensitive as the effect itself, so that a run shows: an 8-0 run is about a quarter of the
  // way to the end. The engine's momentum is unchanged; this is only the needle.
  const momentumPct = 50 - Math.max(-1, Math.min(1, m.momentum * MOMENTUM_DISPLAY)) * 46;
  const humanTips = humanSides.flatMap((sd) => m.liveTips(sd)).sort((a, b) => b.id - a.id);
  const unreadTips = showFeed || roomy ? 0 : humanTips.filter((t) => t.id > seenTip).length;

  return (
    <>
    <TopBar crumbs={crumbs} leave={onLeave} />
    {leaveBox.dialog}
    <div className="match">
      <Scoreboard m={m} controllers={controllers} />
      <div className="momentum" title="Momentum">
        <div className="needle" style={{ left: `calc(${momentumPct}% - 2px)` }} />
      </div>

      <TeamPanel m={m} side={0} view={m.view[0]} human={controllers[0] === 'human'} />
      <div className="court-wrap">
        <PlayByPlay m={m} />
        <div className="court-box">
          {away && m.paused && (
            <div className="away-pause">
              <div className="away-card">
                <div className="away-title">Paused</div>
                <div className="muted">The game waits while you are away.</div>
                <button className="primary" onClick={continueGame} autoFocus>
                  <PlayIcon /> Continue <kbd>Space</kbd>
                </button>
              </div>
            </div>
          )}
          <div className="ff-badge" ref={badgeRef} hidden>
            »
          </div>
          <canvas ref={canvasRef} className="court" width={CANVAS_W} height={CANVAS_H} hidden={view3d && view3dState === 'ready'} />
          <canvas ref={canvas3dRef} className="court court-3d" hidden={!(view3d && view3dState === 'ready')} title="TV camera follows the play. Drag to turn, scroll or pinch to zoom, arrow keys to walk (Shift: faster), right-drag to move; double-click to give the camera back to the TV director." />
          {view3d && view3dState === 'loading' && <div className="court-3d-note">Loading 3D…</div>}
          {/* The commentary is in the play-by-play above; the court's empty corners carry the player of the game and the assistant. */}
          <CourtOverlays m={m} humanSides={humanSides} />
          {showFeed && !roomy && (
            <div className="feeds">
              <Gamecast m={m} humanSides={humanSides} />
            </div>
          )}
        </div>
        <div className="controls">
          {humanSides.map((side) => (
            <button
              key={side}
              disabled={m.view[side].timeoutsLeft <= 0 || m.pending[side] || m.phase !== 'playing' || m.view[side].coachEjected}
              title={m.view[side].coachEjected ? 'Coach ejected: the assistant decides on timeouts' : undefined}
              onClick={() => m.requestTimeout(side)}
              style={{ borderColor: side === 0 ? 'var(--home)' : 'var(--away)' }}
            >
              {m.pending[side] ? 'Timeout coming…' : `Timeout ${m.s.teams[side].team.abbr}`} <kbd>{TIMEOUT_KEY.toUpperCase()}</kbd>
            </button>
          ))}
          <button onClick={() => m.togglePause()} disabled={m.phase !== 'playing'}>
            {m.paused ? (
              <>
                <PlayIcon /> Resume
              </>
            ) : (
              <>
                <PauseIcon /> Pause
              </>
            )}{' '}
            <kbd>Space</kbd>
          </button>
          <div className="spacer" />
          <span className="muted small">Speed</span>
          <button className={`small ${m.speed === 'normal' ? 'active' : ''}`} onClick={() => m.setSpeed('normal')}>
            Normal
          </button>
          <button className={`small ${m.speed === 'fast' ? 'active' : ''}`} onClick={() => m.setSpeed('fast')}>
            Fast
          </button>
          <button
            className={`small ${m.highlights ? 'active' : ''}`}
            title="Show only the best plays: 3 in each of the first three quarters, 5 in the fourth. The rest is played out instantly. A close finish is always shown."
            onClick={() => m.toggleHighlights()}
          >
            <HighlightsIcon /> Highlights
          </button>
          <button
            className="small"
            onClick={() => {
              if (!m.paused && m.phase === 'playing') m.togglePause();
              setShowBox(true);
            }}
          >
            Box score
          </button>
          <button
            className={`small ${view3d ? 'active' : ''}`}
            title={view3dState.startsWith('3D view could not') ? view3dState : 'Show the match in 3D (beta). The 2D view stays the default.'}
            onClick={() => setView3d(!view3d)}
          >
            3D view (beta)
          </button>
          <button
            className="small"
            title={muted ? 'Sound off' : 'Sound on'}
            onClick={() => {
              sound.setMuted(!muted);
              setMuted(!muted);
            }}
          >
            {muted ? <SoundOffIcon /> : <SoundOnIcon />}
          </button>
          {!roomy && (
            <button
              className={`small ${showFeed ? 'active' : ''}`}
              onClick={() => {
                setShowFeed(!showFeed);
                setSeenTip(humanTips[0]?.id ?? seenTip);
              }}
            >
              Game stats
              {unreadTips > 0 && <span className="count">{unreadTips}</span>}
            </button>
          )}
        </div>
        {/* Below the court, where there is room: team stats, game leaders and the assistant, always in view. */}
        <div className="match-info" ref={infoRef}>
          {roomy && <Gamecast m={m} humanSides={humanSides} />}
        </div>
      </div>
      <TeamPanel m={m} side={1} view={m.view[1]} human={controllers[1] === 'human'} />

      {(m.phase === 'timeout' || m.phase === 'break') && <BreakScreen m={m} controllers={controllers} onDone={() => m.resume()} />}
      {m.phase === 'clutch' && m.clutch && <ClutchModal key={`${m.clutch.pending.length}-${m.clock}`} m={m} />}
      {m.phase === 'argue' && m.argue && <ArgueBar key={m.argue.until} m={m} />}

      {m.phase === 'final' && (
        <div className="overlay">
          <div className="panel final-card">
            <h3>Final</h3>
            <div className="final-board">
              {([0, 1] as const).map((side) => {
                const won = m.score[side] > m.score[1 - side];
                return (
                  <div key={side} className={`final-team ${side === 0 ? 'home' : 'away'} ${won ? 'won' : 'lost'}`}>
                    <div className="final-name">{m.s.teams[side].team.name}</div>
                    <div className="final-score">{m.score[side]}</div>
                  </div>
                );
              })}
            </div>
            <div className="final-verdict">
              <span className={m.score[0] > m.score[1] ? 'home' : 'away'}>{m.s.teams[m.score[0] > m.score[1] ? 0 : 1].team.name}</span> win by{' '}
              {Math.abs(m.score[0] - m.score[1])}
            </div>
            <button className="primary" onClick={() => onFinish(m)}>
              See the result <NextIcon />
            </button>
          </div>
        </div>
      )}

      {showBox && (
        <div className="overlay" onClick={() => setShowBox(false)}>
          <div className="panel modal" role="dialog" aria-label="Box score" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2>Box score</h2>
              <span className="muted small">(as of the last completed possession)</span>
              <div className="spacer" />
              <button className="brk-close" onClick={() => setShowBox(false)} aria-label="Close the box score" title="Close">
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <BoxScoreTables box={buildBoxScore(m.s)} />
          </div>
        </div>
      )}
    </div>
    </>
  );
}

function Scoreboard({ m, controllers }: { m: LiveMatch; controllers: [Controller, Controller] }) {
  const team = (side: Side) => {
    const t = m.s.teams[side];
    const v = m.view[side];
    // NBA: five team fouls in the period, or two in its last two minutes.
    const bonus = v.quarterFouls >= 5 || v.lateFouls >= 2;
    return (
      <div className={`sb-team ${side === 1 ? 'right' : ''}`}>
        {side === 1 && <div className="sb-score away">{m.score[1]}</div>}
        <div>
          <div className={`sb-name ${side === 0 ? 'home' : 'away'}`}>
            {t.team.name} {controllers[side] === 'ai' && <span className="tag">AI</span>}
          </div>
          <div className="small muted">
            {OFFENCE_INFO[t.plan.offence].label} · {DEFENCE_INFO[t.plan.defence].label} · {TEMPO_INFO[t.plan.tempo].label}
          </div>
          <div className="small">
            <span className="dots" title="Timeouts left">
              {Array.from({ length: timeoutAllowance(m.quarter) }, (_, i) => (
                <span key={i} className={i < v.timeoutsLeft ? 'on' : ''} />
              ))}
            </span>
            <span className="muted"> Fouls {v.quarterFouls}</span>
            {bonus && <span className="bad"> BONUS</span>}
            {v.coachEjected ? (
              <span className="bad" title="Two technicals: the coach is gone. The assistant calls timeouts and clutch plays; your changes reach the bench at the quarter break.">
                {' '}
                COACH EJECTED: assistant in charge
              </span>
            ) : (
              v.coachTechnicals > 0 && (
                <span style={{ color: 'var(--warn)' }} title="A technical on the coach: one more and he is ejected">
                  {' '}
                  Coach T
                </span>
              )
            )}
          </div>
        </div>
        {side === 0 && <div className="sb-score home">{m.score[0]}</div>}
      </div>
    );
  };
  return (
    <div className="panel scoreboard">
      {team(0)}
      <div className="sb-centre">
        <div className="sb-clock">
          {periodLabel(m.quarter)} {clockString(m.clock)}
        </div>
        <div className="small muted">{m.paused ? 'PAUSED' : m.phase === 'timeout' ? 'TIMEOUT' : m.phase === 'break' ? 'BREAK' : m.phase === 'argue' ? 'WHISTLE' : ''}</div>
      </div>
      {team(1)}
    </div>
  );
}

function TeamPanel({ m, side, view, human }: { m: LiveMatch; side: Side; view: TeamView; human: boolean }) {
  const team = m.s.teams[side].team;
  const colour = side === 0 ? 'var(--home)' : 'var(--away)';
  const [picked, setPicked] = useState<string | null>(null);
  // Your panel shows the players or the sideline calls, so twelve tappable rows fit a tablet (GAME_FLOW §6.1a).
  const [panelTab, setPanelTab] = useState<'players' | 'calls'>('players');
  const [error, setError] = useState<string | null>(null);
  /** The player the mouse is over: his card shows beside the panel. */
  const [hover, setHover] = useState<{ id: string; at: CardAnchor } | null>(null);
  const upcoming = m.lineupAfterQueue(side);
  const canAct = human && m.phase === 'playing';
  const nameOf = (id: string) => team.players.find((p) => p.id === id)?.name ?? id;

  const click = (id: string) => {
    if (!canAct || view.players[id].fouledOut) return;
    setError(null);
    if (!picked || picked === id) {
      setPicked(picked === id ? null : id);
      return;
    }
    const pickedOn = upcoming.includes(picked);
    const idOn = upcoming.includes(id);
    if (pickedOn === idOn) {
      setPicked(id);
      return;
    }
    const err = pickedOn ? m.queueSub(side, picked, id) : m.queueSub(side, id, picked);
    setError(err);
    setPicked(null);
  };

  const row = (id: string, compact = false) => {
    const p = team.players.find((x) => x.id === id)!;
    const v = view.players[id];
    const goingOut = view.lineup.includes(id) && !upcoming.includes(id);
    const comingIn = !view.lineup.includes(id) && upcoming.includes(id);
    return (
      <div
        key={id}
        className={`pl ${compact ? 'compact' : ''} ${v.fouledOut ? 'out' : ''} ${canAct ? 'clickable' : ''} ${picked === id ? 'picked' : ''}`}
        onClick={() => click(id)}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover({ id, at: { top: r.top, left: r.left, right: r.right } });
        }}
        onMouseLeave={() => setHover((h) => (h?.id === id ? null : h))}
      >
        <Portrait player={p} side={side} size={26} />
        <span className="pl-name">
          <ShirtNumber player={p} side={side} />
          {/* The name gives way before the position does. */}
          <span className="pl-n" title={p.name}>{p.name}</span>
          <span className="pl-pos muted">{p.position}</span>
          {goingOut && <span className="pending">
              <Icon name="down" /> out
            </span>}
          {comingIn && <span className="pending">
              <Icon name="up" /> in
            </span>}
        </span>
        <span className="pl-sub">
          <EnergyBar energy={v.energy} width={compact ? 30 : 88} />
          <span className="mins muted">{Math.floor(v.seconds / 60)}′</span>
        </span>
        <span className="fouls">
          {v.ejected ? 'EJECTED' : v.fouledOut ? 'OUT' : Array.from({ length: v.fouls }, (_, i) => <span key={i} className="foul-dot" />)}
          {!v.fouledOut && v.technicals > 0 && <span className="bad"> T</span>}
        </span>
      </div>
    );
  };
  const bench = team.players.map((p) => p.id).filter((id) => !view.lineup.includes(id));
  const planned = m.plannedTactics(side);
  return (
    <div className="panel team-panel" style={{ ['--team' as string]: colour }}>
      <div className="tp-banner">{team.name}</div>
      {human && (
        <div className="tp-tabs" role="tablist">
          <button role="tab" aria-selected={panelTab === 'players'} className={panelTab === 'players' ? 'on' : ''} onClick={() => setPanelTab('players')}>
            Players
          </button>
          <button role="tab" aria-selected={panelTab === 'calls'} className={panelTab === 'calls' ? 'on' : ''} onClick={() => setPanelTab('calls')}>
            Sideline calls{m.queuedTactics[side] ? ' ·' : ''}
          </button>
        </div>
      )}
      {human && panelTab === 'calls' && (
        <div className="tactics-bar">
          <select value={planned.offence} disabled={!canAct} onChange={(e) => m.queueTactics(side, { offence: e.target.value as GamePlan['offence'] })}>
            {OFFENSIVE_FOCI.map((o) => (
              <option key={o} value={o}>
                Attack: {OFFENCE_INFO[o].label}
              </option>
            ))}
          </select>
          <select value={planned.defence} disabled={!canAct} onChange={(e) => m.queueTactics(side, { defence: e.target.value as GamePlan['defence'] })}>
            {DEFENCE_SCHEMES.map((d) => (
              <option key={d} value={d}>
                Defence: {DEFENCE_INFO[d].label}
              </option>
            ))}
          </select>
          <select value={planned.tempo} disabled={!canAct} onChange={(e) => m.queueTactics(side, { tempo: e.target.value as GamePlan['tempo'] })}>
            {TEMPOS.map((t) => (
              <option key={t} value={t}>
                Tempo: {TEMPO_INFO[t].label}
              </option>
            ))}
          </select>
          {m.queuedTactics[side] && <div className="pending">
              <Icon name="hourglass" /> Changes at the next dead ball
            </div>}
        </div>
      )}
      {panelTab === 'players' && human && (
        <div className="tp-subs">
          {picked && <div className="swap-hint active">{nameOf(picked)} selected: now click who swaps with them.</div>}
          {m.queuedSubs[side].map((q) => (
            <div key={q.outId + q.inId} className="pending">
              <Icon name="swap" /> {nameOf(q.inId)} in for {nameOf(q.outId)}: at the next dead ball
            </div>
          ))}
          {m.queuedSubs[side].length > 0 && (
            <button className="small" onClick={() => m.cancelSubs(side)}>
              Cancel subs
            </button>
          )}
          {error && <div className="bad small">{error}</div>}
        </div>
      )}
      {panelTab === 'players' && (
        <>
          <h3 className="tp-head" style={{ color: colour }}>
            On court{human ? ': tap one, then a bench player, to swap' : ''}
          </h3>
          {view.lineup.map((id) => row(id, true))}
          <h3 className="tp-head">Bench</h3>
          {bench.map((id) => row(id, true))}
        </>
      )}
      {hover && view.players[hover.id] && (
        <PlayerCard
          player={team.players.find((p) => p.id === hover.id)!}
          state={view.players[hover.id]}
          side={side}
          own={human}
          onCourt={view.lineup.includes(hover.id)}
          anchor={hover.at}
        />
      )}

    </div>
  );
}


/** How much further the momentum needle moves than the momentum itself. */
const MOMENTUM_DISPLAY = 2;

/**
 * The whistle went against a human team on a reach-in or a hold: for a moment the coach can go after
 * the official. It fires the team up, or earns a technical (two and he is ejected). Gone after a
 * few seconds, so the game never waits on it for long.
 */
function ArgueBar({ m }: { m: LiveMatch }) {
  const side = m.argue!.side;
  const techs = m.view[side].coachTechnicals;
  return (
    <div className="argue-bar panel" style={{ borderColor: side === 0 ? 'var(--home)' : 'var(--away)' }}>
      <div className="row">
        <b>Whistle on {m.s.teams[side].team.name}.</b>
        <span className="muted small">{techs > 0 ? 'You already have a technical: another one and you are ejected.' : 'Go after the official? It can fire your team up, or cost a technical.'}</span>
        <div className="spacer" />
        <button className="primary" onClick={() => m.argueCall()}>
          Argue the call <kbd>A</kbd>
        </button>
        <button onClick={() => m.letItGo()}>Let it go</button>
      </div>
      <div className="argue-timer" style={{ animationDuration: `${ARGUE_SECONDS}s` }} />
    </div>
  );
}



/** A clutch moment: the player makes the call, the play when his team has the ball, the defence when it hasn't. */
function ClutchModal({ m }: { m: LiveMatch }) {
  const c = m.clutch!;
  const role = c.pending[0];
  const side: Side = role === 'offence' ? c.offence : c.offence === 0 ? 1 : 0;
  const team = m.s.teams[side].team;
  const options = useMemo(() => {
    const base: PossessionCalls = {};
    if (role === 'offence') {
      return offenceOptions(m.s, side).map((o) => ({ ...o, est: estimate(m.s, { ...base, offence: o.call ?? undefined }) }));
    }
    return defenceOptions(m.s, side).map((o) => ({ ...o, est: estimate(m.s, { ...base, defence: o.call ?? undefined }) }));
  }, [m, role, side]);
  const bestPts = role === 'offence' ? Math.max(...options.map((o) => o.est.points)) : Math.min(...options.map((o) => o.est.points));
  const margin = m.s.teams[side].score - m.s.teams[side === 0 ? 1 : 0].score;

  return (
    <div className="overlay">
      <div className="panel modal clutch">
        <div className="clutch-title">CLUTCH TIME</div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <span className="muted">
            {periodLabel(m.quarter)} {clockString(m.clock)} · {m.s.teams[0].team.abbr} {m.score[0]}, {m.score[1]} {m.s.teams[1].team.abbr}
          </span>
        </div>
        <h2 className={side === 0 ? 'home' : 'away'} style={{ textAlign: 'center', marginTop: 8 }}>
          {team.name}: {role === 'offence' ? 'call the play!' : 'how do we defend this one?'}{' '}
          <span className="muted small">({margin > 0 ? `up ${margin}` : margin < 0 ? `down ${-margin}` : 'tied'})</span>
        </h2>
        <div className="clutch-options">
          {options.map((o) => {
            const best = Math.abs(o.est.points - bestPts) < 1e-9;
            return (
              <button key={o.call ?? 'none'} className={`clutch-option ${best ? 'best' : ''}`} onClick={() => m.submitClutch(role, o.call)}>
                <span className="icon"><Icon name={o.icon} /></span>
                <b>{o.label}</b>
                <span className="muted small">{o.detail}</span>
                <span className="odds">
                  {role === 'offence' ? 'We score' : 'They score'} {Math.round(o.est.scoreChance * 100)}% · {o.est.points.toFixed(2)} pts
                </span>
                {best && <span className="tag">assistant's pick</span>}
              </button>
            );
          })}
        </div>
        <div className="muted small" style={{ textAlign: 'center', marginTop: 8 }}>
          Odds come from your assistant simulating this exact possession 150 times. Nothing is guaranteed!
        </div>
      </div>
    </div>
  );
}
