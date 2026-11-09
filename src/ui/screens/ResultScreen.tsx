import { buildBoxScore, playerRating } from '../../engine/stats';
import type { LiveMatch } from '../match/controller';
import { BoxScoreTables, LineScore } from '../components/BoxScoreTable';
import { ShotChart } from '../components/ShotChart';

export function ResultScreen({ match, onRematch, onMenu }: { match: LiveMatch; onRematch: () => void; onMenu: () => void }) {
  const box = buildBoxScore(match.s);
  const winner = box.winner ?? 0;
  // Player of the game: best match rating.
  const all = box.teams.flatMap((t, side) => t.players.map((l) => ({ ...l, side, rating: playerRating(l.stats) ?? 0 })));
  const mvp = [...all].sort((a, b) => b.rating - a.rating)[0];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="panel row wrap">
        <div>
          <h3>Final</h3>
          <h1 style={{ margin: 0 }}>
            <span className={winner === 0 ? 'home' : 'away'}>{box.teams[winner].name}</span> win {box.teams[winner].score}–{box.teams[winner === 0 ? 1 : 0].score}
          </h1>
          <div className="muted">
            Player of the game: <b className={mvp.side === 0 ? 'home' : 'away'}>{mvp.player.name}</b>: {mvp.stats.pts} pts, {mvp.stats.oreb + mvp.stats.dreb} reb,{' '}
            {mvp.stats.ast} ast · rating {mvp.rating.toFixed(1)}
          </div>
        </div>
        <div className="spacer" />
        <LineScore box={box} />
        <div className="row">
          <button className="primary" onClick={onRematch}>
            Rematch (same squads)
          </button>
          <button onClick={onMenu}>Main menu</button>
        </div>
      </div>
      <div className="panel">
        <BoxScoreTables box={box} />
      </div>
      <div className="panel row wrap" style={{ alignItems: 'flex-start', gap: 24 }}>
        {([0, 1] as const).map((side) => (
          <ShotChart key={side} events={match.s.events} side={side} name={box.teams[side].name} />
        ))}
      </div>
    </div>
  );
}
