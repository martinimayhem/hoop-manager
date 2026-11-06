import { playerRating, type BoxScore, type TeamBox } from '../../engine/stats';

const pct = (m: number, a: number) => (a ? `${Math.round((100 * m) / a)}%` : '–');

function TeamTable({ t, colour }: { t: TeamBox; colour: string }) {
  return (
    <div>
      <h2 style={{ color: colour }}>
        {t.name} <span className="muted">{t.score}</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th className="left">Player</th>
            <th title="Match rating, 1-10">RTG</th>
            <th>MIN</th>
            <th>PTS</th>
            <th>FG</th>
            <th>3P</th>
            <th>FT</th>
            <th>REB</th>
            <th>AST</th>
            <th>STL</th>
            <th>BLK</th>
            <th>TO</th>
            <th>PF</th>
            <th>+/-</th>
          </tr>
        </thead>
        <tbody>
          {t.players.map(({ player, starter, stats: s }) => (
            <tr key={player.id}>
              <td className="left">
                {starter ? <b>#{player.number} {player.name}</b> : `#${player.number} ${player.name}`} <span className="muted small">{player.position}</span>
              </td>
              {s.seconds === 0 ? (
                <td colSpan={13} className="muted">
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
                  <td className={s.plusMinus > 0 ? 'good' : s.plusMinus < 0 ? 'bad' : ''}>{s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted small" style={{ marginTop: 4 }}>
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
    <table style={{ width: 'auto' }}>
      <thead>
        <tr>
          <th className="left"></th>
          {Array.from({ length: periods }, (_, i) => (
            <th key={i}>{i < 4 ? `Q${i + 1}` : `OT${i - 3}`}</th>
          ))}
          <th>T</th>
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
      <TeamTable t={box.teams[0]} colour="var(--home)" />
      <TeamTable t={box.teams[1]} colour="var(--away)" />
    </div>
  );
}
