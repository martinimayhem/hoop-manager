// Who is who in 3D: each player's look (height, build, skin, hair) from the game's own looks, his
// team's colours and his number; the officials in grey stripes.

import type { Side } from '../../engine/types';
import { isRef } from '../court/animation';
import { TEAM_COLOURS } from '../labels';
import { lookOf } from '../looks';
import type { LiveMatch } from '../match/controller';
import type { PlayerLook } from './player3d';

/** Hairstyles drawn with no hair on the 3D model. */
const NO_HAIR = new Set(['bald', 'shaved']);

export function lookFor3d(m: LiveMatch, key: string): PlayerLook | null {
  if (isRef(key)) {
    const look = lookOf({ id: key, heightCm: 184, weightKg: 84 }).sprite;
    return { heightM: 1.84, girth: 1, skin: look.skin, hair: NO_HAIR.has(look.hairstyle) ? null : look.hairColour, jersey: '#d8d8d2', jerseyText: '#000000', shorts: '#1d1d1f', number: '', official: true };
  }
  const side = Number(key.slice(0, key.indexOf(':'))) as Side;
  const id = key.slice(key.indexOf(':') + 1);
  const p = m.s.teams[side]?.team.players.find((x) => x.id === id);
  if (!p) return null;
  const look = lookOf(p).sprite;
  return {
    heightM: p.heightCm / 100,
    girth: look.girth,
    skin: look.skin,
    hair: NO_HAIR.has(look.hairstyle) ? null : look.hairColour,
    jersey: TEAM_COLOURS[side].fill,
    jerseyText: TEAM_COLOURS[side].text,
    shorts: TEAM_COLOURS[side].fill,
    number: String(p.number),
  };
}
