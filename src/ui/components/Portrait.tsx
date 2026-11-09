// A player's cartoon portrait in his team's kit, and his shirt number. The same face is used for
// his figure on court (see ../looks.ts). The number is read from the player each render, so a
// new number (after a trade, or a clash in a new squad) shows straight away; the face stays.

import type { Player, Side } from '../../engine/types';
import { TEAM_COLOURS } from '../labels';
import { HEAD_VIEWBOX, portraitUrl, type Kit } from '../looks';

/** Unsigned players wear a plain grey practice shirt. */
const FREE_AGENT: Kit = { fill: '#8f99a8', text: '#121722' };
/** From this height a portrait shows head and shoulders, number on the shirt; below it, just the face. */
const BUST_FROM = 80;

const kitOf = (side?: Side): Kit => (side === undefined ? FREE_AGENT : TEAM_COLOURS[side]);

export function Portrait({ player, side, size = 40, number = true }: { player: Player; side?: Side; size?: number; number?: boolean }) {
  const bust = size >= BUST_FROM;
  const width = Math.round(bust ? (size * 2) / 3 : (size * HEAD_VIEWBOX.w) / HEAD_VIEWBOX.h);
  const src = portraitUrl(player, kitOf(side), bust ? { crop: 'bust', number: number ? player.number : undefined } : { crop: 'head' });
  return (
    <span className="portrait" style={{ width, height: size }}>
      <img src={src} alt="" loading="lazy" draggable={false} />
    </span>
  );
}

/** The shirt number as a chip in the team's colours, to sit beside a face rather than over it. */
export function ShirtNumber({ player, side }: { player: Player; side?: Side }) {
  const kit = kitOf(side);
  return (
    <span className="shirt-no" style={{ background: kit.fill, color: kit.text }}>
      {player.number}
    </span>
  );
}
