// Halftime team talk. What works depends on the scoreboard: praise a team that's cruising,
// demand more from one that's behind, fire up a team in a close game. Get it wrong and it backfires.

import type { MatchState, Side } from '../engine/types';

export type Talk = 'praise' | 'demand' | 'calm' | 'fireUp';

export const TALKS: { talk: Talk; icon: string; label: string; line: string }[] = [
  { talk: 'praise', icon: '👏', label: 'Praise', line: '"Great half, keep doing exactly this."' },
  { talk: 'demand', icon: '😤', label: 'Demand more', line: '"That\'s not good enough. I want more effort."' },
  { talk: 'calm', icon: '🧘', label: 'Calm down', line: '"Deep breath. Stick to the plan, one possession at a time."' },
  { talk: 'fireUp', icon: '🔥', label: 'Fire them up', line: '"This is OUR game! Go out there and take it!"' },
];

type Situation = 'ahead' | 'close' | 'behind';

const OUTCOMES: Record<Situation, Record<Talk, { morale: number; reaction: string }>> = {
  ahead: {
    praise: { morale: 0.6, reaction: 'The players nod. Confident, and hungry for more.' },
    demand: { morale: 0.2, reaction: 'A few eye-rolls, but nobody is getting comfortable.' },
    calm: { morale: 0.3, reaction: 'Focused. They know the job isn\'t done.' },
    fireUp: { morale: -0.3, reaction: 'Too hyped: they head out a bit reckless and overconfident.' },
  },
  close: {
    praise: { morale: 0.1, reaction: 'Polite applause. Not much changes.' },
    demand: { morale: 0.4, reaction: 'The message lands. Jaws are set.' },
    calm: { morale: 0.2, reaction: 'Steady. They\'ll keep it tight.' },
    fireUp: { morale: 0.6, reaction: 'The locker room is ROCKING. They sprint out of the tunnel!' },
  },
  behind: {
    praise: { morale: -0.3, reaction: 'Confused looks. They know they haven\'t earned it.' },
    demand: { morale: 0.6, reaction: 'Stung. They come out with a point to prove.' },
    calm: { morale: 0.3, reaction: 'Heads clear. They regroup.' },
    fireUp: { morale: 0.4, reaction: 'Fired up and ready to fight back.' },
  },
};

function situation(s: MatchState, side: Side): Situation {
  const margin = s.teams[side].score - s.teams[side === 0 ? 1 : 0].score;
  return margin >= 8 ? 'ahead' : margin <= -8 ? 'behind' : 'close';
}

/** Applies a team talk and returns the players' reaction. */
export function giveTalk(s: MatchState, side: Side, talk: Talk): { morale: number; reaction: string } {
  const out = OUTCOMES[situation(s, side)][talk];
  s.teams[side].morale = out.morale;
  return out;
}

/** The AI reads the room correctly most of the time. */
export function aiTalk(s: MatchState, side: Side): Talk {
  const best = Object.entries(OUTCOMES[situation(s, side)]).sort((a, b) => b[1].morale - a[1].morale)[0][0];
  return best as Talk;
}
