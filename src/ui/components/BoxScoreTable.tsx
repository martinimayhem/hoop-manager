import { playerRating, type BoxScore, type TeamBox } from '../../engine/stats';
import type { Side } from '../../engine/types';
import { Portrait, ShirtNumber } from './Portrait';
import { useSort } from './sortable';

type Line = TeamBox['players'][number];
/** The box score's columns: key, header, hover text, and the number it sorts by. */
const COLS: { key: string; label: string; tip?: string; v: (s: Line['stats']) => number }[] = [
  { key: 'rtg', label: 'RTG', tip: 'Match rating, 1-10', v: (s) => playerRating(s) ?? 0 },
  { key: 'min', label: 'MIN', tip: 'Minutes', v: (s) => s.seconds },
  { key: 'pts', label: 'PTS', tip: 'Points', v: (s) => s.pts },
  { key: 'fg', label: 'FG', tip: 'Field goals made-attempted', v: (s) => s.fgm + s.fga / 1000 },
  { key: '3p', label: '3P', tip: 'Three-pointers made-attempted', v: (s) => s.tpm + s.tpa / 1000 },
  { key: 'ft', label: 'FT', tip: 'Free throws made-attempted', v: (s) => s.ftm + s.fta / 1000 },
  { key: 'reb', label: 'REB', tip: 'Rebounds', v: (s) => s.oreb + s.dreb },
  { key: 'ast', label: 'AST', tip: 'Assists', v: (s) => s.ast },
  { key: 'stl', label: 'STL', tip: 'Steals', v: (s) => s.stl },
  { key: 'blk', label: 'BLK', tip: 'Blocks', v: (s) => s.blk },
  { key: 'to', label: 'TO', tip: 'Turnovers', v: (s) => s.tov },
  { key: 'pf', label: 'PF', tip: 'Personal fouls', v: (s) => s.pf },
  { key: 't', label: 'T', tip: 'Technical fouls', v: (s) => s.tf },
  { key: 'pm', label: '+/-', tip: 'Points for minus points against while on court', v: (s) => s.plusMinus },
];

const pct = (m: number, a: number) => (a ? `${Math.round((100 * m) / a)}%` : '–');

/** One team's box score. `head`: its name and score above it (off where a tab already says whose it is). */
export function TeamTable({ t, colour, side, head = true }: { t: TeamBox; colour: string; side: Side; head?: boolean }) {
  const sorter = useSort<Line>((l, key) => {
    if (key === 'name') return l.player.name;
    if (l.stats.seconds === 0) return null; // DNP: always last
    return COLS.find((c) => c.key === key)!.v(l.stats);
  });
  return (
    <div className="box-team" style={{ ['--team' as string]: colour }}>
      {head && (
        <div className="box-head">
          <b>{t.name}</b>
          <span className="box-score">{t.score}</span>
        </div>
      )}
      {sorter.sortButton}
      <table className="brk-table eq">
        <thead>
          <tr>
            {sorter.th('name', 'Player', { left: true, wide: true })}
            {COLS.map((c) => sorter.th(c.key, c.label, { tip: c.tip }))}
          </tr>
        </thead>
        <tbody>
          {sorter.sorted(t.players).map(({ player, starter, stats: s }) => (
            <tr key={player.id}>
              <td className="left">
                <span className="player-cell">
                  <Portrait player={player} side={side} size={24} />
                  <ShirtNumber player={player} side={side} />
                  {starter ? <b>{player.name}</b> : player.name}&nbsp;<span className="muted small">{player.position}</span>
                </span>
              </td>
              {s.seconds === 0 ? (
                <td colSpan={14} className="muted">
                  DNP
                </td>
              ) : (
                <>
                  <td>
                    <b>{playerRating(s)?.toFixed(1) ?? '–'}</b>
                  </td>
                  <td>{Math.round(s.seconds / 60)}</td>
                  <td><b>{s.pts}</b></td>
                  <td>{s.fgm}-{s.fga}</td>
                  <td>{s.tpm}-{s.tpa}</td>
                  <td>{s.ftm}-{s.fta}</td>
                  <td>{s.oreb + s.dreb}</td>
                  <td>{s.ast}</td>
                  <td>{s.stl}</td>
                  <td>{s.blk}</td>
                  <td>{s.tov}</td>
                  <td>{s.pf}</td>
                  <td className={s.tf > 0 ? 'bad' : 'muted'}>{s.tf}</td>
                  <td className={s.plusMinus > 0 ? 'good' : s.plusMinus < 0 ? 'bad' : ''}>{s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted small box-totals">
        FG {pct(t.totals.fgm, t.totals.fga)} · 3P {pct(t.totals.tpm, t.totals.tpa)} ({t.totals.tpm}/{t.totals.tpa}) · FT {pct(t.totals.ftm, t.totals.fta)} · REB{' '}
        {t.totals.oreb + t.totals.dreb} ({t.totals.oreb} off) · TO {t.totals.tov} · Paint {t.extras.paintPts} · Fast break {t.extras.fastBreakPts} · 2nd chance{' '}
        {t.extras.secondChancePts}
      </div>
    </div>
  );
}

export function LineScore({ box }: { box: BoxScore }) {
  const periods = Math.max(box.teams[0].quarterPoints.length, box.teams[1].quarterPoints.length);
  return (
    <table className="eq" style={{ width: 'auto' }}>
      <thead>
        <tr>
          <th className="left" style={{ width: 56 }}></th>
          {Array.from({ length: periods }, (_, i) => (
            <th key={i} style={{ width: 44 }}>{i < 4 ? `Q${i + 1}` : `OT${i - 3}`}</th>
          ))}
          <th style={{ width: 44 }}>T</th>
        </tr>
      </thead>
      <tbody>
        {box.teams.map((t, side) => (
          <tr key={side}>
            <td className={`left ${side === 0 ? 'home' : 'away'}`}>{t.abbr}</td>
            {t.quarterPoints.map((p, i) => (
              <td key={i}>{p}</td>
            ))}
            <td>
              <b>{t.score}</b>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BoxScoreTables({ box }: { box: BoxScore }) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <TeamTable t={box.teams[0]} colour="var(--home)" side={0} />
      <TeamTable t={box.teams[1]} colour="var(--away)" side={1} />
    </div>
  );
}
