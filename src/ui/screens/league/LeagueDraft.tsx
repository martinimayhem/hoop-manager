// The Quick League's snake draft: all 8 teams, 12 rounds (1→8, then 8→1). The computer teams pick
// at once; a human picks on his turn. The market shows scouted ranges, as in the single-match draft.

import { useMemo, useState } from 'react';
import { composite, positionGroup } from '../../../engine/ratings';
import type { Position } from '../../../engine/types';
import { canPick, currentTurn, groupCounts, ROSTER_SIZE } from '../../../game/draft';
import { leaguePool } from '../../../game/league/leagues';
import { draftOf, humanPick, type QuickLeague } from '../../../game/league/quickLeague';
import { ATTRIBUTE_GROUPS, DEFAULT_SCOUT_ACCURACY, scoutGroup } from '../../../game/scouting';
import { RangeCell } from '../../components/common';

const POSITIONS: (Position | 'all')[] = ['all', 'PG', 'SG', 'SF', 'PF', 'C'];

export function LeagueDraft({ league, onChange, onMenu }: { league: QuickLeague; onChange: (q: QuickLeague) => void; onMenu: () => void }) {
  const d = draftOf(league);
  const pool = leaguePool(league.league);
  const turn = currentTurn(d);
  const human = turn !== null && league.teams[turn].human !== null ? turn : null;
  // Whose roster is shown: the human picking now, else the first human.
  const shown = human ?? league.teams.findIndex((t) => t.human !== null);
  const [pos, setPos] = useState<Position | 'all'>('all');
  const [sort, setSort] = useState<'price' | 'name'>('price');
  const [sel, setSel] = useState<string | null>(null);

  const rows = useMemo(() => {
    const free = pool.filter((p) => !(p.player.id in d.owner) && (pos === 'all' || p.player.position === pos));
    return free.sort((a, b) => (sort === 'price' ? b.price - a.price || a.player.name.localeCompare(b.player.name) : a.player.name.localeCompare(b.player.name)));
  }, [pool, d.owner, pos, sort]);

  const order = useMemo(() => {
    // The next 8 picks, to show who is coming.
    const n = d.teams.length;
    const out: number[] = [];
    for (let k = d.pickNo; k < Math.min(n * ROSTER_SIZE, d.pickNo + 8); k++) {
      const round = Math.floor(k / n);
      out.push(d.order[round % 2 === 0 ? k % n : n - 1 - (k % n)]);
    }
    return out;
  }, [d]);

  const team = d.teams[shown];
  const counts = groupCounts(d, shown);
  const check = human !== null && sel ? canPick(d, human, sel) : null;
  const doPick = () => {
    if (human === null || !sel || !check?.ok) return;
    onChange(humanPick(league, sel));
    setSel(null);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <button onClick={onMenu}>☰ Menu</button>
        <h1 style={{ margin: 0 }}>
          {human !== null ? (
            <>
              <span className={league.teams[human].human === 0 ? 'home' : 'away'}>{league.teams[human].name}</span>: your pick
            </>
          ) : (
            'Draft'
          )}
        </h1>
        <span className="muted">
          Pick {Math.min(d.pickNo + 1, d.teams.length * ROSTER_SIZE)} of {d.teams.length * ROSTER_SIZE} · round {Math.floor(d.pickNo / d.teams.length) + 1} of {ROSTER_SIZE}
        </span>
        <div className="spacer" />
        <span className="muted small">Next:</span>
        {order.map((t, i) => (
          <span key={i} className={league.teams[t].human === null ? 'muted small' : league.teams[t].human === 0 ? 'home small' : 'away small'}>
            {league.teams[t].abbr}
          </span>
        ))}
      </div>

      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="panel" style={{ flex: '2 1 560px' }}>
          <div className="row">
            <h3 style={{ margin: 0 }}>Market</h3>
            {POSITIONS.map((p) => (
              <button key={p} className={pos === p ? 'active small' : 'small'} onClick={() => setPos(p)}>
                {p === 'all' ? 'All' : p}
              </button>
            ))}
            <div className="spacer" />
            <button className={sort === 'price' ? 'active small' : 'small'} onClick={() => setSort('price')}>
              By price
            </button>
            <button className={sort === 'name' ? 'active small' : 'small'} onClick={() => setSort('name')}>
              By name
            </button>
          </div>
          <div style={{ maxHeight: '62vh', overflowY: 'auto', marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th className="left">Player</th>
                  <th>Pos</th>
                  {ATTRIBUTE_GROUPS.map((g) => (
                    <th key={g.key}>{g.label}</th>
                  ))}
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.player.id} className="clickable" onClick={() => setSel(p.player.id)} style={sel === p.player.id ? { outline: '2px solid var(--home)' } : undefined}>
                    <td className="left">
                      <b>{p.player.name}</b> <span className="muted small">{p.player.archetype}</span>
                    </td>
                    <td>{p.player.position}</td>
                    {ATTRIBUTE_GROUPS.map((g) => (
                      <td key={g.key}>
                        <RangeCell r={scoutGroup(p.player, g, p.hype, DEFAULT_SCOUT_ACCURACY)} />
                      </td>
                    ))}
                    <td className="price">{p.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {human !== null && (
            <div className="row" style={{ marginTop: 10 }}>
              <span className="muted">{sel ? (check?.ok ? `Draft ${pool.find((p) => p.player.id === sel)?.player.name}?` : check?.reason) : 'Pick a player from the market.'}</span>
              <div className="spacer" />
              <button className="primary" disabled={!check?.ok} onClick={doPick}>
                Draft ▶
              </button>
            </div>
          )}
        </div>

        <div className="panel" style={{ flex: '1 1 300px' }}>
          <h3>
            {team.name}: {team.picks.length}/{ROSTER_SIZE}
          </h3>
          <div className="muted small">
            {team.budgetLeft} credits left · guards {counts.guard}, wings {counts.wing}, bigs {counts.big} (at least 2 of each)
          </div>
          <table style={{ marginTop: 8 }}>
            <tbody>
              {team.picks.map((id) => {
                const p = pool.find((x) => x.player.id === id)!;
                return (
                  <tr key={id}>
                    <td className="left">{p.player.name}</td>
                    <td>{p.player.position}</td>
                    <td className="muted small">{positionGroup(p.player.position)}</td>
                    <td className="price">{p.price}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h3 style={{ marginTop: 14 }}>The other teams</h3>
          <table>
            <tbody>
              {d.teams.map((t, i) =>
                i === shown ? null : (
                  <tr key={i}>
                    <td className="left">{t.name}</td>
                    <td className="muted small">{t.picks.length}/{ROSTER_SIZE}</td>
                    <td className="muted small">{t.budgetLeft} left</td>
                    <td className="muted small">
                      best:{' '}
                      {t.picks.length
                        ? pool
                            .filter((p) => t.picks.includes(p.player.id))
                            .sort((a, b) => composite(b.player).overall - composite(a.player).overall)[0]?.player.name
                        : '–'}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
