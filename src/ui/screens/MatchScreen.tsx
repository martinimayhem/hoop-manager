import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { buildBoxScore } from '../../engine/stats';
import { defenceOptions, estimate, offenceOptions } from '../../game/clutch';
import { TALKS } from '../../game/teamTalk';
import { Sound } from '../sound';
import { timeoutAllowance } from '../../engine/match';
import { DEFENCE_SCHEMES, OFFENSIVE_FOCI, TEMPOS, type GamePlan, type PossessionCalls, type Side, type Team } from '../../engine/types';
import type { Controller } from '../../game/draft';
import type { Setup } from '../App';
import { BoxScoreTables } from '../components/BoxScoreTable';
import { Portrait, ShirtNumber } from '../components/Portrait';
import { featuresUrl, lookOf } from '../looks';
import { EnergyBar } from '../components/common';
import { PlanEditor } from '../components/PlanEditor';
import { REFS, playerKey } from '../court/animation';
import { CANVAS_H, CANVAS_W, CourtRenderer, type DotInfo } from '../court/render';
import { DEFENCE_INFO, OFFENCE_INFO, TEAM_COLOURS, TEMPO_INFO, clockString, periodLabel } from '../labels';
import { HIGHLIGHTS_PER_QUARTER, LiveMatch, type TeamView } from '../match/controller';

const TIMEOUT_KEYS = ['q', 'p'] as const;

