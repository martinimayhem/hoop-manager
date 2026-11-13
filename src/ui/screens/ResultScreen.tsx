import { buildBoxScore, playerRating } from '../../engine/stats';
import type { LiveMatch } from '../match/controller';
import { BoxScoreTables, LineScore } from '../components/BoxScoreTable';
import { Portrait } from '../components/Portrait';
import { ShotChart } from '../components/ShotChart';

export function ResultScreen({ match, onRematch, onMenu }: { match: LiveMatch; onRematch: () => void; onMenu: () => void }) {
  const box = buildBoxScore(match.s);
  const winner = box.winner ?? 0;
  // Player of the game: best match rating.
  const all = box.teams.flatMap((t, side) => t.players.map((l) => ({ ...l, side, rating: playerRating(l.stats) ?? 0 })));
  const mvp = [...all].sort((a, b) => b.rating - a.rating)[0];

  const loser = winner === 0 ? 1 : 0;
  const mvpColour = mvp.side === 0 ? 'var(--home)' : 'var(--away)';
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="panel">
        <h3>Final</h3>
        <div className="result-top">
          <div className="result-head">
            <h1 className="result-title">
              <span className={winner === 0 ? 'home' : 'away'}>{box.teams[winner].name}</span> win
              <span className="result-score">
                {box.teams[winner].score}–{box.teams[loser].score}
              </span>
            </h1>
            <LineScore box={box} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" onClick={onRematch}>
                Rematch (same squads)
              </button>
              <button onClick={onMenu}>Main menu</button>
            </div>
          </div>
          <div className="card-star result-mvp" style={{ ['--team' as string]: mvpColour }}>
            <div className="card-star-head">Player of the game · {box.teams[mvp.side].name}</div>
            <div className="card-star-body">
              <div className="card-star-portrait">
                <Portrait player={mvp.player} side={mvp.side === 0 ? 0 : 1} size={72} number={false} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="card-star-name">{mvp.player.name}</div>
                <div className="card-star-team">
                  #{mvp.player.number} · {mvp.player.position} · {Math.round(mvp.stats.seconds / 60)} min
                </div>
              </div>
            </div>
            <div className="card-tiles">
              <div className="tile hot">
                <div className="tile-v">{mvp.rating.toFixed(1)}</div>
                <div className="tile-l">Rating</div>
              </div>
              {[
                [`${mvp.stats.pts}`, 'Pts'],
                [`${mvp.stats.oreb + mvp.stats.dreb}`, 'Reb'],
                [`${mvp.stats.ast}`, 'Ast'],
                [`${mvp.stats.fgm}-${mvp.stats.fga}`, 'FG'],
                [`${mvp.stats.tpm}-${mvp.stats.tpa}`, '3P'],
              ].map(([v, l]) => (
                <div key={l} className="tile">
                  <div className="tile-v">{v}</div>
                  <div className="tile-l">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="panel">
        <h3>Box score</h3>
        <BoxScoreTables box={box} />
      </div>
      <div className="panel">
        <h3>Shot charts</h3>
        <div className="row wrap" style={{ alignItems: 'flex-start', gap: 24 }}>
          {([0, 1] as const).map((side) => (
            <ShotChart key={side} events={match.s.events} side={side} name={box.teams[side].name} />
          ))}
        </div>
      </div>
    </div>
  );
}
