import type { Range } from '../../game/scouting';

/** Background colour for a 1–99 rating: red → yellow → green. */
export function ratingColour(v: number): string {
  const t = Math.max(0, Math.min(1, (v - 40) / 50));
  const hue = Math.round(t * 120);
  return `hsla(${hue}, 70%, 45%, 0.35)`;
}

export function RangeCell({ r }: { r: Range }) {
  const mid = (r.lo + r.hi) / 2;
  return (
    <span className="range" style={{ background: ratingColour(mid) }} title={r.lo === r.hi ? 'Exact' : 'Scout estimate'}>
      {r.lo === r.hi ? r.lo : `${r.lo}–${r.hi}`}
    </span>
  );
}

export function Rating({ v }: { v: number }) {
  return (
    <span className="range" style={{ background: ratingColour(v), minWidth: 30 }}>
      {Math.round(v)}
    </span>
  );
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" title="Development potential (scout estimate)">
      {'★'.repeat(n)}
      <span style={{ opacity: 0.25 }}>{'★'.repeat(5 - n)}</span>
    </span>
  );
}

export function EnergyBar({ energy, width = 60 }: { energy: number; width?: number }) {
  const colour = energy > 70 ? 'var(--good)' : energy > 50 ? 'var(--warn)' : 'var(--bad)';
  return (
    <div className="bar" style={{ width }} title={`Energy ${Math.round(energy)}%`}>
      <div style={{ width: `${energy}%`, background: colour }} />
    </div>
  );
}

export function ProbBars<K extends string>({ dist, labels }: { dist: Record<K, number>; labels: Record<K, { label: string }> }) {
  const entries = (Object.keys(dist) as K[]).sort((a, b) => dist[b] - dist[a]);
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      {entries.map((k) => (
        <div key={k} className="prob-row">
          <span>{labels[k].label}</span>
          <div className="bar">
            <div style={{ width: `${Math.round(dist[k] * 100)}%`, background: 'var(--accent)' }} />
          </div>
          <span className="muted">{Math.round(dist[k] * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
