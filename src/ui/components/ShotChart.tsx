// The shot chart after the match: every shot a team took, bucketed into 1 m squares on its half of
// the floor and coloured by points per attempt, with a line per zone underneath.

import {
  BOARD_X,
  CIRCLE_RADIUS,
  CORNER_THREE_FROM_SIDELINE,
  CORNER_THREE_LENGTH,
  COURT,
  FREE_THROW_LINE_X,
  HALF_X,
  HOOP_X,
  KEY_HALF_WIDTH,
  MID_Y,
  RESTRICTED_M,
  THREE_ARC_M,
  ZONES,
  shotPoint,
  type ShotZone,
} from '../../engine/court';
import type { Side, TimedEvent } from '../../engine/types';

type Shot = Extract<TimedEvent, { type: 'shot' }>;

const ZONE_LABEL: Record<ShotZone, string> = {
  restricted: 'At the rim',
  paint: 'Paint',
  mid: 'Mid-range',
  corner3: 'Corner three',
  aboveBreak3: 'Above the break',
};

/** The half court as drawn: the basket at the top, half court at the bottom (metres). */
const W = COURT.h;
const H = COURT.w - HALF_X;
/** From the attacking frame to the chart: across the floor left to right, out from the baseline downwards. */
const toChart = (x: number, y: number): [number, number] => [y, COURT.w - x];

/** Points per attempt to a colour: cold red, through amber, to green for the best spots. */
function heat(pps: number): string {
  if (pps >= 1.2) return 'var(--good)';
  if (pps >= 0.9) return 'var(--warn)';
  return 'var(--bad)';
}

function Lines() {
  const stroke = { stroke: 'var(--muted)', strokeWidth: 0.06, fill: 'none' };
  const [hx, hy] = toChart(HOOP_X, MID_Y);
  const ftY = COURT.w - FREE_THROW_LINE_X;
  // The arc from one corner line round to the other.
  const cornerY = CORNER_THREE_LENGTH;
  const left = CORNER_THREE_FROM_SIDELINE;
  const right = COURT.h - CORNER_THREE_FROM_SIDELINE;
  return (
    <g>
      <rect x={0} y={0} width={W} height={H} {...stroke} />
      <rect x={MID_Y - KEY_HALF_WIDTH} y={0} width={KEY_HALF_WIDTH * 2} height={ftY} {...stroke} />
      <circle cx={MID_Y} cy={ftY} r={CIRCLE_RADIUS} {...stroke} />
      <path d={`M ${hx - RESTRICTED_M} ${hy} A ${RESTRICTED_M} ${RESTRICTED_M} 0 0 0 ${hx + RESTRICTED_M} ${hy}`} {...stroke} />
      <path d={`M ${left} 0 L ${left} ${cornerY} A ${THREE_ARC_M} ${THREE_ARC_M} 0 0 0 ${right} ${cornerY} L ${right} 0`} {...stroke} />
      <circle cx={hx} cy={hy} r={0.23} {...stroke} />
      <line x1={MID_Y - 0.9} y1={COURT.w - BOARD_X} x2={MID_Y + 0.9} y2={COURT.w - BOARD_X} {...stroke} />
    </g>
  );
}

export function ShotChart({ events, side, name }: { events: TimedEvent[]; side: Side; name: string }) {
  const shots = events.filter((e): e is Shot => e.type === 'shot' && e.side === side);
  const cells = new Map<string, { att: number; pts: number; x: number; y: number }>();
  for (const s of shots) {
    const p = shotPoint(s);
    const [cx, cy] = toChart(p.x, p.y);
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    const cell = cells.get(`${x},${y}`) ?? { att: 0, pts: 0, x, y };
    cell.att++;
    if (s.made) cell.pts += s.points;
    cells.set(`${x},${y}`, cell);
  }
  const most = Math.max(1, ...[...cells.values()].map((c) => c.att));
  const byZone = ZONES.map((zone) => {
    const z = shots.filter((s) => s.zone === zone);
    const made = z.filter((s) => s.made);
    return { zone, att: z.length, made: made.length, pts: made.reduce((sum, s) => sum + s.points, 0) };
  });

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <h3 style={{ margin: 0 }} className={side === 0 ? 'home' : 'away'}>
        {name}
      </h3>
      <svg viewBox={`-0.3 -0.3 ${W + 0.6} ${H + 0.6}`} style={{ width: '100%', maxWidth: 360, background: 'var(--panel-2)', borderRadius: 6 }} role="img" aria-label={`${name} shot chart`}>
        {[...cells.values()].map((c) => (
          <rect key={`${c.x},${c.y}`} x={c.x + 0.05} y={c.y + 0.05} width={0.9} height={0.9} rx={0.12} fill={heat(c.pts / c.att)} opacity={0.3 + 0.65 * (c.att / most)}>
            <title>{`${c.att} shot${c.att === 1 ? '' : 's'}, ${(c.pts / c.att).toFixed(2)} points a shot`}</title>
          </rect>
        ))}
        <Lines />
      </svg>
      <table style={{ maxWidth: 360 }}>
        <thead>
          <tr>
            <th className="left">Zone</th>
            <th>FGM-A</th>
            <th>FG%</th>
            <th>Pts/shot</th>
          </tr>
        </thead>
        <tbody>
          {byZone.map((z) => (
            <tr key={z.zone}>
              <td className="left">{ZONE_LABEL[z.zone]}</td>
              <td>
                {z.made}-{z.att}
              </td>
              <td>{z.att ? `${Math.round((100 * z.made) / z.att)}%` : '-'}</td>
              <td>{z.att ? (z.pts / z.att).toFixed(2) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 12 }}>
        Squares are 1 m. <span style={{ color: 'var(--good)' }}>■</span> 1.2+ points a shot <span style={{ color: 'var(--warn)' }}>■</span> 0.9–1.2{' '}
        <span style={{ color: 'var(--bad)' }}>■</span> under 0.9; fainter means fewer shots.
      </div>
    </div>
  );
}
