// A player's card, shown while the mouse is over him in a team panel: who he is, how he is doing
// tonight, and (for the coach's own players) his ratings. The other side's true ratings stay hidden,
// as everywhere else: that is what the scouting report is for.

import { composite, type Composite } from '../../engine/ratings';
import { playerRating } from '../../engine/stats';
import type { Player, Side } from '../../engine/types';
import type { PlayerView } from '../match/controller';
import { Portrait } from './Portrait';
import { RatingBadge, ratingColour } from './common';

const RATINGS: { key: keyof Composite; label: string }[] = [
  { key: 'three', label: 'Three' },
  { key: 'midRange', label: 'Mid-range' },
  { key: 'insideScoring', label: 'Inside' },
  { key: 'driving', label: 'Driving' },
  { key: 'playmaking', label: 'Playmaking' },
  { key: 'ballSecurity', label: 'Ball security' },
  { key: 'perimeterD', label: 'Perimeter D' },
  { key: 'rimProtection', label: 'Rim protection' },
  { key: 'rebounding', label: 'Rebounding' },
  { key: 'speed', label: 'Speed' },
];

const CARD_W = 300;

export interface CardAnchor {
  /** The row hovered, in viewport pixels. */
  top: number;
  left: number;
  right: number;
}

export function PlayerCard({ player, state, side, own, onCourt, anchor }: { player: Player; state: PlayerView; side: Side; own: boolean; onCourt: boolean; anchor: CardAnchor }) {
  const s = state.stats;
  const c = composite(player);
  const colour = side === 0 ? 'var(--home)' : 'var(--away)';
  // Beside the panel, towards the court; kept on screen.
  const left = side === 0 ? anchor.right + 10 : anchor.left - 10 - CARD_W;
  const top = Math.max(8, Math.min(anchor.top - 12, window.innerHeight - (own ? 470 : 300)));
  const pct = (m: number, a: number) => (a > 0 ? `${Math.round((100 * m) / a)}%` : '–');
  const status = state.ejected ? 'Ejected' : state.fouledOut ? 'Fouled out' : onCourt ? 'On court' : 'On the bench';
  return (
    <div className="pcard" style={{ left, top, width: CARD_W, ['--team' as string]: colour }}>
      <div className="pcard-head">
        <Portrait player={player} side={side} size={58} number={false} />
        <div className="pcard-who">
          <div className="pcard-name">
            <span className="pcard-no">#{player.number}</span> {player.name}
          </div>
          <div className="pcard-meta">
            {player.position} · {player.archetype}
          </div>
          <div className="pcard-meta">
            {player.heightCm} cm · {player.weightKg} kg{own && <> · Overall {Math.round(c.overall)}</>}
          </div>
        </div>
      </div>
      <div className="pcard-status">
        <span>{status}</span>
        <span>Energy {Math.round(state.energy)}%</span>
        <span>
          Fouls {state.fouls}
          {state.technicals > 0 && <span className="bad"> +T</span>}
        </span>
        <span>{Math.floor(s.seconds / 60)} min</span>
      </div>
      <div className="pcard-section">Tonight</div>
      <div className="pcard-tiles">
        <div className="pcard-tile">
          <RatingBadge r={playerRating(s)} />
          <span>RTG</span>
        </div>
        {[
          [s.pts, 'PTS'],
          [s.oreb + s.dreb, 'REB'],
          [s.ast, 'AST'],
          [s.stl, 'STL'],
          [s.blk, 'BLK'],
          [s.tov, 'TO'],
        ].map(([v, l]) => (
          <div key={l} className="pcard-tile">
            <b>{v}</b>
            <span>{l}</span>
          </div>
        ))}
      </div>
      <div className="pcard-shooting">
        <span>
          FG <b>{s.fgm}-{s.fga}</b> <i>{pct(s.fgm, s.fga)}</i>
        </span>
        <span>
          3P <b>{s.tpm}-{s.tpa}</b> <i>{pct(s.tpm, s.tpa)}</i>
        </span>
        <span>
          FT <b>{s.ftm}-{s.fta}</b> <i>{pct(s.ftm, s.fta)}</i>
        </span>
        <span>
          +/- <b>{s.plusMinus > 0 ? '+' : ''}{s.plusMinus}</b>
        </span>
      </div>
      {own ? (
        <>
          <div className="pcard-section">Ratings</div>
          <div className="pcard-ratings">
            {RATINGS.map(({ key, label }) => (
              <div key={key} className="pcard-rating">
                <span>{label}</span>
                <span className="pcard-bar">
                  <span style={{ width: `${Math.max(0, Math.min(100, c[key]))}%`, background: ratingColour(c[key]).replace('0.35)', '0.9)') }} />
                </span>
                <b>{Math.round(c[key])}</b>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="pcard-note">His ratings: see the scouting report.</div>
      )}
    </div>
  );
}