export function MatchScreen({
  setup,
  teams,
  plans,
  seed,
  onFinish,
}: {
  setup: Setup;
  teams: [Team, Team];
  plans: [GamePlan, GamePlan];
  seed: number;
  onFinish: (m: LiveMatch) => void;
}) {
  const controllers: [Controller, Controller] = setup.mode === 'ai' ? ['human', 'ai'] : ['human', 'human'];
  const ref = useRef<LiveMatch | null>(null);
  if (!ref.current) {
    ref.current = new LiveMatch(teams[0], teams[1], plans, seed, controllers, setup.speed);
    // ?debugTravels in the address logs every player who walks with the ball in his hands.
    ref.current.debugTravels = new URLSearchParams(window.location.search).has('debugTravels');
  }
  const m = ref.current;
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
  const [seenTip, setSeenTip] = useState(-1);
  const [muted, setMuted] = useState(sound.muted);
  /** Paused because the player switched away; they continue from the overlay. */
  const [away, setAway] = useState(false);

  // Animation loop: tick the controller, draw the court, re-render React when something changed.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let seen = -1;
    const syncCanvasSize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
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
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        const holder = m.holderKey();
        const dots: Record<string, DotInfo> = {};
        for (const side of [0, 1] as const) {
          for (const p of m.s.teams[side].team.players) {
            const k = playerKey(side, p.id);
            dots[k] = { label: String(p.number), side, heightM: p.heightCm / 100, hasBall: holder === k, look: lookOf(p).sprite, features: featuresUrl(p) };
          }
        }
        for (const k of REFS) dots[k] = { label: '', side: 0, heightM: 1.84, hasBall: holder === k, ref: true };
        rendererRef.current!.draw(ctx, m.frame(), dots, now / 1000);
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

  // Keyboard: Q / P timeouts, space pauses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      for (const side of [0, 1] as const) {
        if (k === TIMEOUT_KEYS[side] && controllers[side] === 'human') m.requestTimeout(side);
      }
      if (k === ' ') {
        e.preventDefault();
        m.togglePause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const humanSides = ([0, 1] as const).filter((s) => controllers[s] === 'human');
  const momentumPct = 50 - m.s.momentum * 45;
  const humanTips = m.tips.filter((t) => controllers[t.side] === 'human');
  const unreadTips = showFeed ? 0 : humanTips.filter((t) => t.id > seenTip).length;

  return (
    <div className="match">
      <Scoreboard m={m} controllers={controllers} />
      <div className="momentum" title="Momentum">
        <div className="needle" style={{ left: `calc(${momentumPct}% - 2px)` }} />
      </div>

      <TeamPanel m={m} side={0} view={m.view[0]} human={controllers[0] === 'human'} />
      <div className="court-wrap">
        <div className="court-box">
          {away && m.paused && (
            <div className="away-pause">
              <div className="away-card">
                <div className="away-title">Paused</div>
                <div className="muted">The game waits while you are away.</div>
                <button className="primary" onClick={continueGame} autoFocus>
                  ▶ Continue <kbd>Space</kbd>
                </button>
              </div>
            </div>
          )}
          <div className="ff-badge" ref={badgeRef} hidden>
            »
          </div>
          <canvas ref={canvasRef} className="court" width={CANVAS_W} height={CANVAS_H} />
          {m.caption && (
            <div className="caption">
              <div className="stripe" style={{ background: m.caption.side === 0 ? 'var(--home)' : m.caption.side === 1 ? 'var(--away)' : 'var(--muted)' }} />
              <div className={`text ${m.caption.kind}`}>{m.caption.text}</div>
            </div>
          )}
          {showFeed && (
            <div className="feeds">
              <div className="panel feed">
                {m.feed.map((f) => (
                  <div key={f.id} className={f.kind}>
                    <span className="t">
                      {periodLabel(f.quarter)} {clockString(f.clock)}
                    </span>
                    <span className={f.side === 0 ? 'home' : f.side === 1 ? 'away' : ''}>{f.side !== null && f.kind !== 'info' ? '● ' : ''}</span>
                    {f.text}
                  </div>
                ))}
              </div>
              <div className="panel feed">
                <h3>Assistant coach</h3>
                {humanTips.map((t) => (
                  <div key={t.id} className="tip" style={{ borderColor: t.side === 0 ? 'var(--home)' : 'var(--away)' }}>
                    <span className="t">
                      {periodLabel(t.quarter)} {clockString(t.clock)}
                    </span>
                    {humanSides.length > 1 && <b className={t.side === 0 ? 'home' : 'away'}>{m.s.teams[t.side].team.abbr}: </b>}
                    {t.text}
                  </div>
                ))}
                {humanTips.length === 0 && <div className="muted small">Watching the game…</div>}
              </div>
            </div>
          )}
        </div>
        <div className="controls">
          {humanSides.map((side) => (
            <button
              key={side}
              disabled={m.view[side].timeoutsLeft <= 0 || m.pending[side] || m.phase !== 'playing'}
              onClick={() => m.requestTimeout(side)}
              style={{ borderColor: side === 0 ? 'var(--home)' : 'var(--away)' }}
            >
              {m.pending[side] ? 'Timeout coming…' : `Timeout ${m.s.teams[side].team.abbr}`} <kbd>{TIMEOUT_KEYS[side].toUpperCase()}</kbd>
            </button>
          ))}
          <button onClick={() => m.togglePause()} disabled={m.phase !== 'playing'}>
            {m.paused ? '▶ Resume' : '⏸ Pause'} <kbd>Space</kbd>
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
            title={`Show only the ${HIGHLIGHTS_PER_QUARTER} best plays of each quarter; the rest is played out instantly. Clutch moments are always shown.`}
            onClick={() => m.toggleHighlights()}
          >
            ★ Highlights
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
            className="small"
            title={muted ? 'Sound off' : 'Sound on'}
            onClick={() => {
              sound.setMuted(!muted);
              setMuted(!muted);
            }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button
            className={`small ${showFeed ? 'active' : ''}`}
            onClick={() => {
              setShowFeed(!showFeed);
              setSeenTip(humanTips[0]?.id ?? seenTip);
            }}
          >
            Commentary &amp; coach
            {unreadTips > 0 && <span className="count">{unreadTips}</span>}
          </button>
        </div>
      </div>
      <TeamPanel m={m} side={1} view={m.view[1]} human={controllers[1] === 'human'} />

      {(m.phase === 'timeout' || m.phase === 'break') && <PauseModal m={m} controllers={controllers} onDone={() => m.resume()} />}
      {m.phase === 'clutch' && m.clutch && <ClutchModal key={`${m.clutch.pending.length}-${m.clock}`} m={m} />}

      {m.phase === 'final' && (
        <div className="overlay">
          <div className="panel" style={{ marginTop: 120, textAlign: 'center', minWidth: 420 }}>
            <h3>Final</h3>
            <h1>
              <span className="home">{m.s.teams[0].team.name}</span> {m.score[0]}, {m.score[1]} <span className="away">{m.s.teams[1].team.name}</span>
            </h1>
            <p>{m.feed[0]?.text}</p>
            <button className="primary" onClick={() => onFinish(m)}>
              Box score &amp; result ▶
            </button>
          </div>
        </div>
      )}

      {showBox && (
        <div className="overlay" onClick={() => setShowBox(false)}>
          <div className="panel modal" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2>Box score</h2>
              <span className="muted small">(as of the last completed possession)</span>
              <div className="spacer" />
              <button onClick={() => setShowBox(false)}>Close</button>
            </div>
            <BoxScoreTables box={buildBoxScore(m.s)} />
          </div>
        </div>
      )}
    </div>
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
        <div className="small muted">{m.paused ? 'PAUSED' : m.phase === 'timeout' ? 'TIMEOUT' : m.phase === 'break' ? 'BREAK' : ''}</div>
      </div>
      {team(1)}
    </div>
  );
}

function TeamPanel({ m, side, view, human }: { m: LiveMatch; side: Side; view: TeamView; human: boolean }) {
  const team = m.s.teams[side].team;
  const colour = side === 0 ? 'var(--home)' : 'var(--away)';
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const row = (id: string) => {
    const p = team.players.find((x) => x.id === id)!;
    const v = view.players[id];
    const goingOut = view.lineup.includes(id) && !upcoming.includes(id);
    const comingIn = !view.lineup.includes(id) && upcoming.includes(id);
    return (
      <div
        key={id}
        className={`pl ${v.fouledOut ? 'out' : ''} ${canAct ? 'clickable' : ''} ${picked === id ? 'picked' : ''}`}
        onClick={() => click(id)}
        title={canAct ? 'Click a player on court and one on the bench to substitute' : undefined}
      >
        <Portrait player={p} side={side} size={42} />
        <span className="pl-name">
          <ShirtNumber player={p} side={side} />
          {p.name}&nbsp;<span className="muted">{p.position}</span>
          {goingOut && <span className="pending"> ⬇ out</span>}
          {comingIn && <span className="pending"> ⬆ in</span>}
        </span>
        <span className="pl-stat" title="Match rating (1-10, 6 = average)">
          <RatingBadge r={v.rating} /> <b>{v.pts}</b>
          <span className="muted"> pts</span>
        </span>
        <span className="pl-sub">
          <EnergyBar energy={v.energy} width={88} />
          <span className="mins muted" title="Minutes played">
            {Math.floor(v.seconds / 60)}′
          </span>
        </span>
        <span className="fouls" title="Personal fouls">
          {v.fouledOut ? 'OUT' : '●'.repeat(v.fouls)}
        </span>
      </div>
    );
  };
  const bench = team.players.map((p) => p.id).filter((id) => !view.lineup.includes(id));
  const planned = m.plannedTactics(side);
  return (
    <div className="panel team-panel">
      {human && (
        <div className="tactics-bar">
          <h3 style={{ color: colour, margin: 0 }}>Sideline calls</h3>
          <select value={planned.offence} disabled={!canAct} onChange={(e) => m.queueTactics(side, { offence: e.target.value as GamePlan['offence'] })}>
            {OFFENSIVE_FOCI.map((o) => (
              <option key={o} value={o}>
                {OFFENCE_INFO[o].icon} Attack: {OFFENCE_INFO[o].label}
              </option>
            ))}
          </select>
          <select value={planned.defence} disabled={!canAct} onChange={(e) => m.queueTactics(side, { defence: e.target.value as GamePlan['defence'] })}>
            {DEFENCE_SCHEMES.map((d) => (
              <option key={d} value={d}>
                {DEFENCE_INFO[d].icon} Defence: {DEFENCE_INFO[d].label}
              </option>
            ))}
          </select>
          <select value={planned.tempo} disabled={!canAct} onChange={(e) => m.queueTactics(side, { tempo: e.target.value as GamePlan['tempo'] })}>
            {TEMPOS.map((t) => (
              <option key={t} value={t}>
                {TEMPO_INFO[t].icon} Tempo: {TEMPO_INFO[t].label}
              </option>
            ))}
          </select>
          {m.queuedTactics[side] && <div className="pending">⏳ Changes at the next dead ball</div>}
        </div>
      )}
      {human && (
        <div style={{ marginTop: 8 }}>
          <div className={`swap-hint ${picked ? 'active' : ''}`}>
            {picked
              ? `${nameOf(picked)} selected: now click who swaps with them.`
              : canAct
                ? 'Sub: click a player on court, then one on the bench.'
                : 'Subs open again when play resumes.'}
          </div>
          {m.queuedSubs[side].map((q) => (
            <div key={q.outId + q.inId} className="pending">
              ⇄ {nameOf(q.inId)} in for {nameOf(q.outId)}: at the next dead ball
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
      <h3 style={{ color: colour, marginTop: 8 }}>On court</h3>
      {view.lineup.map(row)}
      <h3 style={{ marginTop: 8 }}>Bench</h3>
      {bench.map(row)}

    </div>
  );
}

function PauseModal({ m, controllers, onDone }: { m: LiveMatch; controllers: [Controller, Controller]; onDone: () => void }) {
  const humans = ([0, 1] as const).filter((s) => controllers[s] === 'human');
  // The side that called the timeout goes first.
  const ordered = m.timeoutSide !== null && humans.includes(m.timeoutSide) ? [m.timeoutSide, ...humans.filter((s) => s !== m.timeoutSide)] : humans;
  const livePlan = (side: Side): GamePlan => {
    const t = m.s.teams[side];
    const lineup = [...t.lineup];
    const rest = [...t.plan.starters, ...t.plan.bench, ...t.team.players.map((p) => p.id)].filter((id, i, arr) => !lineup.includes(id) && arr.indexOf(id) === i);
    return { ...t.plan, starters: lineup, bench: rest };
  };
  const [drafts, setDrafts] = useState<Record<number, GamePlan>>(() => Object.fromEntries(ordered.map((s) => [s, livePlan(s)])));
  const [tab, setTab] = useState<Side>(ordered[0] ?? 0);

  const title =
    m.phase === 'timeout'
      ? `Timeout: ${m.s.teams[m.timeoutSide ?? 0].team.name}`
      : m.breakQuarter === 2
        ? 'Halftime'
        : m.breakQuarter >= 4
          ? 'End of regulation: overtime!'
          : `End of Q${m.breakQuarter}`;

  const valid = ordered.every((s) => drafts[s].starters.length === 5);
  const apply = () => {
    for (const s of ordered) {
      const before = livePlan(s);
      const after = drafts[s];
      if (JSON.stringify(before) !== JSON.stringify(after)) m.applyPlan(s, after);
    }
    onDone();
  };

  return (
    <div className="overlay">
      <div className="panel modal">
        <div className="row">
          <h1 style={{ margin: 0 }}>{title}</h1>
          <span className="muted">
            {m.s.teams[0].team.abbr} {m.score[0]}, {m.score[1]} {m.s.teams[1].team.abbr}
          </span>
          <div className="spacer" />
          <button className="primary" disabled={!valid} onClick={apply}>
            Back to the game ▶
          </button>
        </div>
        {humans.length > 1 && (
          <div className="tabs">
            {ordered.map((s) => (
              <button key={s} className={tab === s ? 'active' : ''} onClick={() => setTab(s)} style={{ borderColor: s === 0 ? 'var(--home)' : 'var(--away)' }}>
                {m.s.teams[s].team.name}
                {m.phase === 'timeout' && s !== m.timeoutSide ? ' (may adjust too)' : ''}
              </button>
            ))}
          </div>
        )}
        {m.phase === 'break' && m.breakQuarter === 2 && <TeamTalkPanel m={m} side={tab} />}
        {m.tips.filter((t) => t.side === tab).slice(0, 3).map((t) => (
          <div key={t.id} className="tip small">
            {t.text}
          </div>
        ))}
        {drafts[tab] && (
          <PlanEditor
            key={tab}
            team={m.s.teams[tab].team}
            side={tab}
            opponent={m.s.teams[tab === 0 ? 1 : 0].team}
            plan={drafts[tab]}
            live={m.view[tab]}
            onChange={(p) => setDrafts((d) => ({ ...d, [tab]: p }))}
          />
        )}
        {humans.length === 0 && <div className="muted">The coaches are talking it over…</div>}
      </div>
    </div>
  );
}

function RatingBadge({ r }: { r: number | null }) {
  if (r === null) return <span className="rating muted">–</span>;
  const colour = r >= 7.5 ? 'var(--good)' : r >= 6 ? '#b8d86b' : r >= 5 ? 'var(--warn)' : 'var(--bad)';
  return (
    <span className="rating" style={{ background: colour }}>
      {r.toFixed(1)}
    </span>
  );
}

function TeamTalkPanel({ m, side }: { m: LiveMatch; side: Side }) {
  const given = m.talks[side];
  const margin = m.s.teams[side].score - m.s.teams[side === 0 ? 1 : 0].score;
  return (
    <div className="talk">
      <h3>Halftime team talk {margin > 0 ? `(up ${margin})` : margin < 0 ? `(down ${-margin})` : '(tied)'}</h3>
      {given ? (
        <div>
          <b>
            {TALKS.find((t) => t.talk === given.talk)?.icon} {TALKS.find((t) => t.talk === given.talk)?.label}:
          </b>{' '}
          {given.reaction}
        </div>
      ) : (
        <>
          <div className="muted small">What do you tell your players? Read the room: the right words depend on the score.</div>
          <div className="cards" style={{ marginTop: 6 }}>
            {TALKS.map((t) => (
              <button key={t.talk} className="card" title={t.line} onClick={() => m.teamTalk(side, t.talk)}>
                <span className="icon">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** A clutch moment: the human(s) call the play. The defence chooses first so the offence can't react to it. */
function ClutchModal({ m }: { m: LiveMatch }) {
  const c = m.clutch!;
  const role = c.pending[0];
  const side: Side = role === 'offence' ? c.offence : c.offence === 0 ? 1 : 0;
  const team = m.s.teams[side].team;
  const hotSeat = m.controllers[0] === 'human' && m.controllers[1] === 'human';
  const [ready, setReady] = useState(!hotSeat);
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
        {!ready ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <p>
              Pass the keyboard to <b>{team.name}</b>. The other coach: no peeking!
            </p>
            <button className="primary" onClick={() => setReady(true)}>
              I'm ready
            </button>
          </div>
        ) : (
          <div className="clutch-options">
            {options.map((o) => {
              const best = Math.abs(o.est.points - bestPts) < 1e-9;
              return (
                <button key={o.call ?? 'none'} className={`clutch-option ${best ? 'best' : ''}`} onClick={() => m.submitClutch(role, o.call)}>
                  <span className="icon">{o.icon}</span>
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
        )}
        <div className="muted small" style={{ textAlign: 'center', marginTop: 8 }}>
          Odds come from your assistant simulating this exact possession 150 times. Nothing is guaranteed!
        </div>
      </div>
    </div>
  );
}
