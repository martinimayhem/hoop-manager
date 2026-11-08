// Turns events into short commentary lines. Pure: the line variant is picked by
// hashing the event, so commentary never touches the match RNG.

import { playerOf } from './state';
import type { MatchState, ShotType, Side, TimedEvent } from './types';

export interface Names {
  player(side: Side, id: string): string;
  team(side: Side): string;
}

export function namesFor(s: MatchState): Names {
  return {
    player: (side, id) => playerOf(s, side, id).name,
    team: (side) => s.teams[side].team.name,
  };
}

function variant<T>(ev: TimedEvent, options: readonly T[]): T {
  const key = `${ev.type}|${ev.quarter}|${ev.clock.toFixed(1)}|${ev.score.join('-')}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return options[(h >>> 0) % options.length];
}

const SHOT_MADE: Record<ShotType, readonly string[]> = {
  three: ['{p} pulls up from deep… BANG!', '{p} drains the three!', '{p} lets it fly… splash!', 'Catch, rise, fire — {p} nails it from downtown!'],
  mid: ['{p} hits the mid-range jumper.', '{p} rises and knocks down the elbow J.', 'Smooth pull-up from {p}.'],
  pnrPull: ['{p} comes off the screen and buries the pull-up.', 'Pick-and-roll, {p} keeps it and hits the jumper.'],
  pnrRoll: ['{p} rolls to the rim and finishes!', 'Perfect pocket pass — {p} lays it in.', '{p} slips the screen and slams it home!'],
  post: ['{p} backs down and scores in the post.', 'Drop step, layup — {p} is too strong inside.', '{p} with the hook shot. Good!'],
  drive: ['{p} blows by the defender for the layup!', '{p} attacks the basket and scores.', 'Crossover, drive, finish — {p}!'],
  fastBreak: ['{p} takes it all the way!', '{p} on the break… throws it DOWN!', '{p} leads the break and lays it in.', 'Nobody catches {p} in transition!'],
  pressBreak: ['Press broken — {p} with the easy two!', '{p} finishes the 2-on-1 after the press is beaten.'],
  putback: ['{p} with the putback!', 'Second effort from {p} — tip-in!', '{p} cleans up the miss.'],
};

const SHOT_MISSED: Record<ShotType, readonly string[]> = {
  three: ['{p} misfires from three.', '{p} from deep… off the rim.', '{p} airballs it! Ouch.'],
  mid: ['{p} misses the jumper.', '{p} rims out from mid-range.'],
  pnrPull: ['{p} comes off the pick, but the jumper rattles out.'],
  pnrRoll: ['{p} rolls but can\'t finish.', '{p} fumbles the pocket pass at the rim.'],
  post: ['{p} misses the turnaround in the post.', '{p} forces it inside… no good.'],
  drive: ['{p} drives but misses the layup.', '{p} gets into the lane, but it rolls off.'],
  fastBreak: ['{p} blows the fast-break layup!', '{p} goes coast to coast… and misses!'],
  pressBreak: ['{p} misses the easy one after breaking the press.'],
  putback: ['{p} can\'t get the putback to drop.'],
};

const fmt = (template: string, p: string) => template.replace('{p}', p);

const CALL_NAMES: Record<string, string> = {
  isoStar: 'clear out for the star',
  pickAndRoll: 'pick-and-roll',
  kickOut: 'drive and kick for three',
  postUp: 'feed the post',
  runClock: 'run the clock',
  doubleStar: 'double-team the star',
  packPaint: 'pack the paint',
  denyThree: 'run them off the three-point line',
  foul: 'foul to stop the clock',
};

const DUNKS = ['{p} THROWS IT DOWN!', 'Posterized! {p} with the slam!', '{p} rises… and hammers it home!', 'BOOM! {p} with authority!'];

export function describe(ev: TimedEvent, names: Names): string | null {
  switch (ev.type) {
    case 'quarterStart':
      return ev.quarter <= 4 ? `— Start of Q${ev.quarter} —` : `— Start of overtime ${ev.quarter - 4} —`;
    case 'quarterEnd':
      return ev.quarter <= 4 ? `— End of Q${ev.quarter} —` : `— End of overtime ${ev.quarter - 4} —`;
    case 'gameEnd':
      return `FINAL: ${names.team(ev.winner)} win!`;
    case 'shot': {
      const p = names.player(ev.side, ev.shooterId);
      if (ev.made) {
        let line = fmt(variant(ev, ev.dunk ? DUNKS : SHOT_MADE[ev.shotType]), p);
        if (ev.assistId) line += ` (assist ${names.player(ev.side, ev.assistId)})`;
        if (ev.andOne) line += ' AND ONE!';
        return line;
      }
      if (ev.blockerId) {
        const b = names.player(ev.side === 0 ? 1 : 0, ev.blockerId);
        return variant(ev, [`REJECTED! ${b} swats ${p}.`, `${b} gets a piece of ${p}'s shot!`, `Get that outta here! ${b} blocks ${p}.`]);
      }
      return fmt(variant(ev, SHOT_MISSED[ev.shotType]), p);
    }
    case 'rebound': {
      const p = names.player(ev.side, ev.playerId);
      return ev.offensive ? variant(ev, [`Offensive board, ${p}!`, `${p} crashes the glass for a second chance.`]) : `${p} rebounds.`;
    }
    case 'turnover': {
      const p = names.player(ev.side, ev.playerId);
      const other = ev.side === 0 ? 1 : 0;
      switch (ev.cause) {
        case 'steal':
          return `${names.player(other, ev.stealerId!)} picks ${p}'s pocket!`;
        case 'pressTrap':
          return ev.stealerId
            ? `Trapped by the press! ${names.player(other, ev.stealerId)} steals it from ${p}.`
            : `The press forces ${p} into a turnover.`;
        case 'badPass':
          return `Bad pass by ${p}, turnover.`;
        case 'travel':
          return `${p} is called for travelling.`;
        case 'offensiveFoul':
          return `Offensive foul on ${p}.`;
        case 'shotClock':
          return `Shot-clock violation — ${names.team(ev.side)} held it too long.`;
      }
      return null;
    }
    case 'foul': {
      const p = names.player(ev.side, ev.playerId);
      const on = names.player(ev.side === 0 ? 1 : 0, ev.onId);
      if (ev.shooting) return `Foul on ${p}, ${on} to the line.`;
      return ev.bonus ? `Foul on ${p} — ${names.team(ev.side)} are in the penalty, ${on} shoots two.` : `Reach-in foul on ${p}.`;
    }
    case 'freeThrow': {
      const p = names.player(ev.side, ev.shooterId);
      return `${p} ${ev.made ? 'makes' : 'misses'} free throw ${ev.attempt} of ${ev.of}.`;
    }
    case 'fastBreak':
      return '';
    case 'transition': {
      const p = names.player(ev.side, ev.handlerId);
      if (!ev.attack) return `${p} slows it down and sets up the offence.`;
      if (ev.situation === 'lane') return `${p} sees daylight…`;
      return `${ev.situation === 'twoOnOne' ? '2-on-1' : '3-on-2'}! ${p} pushes it…`;
    }
    case 'transitionRead': {
      const p = names.player(ev.side, ev.handlerId);
      if (ev.then === 'dish') return `${p} draws the defender and dishes!`;
      if (ev.then === 'kick') return `The lane closes; ${p} kicks it out.`;
      if (ev.then === 'pullBack') return `The lane closes, so ${p} pulls it back out.`;
      return `A defender gets back, but ${p} goes up through the contact!`;
    }
    case 'pressBroken':
      return `${names.player(ev.side, ev.handlerId)} splits the press!`;
    case 'doubleTeam': {
      const t = names.player(ev.side, ev.targetId);
      return ev.passedToId ? `Double team on ${t}, who kicks it out to ${names.player(ev.side, ev.passedToId)}.` : `${t} is double-teamed and forced into a tough shot.`;
    }
    case 'sub': {
      const why = ev.reason === 'fatigue' ? ' (tired)' : ev.reason === 'fouls' ? ' (foul trouble)' : ev.reason === 'foulOut' ? ' (fouled out)' : '';
      return `Sub ${names.team(ev.side)}: ${names.player(ev.side, ev.inId)} in for ${names.player(ev.side, ev.outId)}${why}.`;
    }
    case 'foulOut':
      return `${names.player(ev.side, ev.playerId)} has fouled out!`;
    case 'timeout':
      return `Timeout ${names.team(ev.side)} (${ev.remaining} left).`;
    case 'playCall':
      return `${names.team(ev.side)} call: ${CALL_NAMES[ev.call]}.`;
  }
}
