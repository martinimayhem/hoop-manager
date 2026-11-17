// Who is who in 3D: each player's look (height, build, skin, hair) from the game's own looks, his
// team's colours and his number; the officials in grey stripes.

import type { Side } from '../../engine/types';
import { isRef } from '../court/animation';
import { TEAM_COLOURS } from '../labels';
import { lookOf } from '../looks';
import type { LiveMatch } from '../match/controller';
import type { PlayerLook } from './player3d';


export function lookFor3d(m: LiveMatch, key: string): PlayerLook | null {
  if (isRef(key)) {
    const look = lookOf({ id: key, heightCm: 184, weightKg: 84 }).sprite;
    // Each official's number on his back, as in the reference.
    const number = String([27, 14, 36][Number(key.slice(key.indexOf(':') + 1)) % 3] ?? 27);
    return { heightM: 1.84, girth: 1, skin: look.skin, hair: look.hairColour, hairstyle: look.hairstyle, facialHair: look.facialHair, jersey: '#949494', jerseyText: '#111111', shorts: '#111111', number, official: true };
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
    // The same appearance record his portrait is drawn from: skin, hair, beard, headband.
    hair: look.hairColour,
    hairstyle: look.hairstyle,
    facialHair: look.facialHair,
    headband: look.headband,
    jersey: TEAM_COLOURS[side].fill,
    jerseyText: TEAM_COLOURS[side].text,
    // The shorts in the team's second colour (trimmed in the first), so they stand apart from the jersey.
    shorts: TEAM_COLOURS[side].text,
    number: String(p.number),
  };
}
