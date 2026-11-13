// The live game's stats around the court. Above it, the play-by-play: the only commentary. On the
// court's empty corners, the player of the game so far and the assistant's latest word. Under it,
// the two teams compared and the leaders' statlines. Everything as of the last play shown (the view
// the controller takes after each possession), never ahead of the picture; nothing scrolls.

import { useState } from 'react';
import { playerRating } from '../../engine/stats';
import type { Player, PlayerStats, Side } from '../../engine/types';
import { clockString, periodLabel } from '../labels';
import type { LiveMatch } from '../match/controller';
import { Portrait } from './Portrait';

const colourOf = (side: Side | null) => (side === 0 ? 'var(--home)' : side === 1 ? 'var(--away)' : 'var(--muted)');
const pct = (made: number, att: number) => (att > 0 ? Math.round((100 * made) / att) : 0);
/** True shooting: points per shot, a free throw counted as 0.44 of one. */
const trueShooting = (s: PlayerStats) => (s.fga + s.fta > 0 ? `${((100 * s.pts) / (2 * (s.fga + 0.44 * s.fta))).toFixed(1)}%` : '–');
const stocks = (s: PlayerStats) => s.stl + s.blk;

// ---------------------------------------------------------------------------
// Above the court

/** The commentary: the call as it happens, large, and the two before it. Click for more of the game. */
export function PlayByPlay({ m }: { m: LiveMatch }) {
  const [open, setOpen] = useState(false);
  const live = m.caption;
  const feed = m.feed.filter((f) => f.text !== live?.text);
  const latestSide = live ? live.side : (feed[0]?.side ?? null);
  return (
    <div className={`pbp ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} title={open ? 'Click to close' : 'Click for more of the play-by-play'}>
      <div className="pbp-latest" style={{ borderLeftColor: colourOf(latestSide) }}>
        <span className="pbp-time">
          {periodLabel(m.quarter)} {clockString(m.clock)}
        </span>
        <span className={`pbp-text ${live?.kind === 'setup' ? 'setup' : ''}`}>{live ? live.text : (feed[0]?.text ?? 'The tip-off is coming…')}</span>
        <span className="pbp-more">{open ? '▲' : '▼'}</span>
      </div>
      <div className="pbp-older">
        {(live ? feed : feed.slice(1)).slice(0, 2).map((f) => (
          <div key={f.id} className={f.kind}>
            <span className="pbp-dot" style={{ background: colourOf(f.side) }} />
            <span className="pbp-time">
              {periodLabel(f.quarter)} {clockString(f.clock)}
            </span>
            {f.text}
          </div>
        ))}
      </div>
      {open && (
        <div className="pbp-log" onClick={(e) => e.stopPropagation()}>
          {m.feed.slice(0, 22).map((f) => (
            <div key={f.id} className={f.kind}>
              <span className="pbp-dot" style={{ background: colourOf(f.side) }} />
              <span className="pbp-time">
                {periodLabel(f.quarter)} {clockString(f.clock)}
              </span>
              {f.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// On the court's empty corners

interface Line {
  p: Player;
  side: Side;
  s: PlayerStats;
}

/** Everyone who has played, both teams, from the view. */
function lines(m: LiveMatch): Line[] {
  const out: Line[] = [];
  for (const side of [0, 1] as const) {
    for (const p of m.s.teams[side].team.players) {
      const s = m.view[side].players[p.id]?.stats;
      if (s && s.seconds > 0) out.push({ p, side, s });
    }
  }
  return out;
}

const ratingOf = (l: Line) => playerRating(l.s) ?? 0;

/**
 * Over the court's empty corners: the player of the game so far bottom right, the assistant's
 * latest word top left, over the stands.
 */
export function CourtOverlays({ m, humanSides }: { m: LiveMatch; humanSides: Side[] }) {
  const star = lines(m)
    .filter((l) => playerRating(l.s) !== null)
    .sort((a, b) => ratingOf(b) - ratingOf(a))[0];
  const tip = m.tips.find((t) => humanSides.includes(t.side));
  return (
    <>
      {tip && (
        <div className="ov-coach" style={{ borderLeftColor: colourOf(tip.side) }}>
          <div className="ov-coach-head">
            Assistant coach
            <span>
              {periodLabel(tip.quarter)} {clockString(tip.clock)}
            </span>
          </div>
          <div className="ov-coach-text">{tip.text}</div>
        </div>
      )}
      {star && (
        <div className="ov-star" style={{ ['--team' as string]: colourOf(star.side) }}>
          <div className="ov-star-head">Player of the game</div>
          <div className="ov-star-body">
            <div className="ov-star-portrait">
              <Portrait player={star.p} side={star.side} size={72} number={false} />
            </div>
            <div className="ov-star-who">
              <div className="ov-star-name">{star.p.name}</div>
              <div className="ov-star-team">
                #{star.p.number} · {star.p.position} · {m.s.teams[star.side].team.name}
              </div>
            </div>
          </div>
          <div className="ov-tiles">
            <Tile value={ratingOf(star).toFixed(1)} label="Rating" hot />
            <Tile value={`${star.s.pts}`} label="Pts" />
            <Tile value={`${star.s.oreb + star.s.dreb}`} label="Reb" />
            <Tile value={`${star.s.ast}`} label="Ast" />
            <Tile value={`${stocks(star.s)}`} label="Stk" />
            <Tile value={`${star.s.fgm}-${star.s.fga}`} label="FG" />
          </div>
        </div>
      )}
    </>
  );
}

function Tile({ value, label, hot }: { value: string; label: string; hot?: boolean }) {
  return (
    <div className={`tile ${hot ? 'hot' : ''}`}>
      <div className="tile-v">{value}</div>
      <div className="tile-l">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Under the court

/** The strip of team comparisons and the two leader tables. */
export function Gamecast({ m }: { m: LiveMatch }) {
  return (
    <div className="gamecast">
      <TeamTiles m={m} />
      <LeaderTable m={m} />
    </div>
  );
}

/** Each team's totals, from the view. */
function totals(m: LiveMatch, side: Side) {
  const v = m.view[side];
  const sum = (k: keyof PlayerStats) => Object.values(v.players).reduce((a, p) => a + p.stats[k], 0);
  return {
    fgm: sum('fgm'), fga: sum('fga'), tpm: sum('tpm'), tpa: sum('tpa'), ftm: sum('ftm'), fta: sum('fta'),
    reb: sum('oreb') + sum('dreb'), ast: sum('ast'), tov: sum('tov'), paint: v.extras.paintPts, fast: v.extras.fastBreakPts,
  };
}

/** One tile per team stat: both teams' numbers, the better one lit, and a bar between them. */
function TeamTiles({ m }: { m: LiveMatch }) {
  const [h, a] = [totals(m, 0), totals(m, 1)];
  const tiles: { label: string; v: [number, number]; low?: boolean }[] = [
    { label: 'FG%', v: [pct(h.fgm, h.fga), pct(a.fgm, a.fga)] },
    { label: '3P%', v: [pct(h.tpm, h.tpa), pct(a.tpm, a.tpa)] },
    { label: 'FT%', v: [pct(h.ftm, h.fta), pct(a.ftm, a.fta)] },
    { label: 'Rebounds', v: [h.reb, a.reb] },
    { label: 'Assists', v: [h.ast, a.ast] },
    { label: 'Turnovers', v: [h.tov, a.tov], low: true },
    { label: 'Paint pts', v: [h.paint, a.paint] },
    { label: 'Fast break', v: [h.fast, a.fast] },
  ];
  return (
    <div className="gc-tiles">
      {tiles.map((t) => {
        const total = t.v[0] + t.v[1];
        const home = total > 0 ? t.v[0] / total : 0.5;
        const lead = t.v[0] === t.v[1] ? null : (t.v[0] > t.v[1]) !== !!t.low ? 0 : 1;
        return (
          <div key={t.label} className="gc-tile">
            <div className="gc-tile-l">{t.label}</div>
            <div className="gc-tile-v">
              <span className={lead === 0 ? 'lead home' : ''}>{t.v[0]}</span>
              <span className={lead === 1 ? 'lead away' : ''}>{t.v[1]}</span>
            </div>
            <div className="gc-tile-bar">
              <div style={{ width: `${home * 100}%`, background: 'var(--home)' }} />
              <div style={{ width: `${(1 - home) * 100}%`, background: 'var(--away)' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The columns of the leaders table, after name, number and position. */
const COLUMNS: { head: string; tip: string; cell: (l: Line) => string; key?: boolean }[] = [
  { head: 'RTG', tip: 'Match rating (1-10, 6 = average)', cell: (l) => ratingOf(l).toFixed(1), key: true },
  { head: 'PTS', tip: 'Points', cell: (l) => `${l.s.pts}` },
  { head: 'REB', tip: 'Rebounds', cell: (l) => `${l.s.oreb + l.s.dreb}` },
  { head: 'AST', tip: 'Assists', cell: (l) => `${l.s.ast}` },
  { head: 'STL', tip: 'Steals', cell: (l) => `${l.s.stl}` },
  { head: 'BLK', tip: 'Blocks', cell: (l) => `${l.s.blk}` },
  { head: 'TO', tip: 'Turnovers', cell: (l) => `${l.s.tov}` },
  { head: 'FG', tip: 'Field goals made-attempted', cell: (l) => `${l.s.fgm}-${l.s.fga}` },
  { head: '3P', tip: 'Three-pointers made-attempted', cell: (l) => `${l.s.tpm}-${l.s.tpa}` },
  { head: 'FT', tip: 'Free throws made-attempted', cell: (l) => `${l.s.ftm}-${l.s.fta}` },
  { head: 'TS%', tip: 'True shooting: points per shot, free throws included', cell: (l) => trueShooting(l.s) },
  { head: '+/-', tip: 'Points scored minus points allowed while he was on the floor', cell: (l) => `${l.s.plusMinus > 0 ? '+' : ''}${l.s.plusMinus}` },
  { head: 'MIN', tip: 'Minutes played', cell: (l) => `${Math.round(l.s.seconds / 60)}` },
];
/** As many rows as fit without scrolling. */
const LEADER_ROWS = 5;

/**
 * The game's best players, both teams, by match rating: name, number and position, then the full
 * statline. A bar in the team's colour marks whose he is. A fixed number of rows: nothing scrolls.
 */
function LeaderTable({ m }: { m: LiveMatch }) {
  const top = lines(m)
    .filter((l) => playerRating(l.s) !== null)
    .sort((a, b) => ratingOf(b) - ratingOf(a))
    .slice(0, LEADER_ROWS);
  return (
    <div className="lt">
      <div className="lt-title">
        Game leaders
        <span className="lt-sub">by match rating</span>
      </div>
      <div className="lt-body" style={{ ['--cols' as string]: `minmax(150px, 1.6fr) 40px 40px repeat(${COLUMNS.length}, minmax(0, 1fr))`, ['--rows' as string]: `${LEADER_ROWS}` }}>
        <div className="lt-head">
          <span className="left">Player</span>
          <span>No</span>
          <span>Pos</span>
          {COLUMNS.map((c) => (
            <span key={c.head} title={c.tip}>
              {c.head}
            </span>
          ))}
        </div>
        {top.map((l) => (
          <div key={l.p.id} className="lt-row" style={{ ['--team' as string]: colourOf(l.side) }}>
            <span className="lt-name" title={`${l.p.name}, ${m.s.teams[l.side].team.name}`}>
              {l.p.name}
            </span>
            <span className="lt-c lt-no">{l.p.number}</span>
            <span className="lt-c lt-pos">{l.p.position}</span>
            {COLUMNS.map((c) => (
              <span key={c.head} className={`lt-c ${c.key ? 'key' : ''}`}>
                {c.cell(l)}
              </span>
            ))}
          </div>
        ))}
        {top.length === 0 && <div className="lt-empty">No numbers yet.</div>}
      </div>
    </div>
  );
}
