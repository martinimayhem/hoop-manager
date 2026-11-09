import { svgsIndex } from 'facesjs';
import { describe, expect, it } from 'vitest';
import { playerPool } from '../src/game/pool';
import { CourtRenderer, FACING_ANGLES, type DotInfo } from '../src/ui/court/render';
import { HAIRSTYLES, HAIR_ART, appearanceOf, facialHairKind, featuresUrl, lookOf, makeAppearance, makeLook, portraitUrl } from '../src/ui/looks';

const pool = playerPool().map((p) => p.player);
const kit = { fill: '#ff7a1a', text: '#1b0d00' };

/** A canvas context that draws nothing and records every colour it is given, in order. */
function recordingContext(): { ctx: CanvasRenderingContext2D; colours: string[] } {
  const colours: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop: (_: number, c: string) => colours.push(`stop:${c}`) });
      return () => undefined;
    },
    set(t, prop, value) {
      if ((prop === 'fillStyle' || prop === 'strokeStyle') && typeof value === 'string') colours.push(value.toLowerCase());
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, colours };
}

/** Every colour used to draw this figure at each of the eight facings. */
function drawnColours(info: DotInfo, key: string): string[][] {
  // Both sides in the same kit, so any difference between them could only come from the side.
  const renderer = new CourtRenderer([kit, kit]);
  return FACING_ANGLES.map((angle, i) => {
    const { ctx, colours } = recordingContext();
    renderer.drawFigure(ctx, `${key}:${i}`, 0, 0, info, angle);
    return colours;
  });
}

describe('player appearance', () => {
  it('is one record per player id, however it is asked for', () => {
    for (const p of pool) {
      const a = appearanceOf(p.id);
      expect(makeAppearance(p.id)).toEqual(a);
      // Any build, any number: same appearance.
      expect(lookOf(p).appearance).toEqual(a);
      expect(makeLook({ ...p, weightKg: p.weightKg + 30, heightCm: p.heightCm - 10 }).appearance).toEqual(a);
      const traded = { ...p, number: (p.number + 7) % 100 };
      expect(makeLook(traded).appearance).toEqual(a);
      // The court figure carries exactly the appearance (plus the build).
      const { girth, ...sprite } = lookOf(p).sprite;
      expect(girth).toBeGreaterThan(0);
      expect(sprite).toEqual(a);
      // The portrait is drawn from it.
      const face = lookOf(p).face;
      expect(face.body.color).toBe(a.skin);
      expect(face.hair).toMatchObject({ id: a.hairArt, color: a.hairColour });
      expect(face.facialHair.id).toBe(a.beardArt);
      expect(face.accessories.id).toBe(a.headband ? 'headband' : a.eyeBlack ? 'eye-black' : 'none');
    }
  });

  it('only ever uses portrait art that matches the hairstyle and facial hair', () => {
    for (const p of pool) {
      const a = appearanceOf(p.id);
      expect(HAIR_ART[a.hairstyle]).toContain(a.hairArt);
      expect(facialHairKind(a.beardArt)).toBe(a.facialHair);
    }
  });

  it('sorts every facesjs hair drawing into exactly one hairstyle', () => {
    const male = svgsIndex.hair.filter((id) => !id.startsWith('female'));
    const sorted = HAIRSTYLES.flatMap((h) => HAIR_ART[h]);
    expect([...sorted].sort()).toEqual([...male].sort());
  });

  it('is drawn the same on court home or away, at every facing', () => {
    for (const p of pool.slice(0, 25)) {
      const look = lookOf(p).sprite;
      const home = drawnColours({ label: '7', side: 0, heightM: 2, hasBall: false, look }, p.id);
      const away = drawnColours({ label: '7', side: 1, heightM: 2, hasBall: false, look }, p.id);
      expect(away).toEqual(home);
    }
  });

  it('shows the same hair colour and skin from every side', () => {
    for (const p of pool.slice(0, 25)) {
      const look = lookOf(p).sprite;
      const facings = drawnColours({ label: '', side: 0, heightM: 2, hasBall: false, look }, p.id);
      for (const colours of facings) {
        expect(colours).toContain(look.skin.toLowerCase());
        // Bald and shaved heads are skin from behind; everyone else shows their hair colour.
        if (look.hairstyle !== 'bald') expect(colours).toContain(look.hairColour.toLowerCase());
      }
    }
  });
});

describe('player looks', () => {
  it('are the same every time for the same player', () => {
    for (const p of pool.slice(0, 20)) expect(makeLook(p)).toEqual(makeLook(p));
  });

  it('do not depend on the shirt number: a new number keeps the face', () => {
    const p = pool[0];
    const renumbered = { ...p, number: 99 };
    expect(makeLook(renumbered)).toEqual(makeLook(p));
    expect(portraitUrl(renumbered, kit)).toBe(portraitUrl(p, kit));
  });

  it('give players different faces', () => {
    const faces = new Set(pool.map((p) => JSON.stringify(lookOf(p).face)));
    expect(faces.size).toBe(pool.length);
  });

  it('fill out with weight: heavier means a fuller face and a wider body', () => {
    const p = pool[0];
    const light = makeLook({ ...p, weightKg: 80 });
    const heavy = makeLook({ ...p, weightKg: 125 });
    expect(heavy.face.fatness).toBeGreaterThan(light.face.fatness);
    expect(heavy.face.body.size).toBeGreaterThan(light.face.body.size);
    expect(heavy.sprite.girth).toBeGreaterThan(light.sprite.girth);
    // Weight changes the build, not who he is.
    expect(heavy.face.hair).toEqual(light.face.hair);
    expect(heavy.face.eye).toEqual(light.face.eye);
  });

  it('render a portrait for every player, with the number on the shirt only when asked', () => {
    for (const p of pool) expect(portraitUrl(p, kit)).toMatch(/^data:image\/svg\+xml/);
    const withNumber = decodeURIComponent(portraitUrl(pool[0], kit, { number: 30 }));
    expect(withNumber).toContain('>30</text>');
    expect(decodeURIComponent(portraitUrl(pool[0], kit))).not.toContain('</text>');
  });

  it('crop to the head for small portraits, without the number', () => {
    const head = decodeURIComponent(portraitUrl(pool[0], kit, { crop: 'head', number: 30 }));
    expect(head).toContain('viewBox="0 25 400 510"');
    expect(head).not.toContain('</text>');
  });

  it('give the court only the face: no head, hair, ears or shirt, at a real size', () => {
    const p = pool[0];
    const features = decodeURIComponent(featuresUrl(p));
    const bust = decodeURIComponent(portraitUrl(p, kit));
    expect(bust).toContain('M80 610');
    expect(features).not.toContain('M80 610');
    expect(features).toContain('width="400"');
    // The same face home or away: no kit in it.
    expect(featuresUrl({ ...p })).toBe(featuresUrl(p));
    expect(features.length).toBeLessThan(bust.length / 2);
  });

  it('never wear hats, glasses or Santa hats', () => {
    for (const p of pool) {
      expect(['none', 'headband', 'eye-black']).toContain(lookOf(p).face.accessories.id);
      expect(lookOf(p).face.glasses.id).toBe('none');
    }
  });
});
