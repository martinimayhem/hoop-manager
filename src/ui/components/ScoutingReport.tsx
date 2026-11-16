// Pre-match report on the opponent: fuzzy ratings and a guess at their game plan.

import { composite } from '../../engine/ratings';
import type { Side, Team } from '../../engine/types';
import { scoutedTendencies } from '../../game/ai';
import { poolById } from '../../game/pool';
import { ATTRIBUTE_GROUPS, DEFAULT_SCOUT_ACCURACY, potentialStars, scoutGroup } from '../../game/scouting';
import { DEFENCE_INFO, OFFENCE_INFO, TEMPO_INFO } from '../labels';
import { ProbBars, RangeCell, Stars } from './common';
import { Portrait, ShirtNumber } from './Portrait';

const HYPE_FALLBACK = 50;

/** How well the opponent is known: in a league, ranges narrow each time you have played them (never below `minHalf`). */
export interface ScoutView {
  accuracy: number;
  minHalf: number;
  /** Players' reputations (a league's own pool); default: the single-match market's. */
  hypes?: Map<string, number>;
}

export function ScoutingReport({ opponent, us, side, scout }: { opponent: Team; us: Team; /** The opponent's kit. */ side?: Side; scout?: ScoutView }) {
  const pool = poolById();
  const hype = (id: string) => scout?.hypes?.get(id) ?? pool.get(id)?.hype ?? HYPE_FALLBACK;
  const accuracy = scout?.accuracy ?? DEFAULT_SCOUT_ACCURACY;
  const minHalf = scout?.minHalf ?? 0;
  const t = scoutedTendencies(opponent, us, accuracy);
  const players = [...opponent.players].sort((a, b) => composite(b).overall - composite(a).overall);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="muted small">Ranges are your scout's estimates. Famous players are easy to read; unknowns could surprise you.</div>
      <div>
        <table className="brk-table scout-table">
          <thead>
            <tr>
              <th className="left">Player</th>
              <th className="left">Pos</th>
              <th>Ht</th>
              <th>Wt</th>
              {ATTRIBUTE_GROUPS.map((g) => (
                <th key={g.key}>{g.label}</th>
              ))}
              <th>Pot.</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td className="left">
                  <span className="player-cell">
                    <Portrait player={p} side={side} size={24} />
                    <ShirtNumber player={p} side={side} />
                    <span className="brk-name" title={p.archetype}>
                      {p.name}
                    </span>
                  </span>
                </td>
                <td className="left">{p.position}</td>
                <td>{p.heightCm}</td>
                <td>{p.weightKg}</td>
                {ATTRIBUTE_GROUPS.map((g) => (
                  <td key={g.key}>
                    <RangeCell r={scoutGroup(p, g, hype(p.id), accuracy, minHalf)} />
                  </td>
                ))}
                <td>
                  <Stars n={potentialStars(p, accuracy)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h3>Likely offence</h3>
          <ProbBars dist={t.offence} labels={OFFENCE_INFO} />
        </div>
        <div style={{ flex: 1 }}>
          <h3>Likely defence</h3>
          <ProbBars dist={t.defence} labels={DEFENCE_INFO} />
          <h3 style={{ marginTop: 8 }}>Likely tempo</h3>
          <ProbBars dist={t.tempo} labels={TEMPO_INFO} />
        </div>
      </div>
    </div>
  );
}
