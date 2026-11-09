// Dev-only (open the app with ?turntable): every hairstyle on every skin tone, drawn at eight
// facings, beside its portrait, to check that each player is the same person from every angle.

import { useEffect, useRef } from 'react';
import { CourtRenderer, FACING_ANGLES, type DotInfo } from '../court/render';
import { FACIAL_HAIRS, HAIRSTYLES, HAIR_ART, PALETTE, faceUrl, makeLook, type Appearance, type Race } from '../looks';
import { TEAM_COLOURS } from '../labels';

interface Specimen {
  key: string;
  label: string;
  info: DotInfo;
  portrait: string;
}

const KIT = TEAM_COLOURS[0];
const CELL_W = 72;
const CELL_H = 124;
const SCALE = 1.7;
/** ?facings=16 shows the in-between angles too (default: eight, an eighth of a turn apart). */
const FACINGS: readonly number[] = (() => {
  const n = Number(new URLSearchParams(window.location.search).get('facings')) || FACING_ANGLES.length;
  return Array.from({ length: n }, (_, i) => FACING_ANGLES[0] + (i * Math.PI * 2) / n);
})();
const BODY = { heightCm: 198, weightKg: 95 };

/**
 * Every hairstyle on every skin tone. Each row also cycles the hair colour (within that skin's
 * palette), the facial hair, the facesjs drawing of the hairstyle, and now and then a headband,
 * so every combination turns up somewhere. ?style=curly or ?skin=%2374453d narrows it down.
 */
function specimens(): Specimen[] {
  const params = new URLSearchParams(window.location.search);
  const onlyStyle = params.get('style');
  const onlySkin = params.get('skin');
  const skins = (Object.keys(PALETTE) as Race[]).flatMap((race) => PALETTE[race].skin.map((skin, i) => ({ race, skin, i })));
  const out: Specimen[] = [];
  HAIRSTYLES.forEach((hairstyle, h) => {
    if (onlyStyle && hairstyle !== onlyStyle) return;
    skins.forEach(({ race, skin, i }, k) => {
      if (onlySkin && skin !== onlySkin) return;
      const n = h + k;
      const hairColour = PALETTE[race].hair[(i + h) % PALETTE[race].hair.length];
      const facialHair = FACIAL_HAIRS[n % FACIAL_HAIRS.length];
      const art = HAIR_ART[hairstyle];
      const appearance: Appearance = {
        skin,
        hairColour,
        hairstyle,
        facialHair,
        headband: n % 5 === 0,
        eyeBlack: n % 11 === 3,
        hairArt: art[k % art.length],
        beardArt: facialHair === 'none' ? 'none' : { stubble: 'goatee-thin', moustache: 'mustache1', goatee: 'goatee1', full: 'beard2' }[facialHair],
      };
      const key = `tt:${hairstyle}:${skin}`;
      const look = makeLook({ id: key, ...BODY }, appearance);
      out.push({
        key,
        label: `${hairstyle} (${appearance.hairArt}) · ${facialHair}${appearance.headband ? ' · headband' : ''}`,
        info: { label: '', side: 0, heightM: BODY.heightCm / 100, hasBall: false, look: look.sprite, features: faceUrl(look.face, KIT, { crop: 'features' }, key) },
        portrait: faceUrl(look.face, KIT, { crop: 'head' }, key),
      });
    });
  });
  return out;
}

function Row({ s, renderer }: { s: Specimen; renderer: CourtRenderer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CELL_W * FACINGS.length * dpr;
    canvas.height = CELL_H * dpr;
    // The face features load asynchronously: redraw a few times until they are in.
    let n = 0;
    let timer = 0;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      FACINGS.forEach((angle, i) => {
        ctx.save();
        ctx.translate(CELL_W * (i + 0.5), CELL_H - 6);
        ctx.scale(SCALE, SCALE);
        renderer.drawFigure(ctx, `${s.key}:${i}`, 0, 0, s.info, angle);
        ctx.restore();
      });
      if (++n < 8) timer = window.setTimeout(draw, 250);
    };
    draw();
    return () => window.clearTimeout(timer);
  }, [s, renderer]);
  return (
    <div className="tt-row">
      <img src={s.portrait} alt="" className="tt-portrait" />
      <canvas ref={ref} style={{ width: CELL_W * FACINGS.length, height: CELL_H }} />
      <span className="tt-label">{s.label}</span>
    </div>
  );
}

export function Turntable() {
  const renderer = useRef(new CourtRenderer([TEAM_COLOURS[0], TEAM_COLOURS[1]])).current;
  const list = useRef(specimens()).current;
  return (
    <div className="tt">
      <h1>Turntable</h1>
      <p className="muted">Each row: the portrait, then the court figure at eight facings (front, turning clockwise).</p>
      <div className="tt-grid">
        {list.map((s) => (
          <Row key={s.key} s={s} renderer={renderer} />
        ))}
      </div>
    </div>
  );
}
