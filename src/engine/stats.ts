// Stat bookkeeping and box score assembly.

import { other, playerOf } from './state';
import type { MatchState, Player, PlayerStats, Side, TeamExtras } from './types';

export function emptyStats(): PlayerStats {
  return {
    seconds: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, plusMinus: 0,
  };
}

export function emptyExtras(): TeamExtras {
  return { possessions: 0, paintPts: 0, fastBreakPts: 0, secondChancePts: 0 };
}

/** Adds points to the score, the scorer, the quarter line and everyone's plus/minus. */
export function addPoints(s: MatchState, side: Side, scorerId: string, pts: number): void {
  const team = s.teams[side];
  team.score += pts;
  team.players[scorerId].stats.pts += pts;
  team.quarterPoints[s.quarter - 1] = (team.quarterPoints[s.quarter - 1] ?? 0) + pts;
  for (const id of team.lineup) team.players[id].stats.plusMinus += pts;
  for (const id of s.teams[other(side)].lineup) s.teams[other(side)].players[id].stats.plusMinus -= pts;
  const swing = pts * 0.035 * (side === 0 ? 1 : -1);
  s.momentum = Math.max(-1, Math.min(1, s.momentum + swing));
}

export interface PlayerLine {
  player: Player;
  starter: boolean;
  stats: PlayerStats;
}

export interface TeamBox {
  name: string;
  abbr: string;
  score: number;
  quarterPoints: number[];
  players: PlayerLine[];
  totals: PlayerStats;
  extras: TeamExtras;
}

export interface BoxScore {
  teams: [TeamBox, TeamBox];
  winner: Side | null;
}

export function buildBoxScore(s: MatchState): BoxScore {
  const teams = ([0, 1] as const).map((side): TeamBox => {
    const t = s.teams[side];
    const ids = [...t.plan.starters, ...t.team.players.map((p) => p.id).filter((id) => !t.plan.starters.includes(id))];
    const players = ids.map((id) => ({
      player: playerOf(s, side, id),
      starter: t.plan.starters.includes(id),
      stats: { ...t.players[id].stats },
    }));
    const totals = emptyStats();
    for (const line of players) {
      for (const key of Object.keys(totals) as (keyof PlayerStats)[]) totals[key] += line.stats[key];
    }
    totals.plusMinus = t.score - s.teams[other(side)].score;
    return {
      name: t.team.name,
      abbr: t.team.abbr,
      score: t.score,
      quarterPoints: [...t.quarterPoints],
      players,
      totals,
      extras: { ...t.extras },
    };
  }) as [TeamBox, TeamBox];
  const [h, a] = [s.teams[0].score, s.teams[1].score];
  return { teams, winner: !s.finished || h === a ? null : h > a ? 0 : 1 };
}

/** Simple efficiency score (a "game score"): points plus everything else a player did, minus misses and mistakes. */
export function gameScore(s: PlayerStats): number {
  return s.pts + 0.4 * s.fgm - 0.7 * s.fga - 0.4 * (s.fta - s.ftm) + 0.7 * s.oreb + 0.3 * s.dreb + s.stl + 0.7 * s.ast + 0.7 * s.blk - s.tov - 0.4 * s.pf;
}

/** Football-Manager-style match rating, 1–10 (6 = average). Null until a player has played two minutes. */
export function playerRating(s: PlayerStats): number | null {
  const minutes = s.seconds / 60;
  if (minutes < 2) return null;
  const expected = minutes * 0.3;
  const r = 6 + (gameScore(s) - expected) / 4;
  return Math.max(1, Math.min(10, Math.round(r * 10) / 10));
}
