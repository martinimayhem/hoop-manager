// Pre-match report on the opponent: fuzzy ratings and a guess at their game plan.

import { composite } from '../../engine/ratings';
import type { Player, Side, Team } from '../../engine/types';
import { scoutedTendencies } from '../../game/ai';
import { poolById } from '../../game/pool';
import { ATTRIBUTE_GROUPS, DEFAULT_SCOUT_ACCURACY, potentialStars, scoutGroup } from '../../game/scouting';
import { DEFENCE_INFO, OFFENCE_INFO, TEMPO_INFO } from '../labels';
import { ProbBars, RangeCell, Stars } from './common';
import { Portrait, ShirtNumber } from './Portrait';
import { useSort } from './sortable';

const HYPE_FALLBACK = 50;

/** How well the opponent is known: in a league, ranges narrow each time you have played them (never below `minHalf`). */
export interface ScoutView {
  accuracy: number;
  minHalf: number;
  /** Players' reputations (a league's own pool); default: the single-match market's. */
  hypes?: Map<string, number>;
}

export function ScoutingReport({ opponent, us, side, scout, section = 'all' }: { opponent: Team; us: Team; /** The opponent's kit. */ side?: Side; scout?: ScoutView; /** Their players, their likely tactics, or both. */ section?: 'players' | 'tendencies' | 'all' }) {
  const pool = poolById();
  const hype = (id: string) => scout?.hypes?.get(id) ?? pool.get(id)?.hype ?? HYPE_FALLBACK;
  const accuracy = scout?.accuracy ?? DEFAULT_SCOUT_ACCURACY;
  const minHalf = scout?.minHalf ?? 0;
  const t = scoutedTendencies(opponent, us, accuracy);
  const sorter = useSort<Player>((p, key) => {
    if (key === 'name') return p.name;
    if (key === 'pos') return -['PG', 'SG', 'SF', 'PF', 'C'].indexOf(p.position);
    if (key === 'ht') return p.heightCm;
    if (key === 'wt') return p.weightKg;
    if (key === 'pot') return potentialStars(p, accuracy);
    const g = ATTRIBUTE_GROUPS.find((x) => x.key === key);
    if (!g) return null;
    const r = scoutGroup(p, g, hype(p.id), accuracy, minHalf);
    return (r.lo + r.hi) / 2;
  });
  const players = sorter.sorted([...opponent.players].sort((a, b) => composite(b).overall - composite(a).overall));
  return (
    <div className="scout-report">
      {section !== 'tendencies' && (<>
      <div className="muted small">Ranges are your scout's estimates: famous players are easy to read, unknowns could surprise you.</div>
      <div>
        <table className="brk-table scout-table eq">
          <thead>
            <tr>
              {sorter.th('name', 'Player', { left: true, wide: true })}
              {sorter.th('pos', 'Pos', { tip: 'Position' })}
              {sorter.th('ht', 'Ht', { tip: 'Height (cm)' })}
              {sorter.th('wt', 'Wt', { tip: 'Weight (kg)' })}
              {ATTRIBUTE_GROUPS.map((g) => sorter.th(g.key, g.short, { tip: g.label }))}
              {sorter.th('pot', 'Pot.', { tip: 'Development potential (scout estimate)' })}
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
                <td>{p.position}</td>
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
      </>)}
      {section !== 'players' && (
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
      )}
    </div>
  );
}
