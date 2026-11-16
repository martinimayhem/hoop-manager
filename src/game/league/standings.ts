// The table (SEASON_SPEC R2.5), always worked out from the game records, never kept separately.
// Ranked by wins; ties broken by head-to-head wins among the tied teams, then point difference in
// those games, then overall point difference, then points scored, then team id: a last step that
// can never tie, so the same results always give the same table, whatever order they came in.

export interface GameRecord {
  matchday: number;
  home: number;
  away: number;
  seed: number;
  /** Home score, away score. */
  score: [number, number];
  overtime: boolean;
  /** Each side's player lines: [player id, seconds, points, rebounds, assists, steals, blocks, turnovers, fouls]. */
  lines: [PlayerLineRecord[], PlayerLineRecord[]];
}

export type PlayerLineRecord = [string, number, number, number, number, number, number, number, number];

export interface TableRow {
  team: number;
  played: number;
  won: number;
  lost: number;
  pct: number;
  /** Games behind the leader. */
  behind: number;
  pf: number;
  pa: number;
  diff: number;
  /** Last five results, oldest first ('W' or 'L'). */
  last5: string[];
  /** e.g. "W3"; empty before any game. */
  streak: string;
}

/** `teamIds`: each team's id, by index (the last tiebreaker). */
export function standings(teamIds: readonly string[], records: readonly GameRecord[]): TableRow[] {
  const n = teamIds.length;
  const rows: TableRow[] = teamIds.map((_, team) => ({ team, played: 0, won: 0, lost: 0, pct: 0, behind: 0, pf: 0, pa: 0, diff: 0, last5: [], streak: '' }));
  const results: string[][] = teamIds.map(() => []);
  const ordered = [...records].sort((a, b) => a.matchday - b.matchday);
  for (const g of ordered) {
    const [hs, as] = g.score;
    const sides: [number, number, number, number][] = [
      [g.home, hs, as, hs > as ? 1 : 0],
      [g.away, as, hs, as > hs ? 1 : 0],
    ];
    for (const [t, pf, pa, won] of sides) {
      const r = rows[t];
      r.played++;
      r.pf += pf;
      r.pa += pa;
      if (won) r.won++;
      else r.lost++;
      results[t].push(won ? 'W' : 'L');
    }
  }
  for (const r of rows) {
    r.diff = r.pf - r.pa;
    r.pct = r.played ? r.won / r.played : 0;
    const res = results[r.team];
    r.last5 = res.slice(-5);
    if (res.length) {
      const lastResult = res[res.length - 1];
      let k = 0;
      for (let i = res.length - 1; i >= 0 && res[i] === lastResult; i--) k++;
      r.streak = `${lastResult}${k}`;
    }
  }
  // Head to head among a group of tied teams: wins and point difference in their games with each other.
  const h2h = (group: Set<number>) => {
    const out = new Map<number, { wins: number; diff: number }>();
    for (const t of group) out.set(t, { wins: 0, diff: 0 });
    for (const g of records) {
      if (!group.has(g.home) || !group.has(g.away)) continue;
      const [hs, as] = g.score;
      out.get(g.home)!.wins += hs > as ? 1 : 0;
      out.get(g.away)!.wins += as > hs ? 1 : 0;
      out.get(g.home)!.diff += hs - as;
      out.get(g.away)!.diff += as - hs;
    }
    return out;
  };
  const byWins = new Map<number, TableRow[]>();
  for (const r of rows) byWins.set(r.won, [...(byWins.get(r.won) ?? []), r]);
  const sorted: TableRow[] = [];
  for (const wins of [...byWins.keys()].sort((a, b) => b - a)) {
    const group = byWins.get(wins)!;
    const hh = h2h(new Set(group.map((r) => r.team)));
    group.sort((a, b) => {
      const ha = hh.get(a.team)!;
      const hb = hh.get(b.team)!;
      return hb.wins - ha.wins || hb.diff - ha.diff || b.diff - a.diff || b.pf - a.pf || (teamIds[a.team] < teamIds[b.team] ? -1 : teamIds[a.team] > teamIds[b.team] ? 1 : a.team - b.team);
    });
    sorted.push(...group);
  }
  const lead = sorted[0];
  for (const r of sorted) r.behind = n ? (lead.won - r.won + (r.lost - lead.lost)) / 2 : 0;
  return sorted;
}
