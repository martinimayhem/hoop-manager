// After the match, on one screen with no scrolling: a scoreboard across the top (both teams, the score
// by quarter, the way on), then one team's box score at a time (a tab for each, yours first) with its
// shot chart a tab away, and beside it the player of the game and the two teams side by side (on a
// narrower screen those are a tab too).

import { useState } from 'react';
import { buildBoxScore, playerRating } from '../../engine/stats';
import type { LiveMatch } from '../match/controller';
import { TeamTable } from '../components/BoxScoreTable';
import { TeamCompare } from '../components/BreakScreen';
import { Portrait } from '../components/Portrait';
import { ShotChart } from '../components/ShotChart';
import { NextIcon } from '../icons';
import { useMedia } from '../components/useMedia';
import { TopBar, type Crumb } from '../components/TopBar';

/** `onContinue`: in a league, the way on (instead of a rematch). */
export function ResultScreen({ match, onRematch, onLeave, onContinue, crumbs }: { match: LiveMatch; onRematch?: () => void; /** Leave (the Back position): in a league the result is recorded first. */ onLeave: () => void; onContinue?: () => void; crumbs: Crumb[] }) {
  const box = buildBoxScore(match.s);
  const winner = box.winner ?? 0;
  const [tab, setTab] = useState<0 | 1>(0);
  // Player of the game: best match rating.
  const all = box.teams.flatMap((t, side) => t.players.map((l) => ({ ...l, side, rating: playerRating(l.stats) ?? 0 })));
  const mvp = [...all].sort((a, b) => b.rating - a.rating)[0];
  const periods = Math.max(box.teams[0].quarterPoints.length, box.teams[1].quarterPoints.length);
  const overtime = periods > 4 ? (periods === 5 ? 'after overtime' : `after ${periods - 4} overtimes`) : '';
  const margin = Math.abs(box.teams[0].score - box.teams[1].score);
  const t = box.teams[tab];
  // One part of the box at a time; on a narrower screen the game summary is a third part (GAME_FLOW §6.1a).
  const [part, setPart] = useState<'box' | 'shots' | 'summary'>('box');
  // Narrow or short (a laptop's 650 px of page): the summary is a tab rather than a side column.
  const narrow = useMedia('(max-width: 1100px), (max-height: 720px)');
  const summary = (
    <>
          <div className="card-star result-mvp" style={{ ['--team' as string]: mvp.side === 0 ? 'var(--home)' : 'var(--away)' }}>
            <div className="card-star-head">Player of the game · {box.teams[mvp.side].name}</div>
            <div className="card-star-body">
              <div className="card-star-portrait">
                <Portrait player={mvp.player} side={mvp.side === 0 ? 0 : 1} size={60} number={false} />
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
              ].map(([v, l]) => (
                <div key={l} className="tile">
                  <div className="tile-v">{v}</div>
                  <div className="tile-l">{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel res-compare">
            <div className="res-compare-head">
              <span className="home">{box.teams[0].abbr}</span>
              <span className="res-sub">Team stats</span>
              <span className="away">{box.teams[1].abbr}</span>
            </div>
            <TeamCompare m={match} />
          </div>
    </>
  );

  return (
    <>
    <TopBar crumbs={crumbs} leave={onLeave} />
    <div className="res">
      <header className="panel res-board">
        {([0, 1] as const).map((side) => (
          <div key={side} className={`res-team ${side === 0 ? 'home' : 'away'} ${side === winner ? 'won' : 'lost'} ${side === 1 ? 'right' : ''}`}>
            <div className="res-team-name">{box.teams[side].name}</div>
            <div className="res-team-score">{box.teams[side].score}</div>
          </div>
        ))}
        <div className="res-mid">
          <div className="res-final">Final{overtime ? ` · ${overtime}` : ''}</div>
          <table className="res-lines">
            <thead>
              <tr>
                <th />
                {Array.from({ length: periods }, (_, i) => (
                  <th key={i}>{i < 4 ? `Q${i + 1}` : `OT${i - 3}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {box.teams.map((bt, side) => (
                <tr key={side}>
                  <td className={side === 0 ? 'home' : 'away'}>{bt.abbr}</td>
                  {bt.quarterPoints.map((p, i) => (
                    <td key={i}>{p}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="res-verdict">
            <span className={winner === 0 ? 'home' : 'away'}>{box.teams[winner].name}</span> win by {margin}
          </div>
        </div>
        <div className="res-actions">
          {onContinue ? (
            <button className="primary" onClick={onContinue}>
              Continue <NextIcon />
            </button>
          ) : (
            <>
              <button className="primary" onClick={onRematch}>
                Rematch <NextIcon />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="res-main">
        <section className="panel res-box">
          <div className="res-tabs" role="tablist">
            {([0, 1] as const).map((side) => (
              <button key={side} role="tab" aria-selected={tab === side} className={`res-tab ${side === 0 ? 'home' : 'away'} ${tab === side ? 'on' : ''}`} onClick={() => setTab(side)}>
                {box.teams[side].name} <b>{box.teams[side].score}</b>
              </button>
            ))}
            <span className="res-parts">
              <button className={part === 'box' ? 'on' : ''} aria-pressed={part === 'box'} onClick={() => setPart('box')}>
                Box score
              </button>
              <button className={part === 'shots' ? 'on' : ''} aria-pressed={part === 'shots'} onClick={() => setPart('shots')}>
                Shot chart
              </button>
              {narrow && (
                <button className={part === 'summary' ? 'on' : ''} aria-pressed={part === 'summary'} onClick={() => setPart('summary')}>
                  Game summary
                </button>
              )}
            </span>
          </div>
          {part === 'box' && <TeamTable key={tab} t={t} colour={tab === 0 ? 'var(--home)' : 'var(--away)'} side={tab} head={false} />}
          {part === 'shots' && (
            <div className="res-shots">
              <div className="res-sub">Where {t.name} shot from</div>
              <ShotChart key={tab} events={match.s.events} side={tab} name={t.name} compact />
            </div>
          )}
          {part === 'summary' && narrow && <div className="res-summary">{summary}</div>}
        </section>

        {!narrow && <aside className="res-side">{summary}</aside>}
      </div>
    </div>
    </>
  );
}

