// Player-facing names and one-line explanations for every tactic.

import type { DefenceScheme, OffensiveFocus, Tempo } from '../engine/types';

export interface OptionInfo {
  icon: string;
  label: string;
  /** What it does, in one sentence. */
  blurb: string;
  /** When to pick it. */
  good: string;
  /** What beats it. */
  weak: string;
}

export const OFFENCE_INFO: Record<OffensiveFocus, OptionInfo> = {
  inside: {
    icon: '💪',
    label: 'Inside',
    blurb: 'Feed your big men close to the basket.',
    good: 'You have tall, strong scorers. Also grabs more offensive rebounds.',
    weak: 'A 2-3 zone clogs the paint.',
  },
  balanced: {
    icon: '⚖️',
    label: 'Balanced',
    blurb: 'A bit of everything, so the defence can\'t key on one thing.',
    good: 'Your team has no single standout strength.',
    weak: 'Never bad, never spectacular.',
  },
  three: {
    icon: '🎯',
    label: '3-Point',
    blurb: 'Move the ball and shoot from deep.',
    good: 'You have 3+ good shooters and a passer. Great against a zone.',
    weak: 'Quick man-to-man defenders, or a cold shooting night.',
  },
  pickAndRoll: {
    icon: '🔁',
    label: 'Pick & Roll',
    blurb: 'Your guard uses a screen from a big man, who then rolls to the rim.',
    good: 'Quick point guard + athletic big. Punishes slow big men.',
    weak: 'A zone (it doesn\'t chase the screen).',
  },
  fastBreak: {
    icon: '⚡',
    label: 'Fast Break',
    blurb: 'Sprint the other way after every rebound and steal.',
    good: 'Your team is quicker than theirs.',
    weak: 'Slow-tempo teams that get back. You also give up offensive rebounds.',
  },
};

export const DEFENCE_INFO: Record<DefenceScheme, OptionInfo> = {
  man: {
    icon: '🧍',
    label: 'Man-to-man',
    blurb: 'Every player guards one opponent.',
    good: 'The safe default. Best against good shooters.',
    weak: 'Opponents who are better one-on-one, or quick pick-and-roll guards vs your slow bigs.',
  },
  zone: {
    icon: '🧱',
    label: '2-3 Zone',
    blurb: 'Players guard an area instead of a man, packing the paint.',
    good: 'Against inside scorers and drivers. Hides weak defenders.',
    weak: 'Good 3-point shooters and passers.',
  },
  press: {
    icon: '🔥',
    label: 'Full-court Press',
    blurb: 'Trap the ball all over the court to force turnovers.',
    good: 'Their ball handlers are weak, or you need a comeback.',
    weak: 'Tires YOUR players fast. Good guards break it for easy layups.',
  },
};

export const TEMPO_INFO: Record<Tempo, OptionInfo> = {
  slow: {
    icon: '🐢',
    label: 'Slow',
    blurb: 'Use the whole shot clock: fewer possessions.',
    good: 'Your team is big or tired, or you are protecting a lead.',
    weak: 'When you are behind and need points fast.',
  },
  normal: { icon: '▶️', label: 'Normal', blurb: 'Standard pace.', good: 'No clear speed advantage either way.', weak: 'Nothing in particular.' },
  fast: {
    icon: '🐇',
    label: 'Fast',
    blurb: 'Shoot early: more possessions for both teams.',
    good: 'Your team is quicker and fitter, or you are behind.',
    weak: 'Tires everyone; slow, big teams suffer most.',
  },
};

export const TEAM_COLOURS = [
  { fill: '#ff7a1a', text: '#1b0d00' },
  { fill: '#2f7bff', text: '#ffffff' },
] as const;

export function clockString(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function periodLabel(q: number): string {
  return q <= 4 ? `Q${q}` : `OT${q - 4}`;
}

export function abbrOf(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9 ]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1].slice(0, 2)).toUpperCase();
  return (clean.slice(0, 3) || 'TM').toUpperCase();
}
