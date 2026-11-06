// The assistant coach's live tips: short observations about what is (not) working.
// Phase 4 will make their clarity depend on the Assistant/Scout coach.

import { composite } from '../engine/ratings';
import { other, playerOf } from '../engine/state';
import type { MatchState, Side } from '../engine/types';
import { recentBreakdown, unansweredRun } from './ai';

export interface Tip {
  id: number;
  side: Side;
  text: string;
  quarter: number;
  clock: number;
}

/** Remembers which tips were given recently so the feed doesn't repeat itself. */
export interface TipMemory {
  lastSaid: Record<string, number>; // key → possession count when last said
  possessionStarts: number[]; // event index at the start of each possession
  nextId: number;
}

export function createTipMemory(): TipMemory {
  return { lastSaid: {}, possessionStarts: [], nextId: 1 };
}

const COOLDOWN = 40; // possessions (both teams) before the same tip may repeat
const WINDOW = 20; // possessions (both teams) a "recent" stat looks back over

/** Call once after every possession. Returns at most one new tip per side. */
export function assistantTips(s: MatchState, memory: TipMemory): Tip[] {
  memory.possessionStarts.push(s.events.length);
  const now = memory.possessionStarts.length;
  const windowFrom = memory.possessionStarts[Math.max(0, now - WINDOW)] ?? 0;
  const tips: Tip[] = [];

  for (const side of [0, 1] as const) {
    const opp = other(side);
    const team = s.teams[side];
    const them = s.teams[opp];
    const theirRecent = recentBreakdown(s, opp, s.events.length, windowFrom);
    const ourRecent = recentBreakdown(s, side, s.events.length, windowFrom);
    const name = (sd: Side, id: string) => playerOf(s, sd, id).name;

    const candidates: [string, string | null][] = [];

    const run = unansweredRun(s, side);
    candidates.push(['run', run >= 8 ? `They're on a ${run}-0 run. A timeout would stop the bleeding.` : null]);

    for (const id of them.lineup) {
      const e = them.players[id].energy;
      candidates.push([`tired-them-${id}`, e < 50 ? `Their ${name(opp, id)} is running on fumes (${Math.round(e)}%). Attack that matchup.` : null]);
    }
    for (const id of team.lineup) {
      const e = team.players[id].energy;
      candidates.push([`tired-us-${id}`, e < 45 ? `${name(side, id)} is exhausted (${Math.round(e)}%). Consider a sub at the next stoppage.` : null]);
      const f = team.players[id].fouls;
      candidates.push([`fouls-${id}-${f}`, f >= 4 ? `${name(side, id)} has ${f} fouls. One more and it gets dangerous.` : null]);
    }

    if (team.plan.defence === 'zone') {
      const paintShare = theirRecent.pts > 0 ? theirRecent.paint / theirRecent.pts : 0;
      candidates.push(['zone-works', theirRecent.pts >= 8 && paintShare < 0.3 ? 'The zone is working: they can\'t get anything inside.' : null]);
      candidates.push([
        'zone-shot',
        theirRecent.threesTried >= 5 && theirRecent.threesMade / theirRecent.threesTried >= 0.45
          ? `They're carving up the zone from three (${theirRecent.threesMade}/${theirRecent.threesTried}). Man-to-man closes out better.`
          : null,
      ]);
    } else {
      candidates.push([
        'hot-three',
        theirRecent.threesTried >= 6 && theirRecent.threesMade / theirRecent.threesTried >= 0.5
          ? `They're red hot from deep (${theirRecent.threesMade}/${theirRecent.threesTried} lately).`
          : null,
      ]);
      const paintShare = theirRecent.pts > 0 ? theirRecent.paint / theirRecent.pts : 0;
      candidates.push(['paint', theirRecent.pts >= 12 && paintShare > 0.65 ? 'They\'re living in the paint. A zone would clog the lane.' : null]);
    }

    if (team.plan.defence === 'press') {
      candidates.push(['press-works', theirRecent.turnovers >= 4 ? `The press is working: ${theirRecent.turnovers} turnovers forced lately.` : null]);
      candidates.push(['press-beaten', theirRecent.pressBroken >= 3 ? 'They keep breaking the press for easy layups.' : null]);
    }
    if (them.plan.defence === 'press') {
      candidates.push(['vs-press', ourRecent.turnovers >= 4 ? 'Their press is rattling us. Better ball handlers on court would help.' : null]);
    }
    if (them.plan.defence === 'zone' && ourRecent.threesTried >= 4) {
      const pct = ourRecent.threesMade / ourRecent.threesTried;
      candidates.push(['vs-zone', pct >= 0.45 ? 'Their zone is leaving shooters open. Keep firing!' : null]);
    }
    if (team.plan.offence === 'three' && ourRecent.threesTried >= 8 && ourRecent.threesMade / ourRecent.threesTried < 0.25) {
      candidates.push(['cold', `We're ice cold from three (${ourRecent.threesMade}/${ourRecent.threesTried}). Maybe attack inside.`]);
    }

    // Their go-to scorer.
    const star = [...them.lineup].sort((a, b) => them.players[b].stats.pts - them.players[a].stats.pts)[0];
    const starPts = them.players[star].stats.pts;
    const threshold = s.quarter <= 2 ? 16 : 26;
    if (team.plan.keyMatchup.kind !== 'double' && starPts >= threshold) {
      candidates.push([`star-${star}-${Math.floor(starPts / 8)}`, `${name(opp, star)} already has ${starPts} points. A double team could slow that down.`]);
    }

    // Glass.
    const ourOreb = Object.values(team.players).reduce((n, p) => n + p.stats.oreb, 0);
    const theirOreb = Object.values(them.players).reduce((n, p) => n + p.stats.oreb, 0);
    if (s.quarter >= 2 && ourOreb - theirOreb >= 6 && team.plan.offence !== 'inside') {
      candidates.push(['boards', `We own the offensive glass (${ourOreb}-${theirOreb}). An inside focus could cash in.`]);
    }

    // Matchup: their best big is slow and we have a quick guard.
    const bigs = them.lineup.slice(3);
    const slowBig = bigs.find((id) => playerOf(s, opp, id).attrs.speed < 55);
    const quickGuard = team.lineup.slice(0, 2).find((id) => playerOf(s, side, id).attrs.speed >= 85 && composite(playerOf(s, side, id)).playmaking >= 70);
    if (slowBig && quickGuard && team.plan.offence !== 'pickAndRoll' && them.plan.defence === 'man') {
      candidates.push([`pnr`, `Their ${name(opp, slowBig)} can't keep up in space. Run pick-and-roll with ${name(side, quickGuard)}.`]);
    }

    for (const [key, text] of candidates) {
      if (!text) continue;
      const fullKey = `${side}:${key}`;
      if (memory.lastSaid[fullKey] !== undefined && now - memory.lastSaid[fullKey] < COOLDOWN) continue;
      memory.lastSaid[fullKey] = now;
      tips.push({ id: memory.nextId++, side, text, quarter: s.quarter, clock: s.clock });
      break;
    }
  }
  return tips;
}
