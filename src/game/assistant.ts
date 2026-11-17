// The assistant coach's live tips: short observations about what is (not) working.
// Phase 4 will make their clarity depend on the Assistant/Scout coach.

import { composite } from '../engine/ratings';
import { other, playerOf } from '../engine/state';
import type { MatchState, Side } from '../engine/types';
import { DOUBLE_WORTH, doubleTeamWorth, recentBreakdown, unansweredRun } from './ai';

export interface Tip {
  id: number;
  side: Side;
  /** What it is about (e.g. 'run', 'tired-them-ham-4'): to check later whether it still holds. */
  key: string;
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
  const tips: Tip[] = [];
  for (const side of [0, 1] as const) {
    for (const [key, text, step] of candidates(s, memory, side)) {
      if (!text) continue;
      // The same subject may be raised again sooner once it has moved on a step (more points, a fifth foul).
      const fullKey = `${side}:${key}${step !== undefined ? `#${step}` : ''}`;
      if (memory.lastSaid[fullKey] !== undefined && now - memory.lastSaid[fullKey] < COOLDOWN) continue;
      memory.lastSaid[fullKey] = now;
      tips.push({ id: memory.nextId++, side, key, text, quarter: s.quarter, clock: s.clock });
      break;
    }
  }
  return tips;
}

/** How long a tip stays in view (game seconds), as long as it still holds. */
export const TIP_FRESH_S = 300;

/**
 * The tips to show now: given in the last five minutes of play, and still true at this
 * moment, in today's words (a run that has been answered is gone; a tired player's energy is the
 * one he has now). Newest first.
 */
export function currentTips(s: MatchState, memory: TipMemory, tips: readonly Tip[], side: Side): Tip[] {
  const now = new Map(candidates(s, memory, side).map(([key, text]) => [key, text]));
  const elapsed = (t: Tip) => (s.quarter - t.quarter) * 720 + (t.clock - s.clock);
  const out: Tip[] = [];
  for (const t of tips) {
    if (t.side !== side || elapsed(t) > TIP_FRESH_S) continue;
    const text = now.get(t.key);
    if (text && !out.some((o) => o.key === t.key)) out.push({ ...t, text });
  }
  return out;
}

/** Everything the assistant could say about one side right now: [what it is about, the words, or null if it does not hold]. */
/** [what it is about, the words or null, a step: the same subject raised again when it moves on]. */
type Candidate = [string, string | null, number?];

function candidates(s: MatchState, memory: TipMemory, side: Side): Candidate[] {
  const now = memory.possessionStarts.length;
  const windowFrom = memory.possessionStarts[Math.max(0, now - WINDOW)] ?? 0;
  {
    const opp = other(side);
    const team = s.teams[side];
    const them = s.teams[opp];
    const theirRecent = recentBreakdown(s, opp, s.events.length, windowFrom);
    const ourRecent = recentBreakdown(s, side, s.events.length, windowFrom);
    const name = (sd: Side, id: string) => playerOf(s, sd, id).name;

    const list: Candidate[] = [];

    const run = unansweredRun(s, side);
    list.push(['run', run >= 8 ? `They're on a ${run}-0 run. A timeout would stop the bleeding.` : null]);

    for (const id of them.lineup) {
      const e = them.players[id].energy;
      list.push([`tired-them-${id}`, e < 50 ? `Their ${name(opp, id)} is running on fumes (${Math.round(e)}%). Attack that matchup.` : null]);
    }
    for (const id of team.lineup) {
      const e = team.players[id].energy;
      list.push([`tired-us-${id}`, e < 45 ? `${name(side, id)} is exhausted (${Math.round(e)}%). Consider a sub at the next stoppage.` : null]);
      const f = team.players[id].fouls;
      list.push([`fouls-${id}`, f >= 4 ? `${name(side, id)} has ${f} fouls. One more and it gets dangerous.` : null, f]);
    }

    if (team.plan.defence === 'zone') {
      const paintShare = theirRecent.pts > 0 ? theirRecent.paint / theirRecent.pts : 0;
      list.push(['zone-works', theirRecent.pts >= 8 && paintShare < 0.3 ? 'The zone is working: they can\'t get anything inside.' : null]);
      list.push([
        'zone-shot',
        theirRecent.threesTried >= 5 && theirRecent.threesMade / theirRecent.threesTried >= 0.45
          ? `They're carving up the zone from three (${theirRecent.threesMade}/${theirRecent.threesTried}). Man-to-man closes out better.`
          : null,
      ]);
    } else {
      list.push([
        'hot-three',
        theirRecent.threesTried >= 6 && theirRecent.threesMade / theirRecent.threesTried >= 0.5
          ? `They're red hot from deep (${theirRecent.threesMade}/${theirRecent.threesTried} lately).`
          : null,
      ]);
      const paintShare = theirRecent.pts > 0 ? theirRecent.paint / theirRecent.pts : 0;
      list.push(['paint', theirRecent.pts >= 12 && paintShare > 0.65 ? 'They\'re living in the paint. A zone would clog the lane.' : null]);
    }

    if (team.plan.defence === 'press') {
      list.push(['press-works', theirRecent.turnovers >= 4 ? `The press is working: ${theirRecent.turnovers} turnovers forced lately.` : null]);
      list.push(['press-beaten', theirRecent.pressBroken >= 3 ? 'They keep breaking the press for easy layups.' : null]);
    }
    if (them.plan.defence === 'press') {
      list.push(['vs-press', ourRecent.turnovers >= 4 ? 'Their press is rattling us. Better ball handlers on court would help.' : null]);
    }
    if (them.plan.defence === 'zone' && ourRecent.threesTried >= 4) {
      const pct = ourRecent.threesMade / ourRecent.threesTried;
      list.push(['vs-zone', pct >= 0.45 ? 'Their zone is leaving shooters open. Keep firing!' : null]);
    }
    if (team.plan.offence === 'three' && ourRecent.threesTried >= 8 && ourRecent.threesMade / ourRecent.threesTried < 0.25) {
      list.push(['cold', `We're ice cold from three (${ourRecent.threesMade}/${ourRecent.threesTried}). Maybe attack inside.`]);
    }

    // Their go-to scorer.
    const star = [...them.lineup].sort((a, b) => them.players[b].stats.pts - them.players[a].stats.pts)[0];
    const starPts = them.players[star].stats.pts;
    // By the time played, so that at half-time (the clock already on the third quarter) it is still the first half's bar.
    const played = (s.quarter - 1) * 720 + (720 - s.clock);
    const threshold = played <= 1440 ? 16 : 26;
    // Whether a double on him would pay: only on a scorer who cannot pass, without shooters round him.
    const five = them.lineup.map((id) => playerOf(s, opp, id));
    const worth = doubleTeamWorth(playerOf(s, opp, star), five);
    if (team.plan.keyMatchup.kind !== 'double' && starPts >= threshold) {
      list.push([
        `star-${star}`,
        worth > DOUBLE_WORTH
          ? `${name(opp, star)} already has ${starPts} points, and he can't pass out of a trap. A double team would slow him down.`
          : `${name(opp, star)} already has ${starPts} points, but doubling him would only free their shooters: he finds the open man.`,
        Math.floor(starPts / 8),
      ]);
    }
    const km = team.plan.keyMatchup;
    if (km.kind === 'double' && them.lineup.includes(km.targetId)) {
      const doubledWorth = doubleTeamWorth(playerOf(s, opp, km.targetId), five);
      if (doubledWorth < 0) list.push([`bad-double-${km.targetId}`, `Our double on ${name(opp, km.targetId)} is costing us: he passes out of it and they get open looks. Guard him straight up.`]);
    }

    // Glass.
    const ourOreb = Object.values(team.players).reduce((n, p) => n + p.stats.oreb, 0);
    const theirOreb = Object.values(them.players).reduce((n, p) => n + p.stats.oreb, 0);
    if (s.quarter >= 2 && ourOreb - theirOreb >= 6 && team.plan.offence !== 'inside') {
      list.push(['boards', `We own the offensive glass (${ourOreb}-${theirOreb}). An inside focus could cash in.`]);
    }

    // Matchup: their best big is slow and we have a quick guard.
    const bigs = them.lineup.slice(3);
    const slowBig = bigs.find((id) => playerOf(s, opp, id).attrs.speed < 55);
    const quickGuard = team.lineup.slice(0, 2).find((id) => playerOf(s, side, id).attrs.speed >= 85 && composite(playerOf(s, side, id)).playmaking >= 70);
    if (slowBig && quickGuard && team.plan.offence !== 'pickAndRoll' && them.plan.defence === 'man') {
      list.push([`pnr`, `Their ${name(opp, slowBig)} can't keep up in space. Run pick-and-roll with ${name(side, quickGuard)}.`]);
    }

    return list;
  }
}
