// Career screens' shared parts: the club badge, ratings (exact for your own players, a scout's range
// for everyone else, as in the rest of the game), the payroll bar (GAME_FLOW §4.4) and small helpers.

import type { ReactNode } from 'react';
import { composite } from '../../../engine/ratings';
import { hashUnit } from '../../../game/pricing';
import { DEFAULT_SCOUT_ACCURACY, scoutRating, type Range } from '../../../game/scouting';
import { MIN_CONTRACT, THRESHOLD_MIN_AGE, money } from '../../../game/world/money';
import { COUNTRY_CODE3, COUNTRY_NAME } from '../../../game/world/places';
import { ageOf, clubById, moneySummary, type MoneySummary } from '../../../game/world/query';
import type { Morale, World, WorldClub, WorldPlayer } from '../../../game/world/types';

export const country = (code: string) => COUNTRY_NAME[code] ?? code;
export const code3 = (code: string) => COUNTRY_CODE3[code] ?? code;

/** Whether the player is one of yours (shown exactly). */
export function isMine(w: World, wp: WorldPlayer): boolean {
  return !!w.human && (wp.status === 'club' || wp.status === 'dev' || wp.status === 'academy') && wp.club === w.human.club;
}

/** His overall: exact for your own, a scout's range for anyone else. */
export function overallRange(w: World, wp: WorldPlayer): Range {
  if (isMine(w, wp)) {
    const v = Math.round(composite(wp.p).overall);
    return { lo: v, hi: v };
  }
  return scoutRating(wp.p, 'overall', wp.reputation, DEFAULT_SCOUT_ACCURACY);
}

/**
 * How good he can become, as a range: always an estimate (WORLD_SPEC §6), wider for the young and
 * for players outside your club, never below what he is today.
 */
export function potentialRange(w: World, wp: WorldPlayer): Range {
  const now = Math.round(composite(wp.p).overall);
  const age = ageOf(w, wp);
  const half = Math.round(Math.max(1, Math.min(8, (25 - age) * 0.9)) * (isMine(w, wp) ? 1 : 1.5));
  const shift = Math.round((hashUnit(`potential-range:${wp.p.id}`) - 0.5) * half);
  const lo = Math.max(now, wp.p.attrs.potential - half + shift);
  const hi = Math.min(99, Math.max(lo, wp.p.attrs.potential + half + shift));
  const pot = { lo: Math.min(lo, wp.p.attrs.potential), hi: Math.max(hi, wp.p.attrs.potential) };
  // Never below what the scouts think he is today.
  const today = overallRange(w, wp);
  const out = { lo: Math.max(pot.lo, today.lo), hi: Math.max(pot.hi, today.hi) };
  // Always a range, also for your own players: it is your staff's estimate (GAME_FLOW §6.4).
  if (out.hi === out.lo) {
    if (out.hi < 99) out.hi++;
    else out.lo--;
  }
  return out;
}

export const showRange = (r: Range) => (r.lo === r.hi ? String(r.lo) : `${r.lo}–${r.hi}`);
export const mid = (r: Range) => (r.lo + r.hi) / 2;

/** A rating's colour, as in the mockups: green from 80, blue from 65, yellow from 50, red below. */
export function ratingTone(v: number): string {
  return v >= 80 ? 'var(--good)' : v >= 65 ? 'var(--cr-blue)' : v >= 50 ? 'var(--warn)' : 'var(--cr-red)';
}

export const MORALE_TONE: Record<Morale, string> = { superb: 'var(--good)', good: 'var(--good)', okay: 'var(--warn)', low: 'var(--cr-red)', 'very low': 'var(--bad)' };

export function MoraleDot({ m }: { m: Morale }) {
  return (
    <span className="cr-morale">
      <span className="cr-dot" style={{ background: MORALE_TONE[m] }} />
      {m[0].toUpperCase() + m.slice(1)}
    </span>
  );
}

/** A club's initials ("LN" for Lisbon Navigators), for its badge. */
export function initials(club: WorldClub): string {
  const words = `${club.city} ${club.nickname}`.split(/[\s-]+/).filter((x) => /^[A-Za-zÀ-ž]/.test(x));
  const first = words[0][0];
  const last = club.nickname[0];
  return (first + last).toUpperCase();
}

/** The club badge: its initials in its colours. */
export function Badge({ club, size = 40 }: { club: WorldClub; size?: number }) {
  return (
    <span className="cr-badge" style={{ width: size, height: size, fontSize: size * 0.42, background: club.colours[0], borderColor: club.colours[1] }} aria-hidden="true">
      <span style={{ color: readableOn(club.colours[0]) }}>{initials(club)}</span>
    </span>
  );
}

/** White or near-black, whichever reads better on this colour. */
function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111723' : '#ffffff';
}

/** "Cap space $6.0M", "Over the cap $12.4M", "Budget room $4.6M": the top bar's money line. */
export function moneyLine(s: MoneySummary): { label: string; value: string; warn: boolean } {
  if (s.system === 'cap') return s.space >= 0 ? { label: 'Cap space', value: money(s.space), warn: false } : { label: 'Over the cap', value: money(-s.space), warn: true };
  return { label: 'Budget room', value: money(s.room), warn: s.room < 0 };
}

/** A contract's last season: a 2-year deal signed for 2026–27 runs to the summer of 2028. */
export const contractEnd = (w: World, years: number) => w.season + years;

// ---------------------------------------------------------------------------
// The payroll bar (GAME_FLOW §4.4): one bar with the lines marked, this season's money filled in and
// next season's commitments shown below it.

interface Line {
  at: number;
  label: string;
  tone: string;
  /** Label above the bar (so neighbours don't overlap). */
  up?: boolean;
}

function Bar({ value, next, max, lines, tone }: { value: number; next?: number; max: number; lines: Line[]; tone: string }) {
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / max) * 100))}%`;
  // A label is centred on its line, but kept inside the bar at either end.
  const shift = (x: number) => (x / max > 0.86 ? 'translateX(-100%)' : x / max < 0.1 ? 'none' : 'translateX(-50%)');
  return (
    <div className="cr-bar">
      <div className="cr-bar-labels up">
        {lines
          .filter((l) => l.up)
          .map((l) => (
            <span key={l.label} style={{ left: pct(l.at), color: l.tone, transform: shift(l.at) }}>
              {l.label}
            </span>
          ))}
      </div>
      <div className="cr-bar-track">
        <div className="cr-bar-fill" style={{ width: pct(value), background: tone }} />
        {lines.map((l) => (
          <div key={l.label} className="cr-bar-line" style={{ left: pct(l.at), background: l.tone }} />
        ))}
      </div>
      {next !== undefined && (
        <div className="cr-bar-track next" title="Already committed for next season">
          <div className="cr-bar-fill ghost" style={{ width: pct(next) }} />
          {lines.map((l) => (
            <div key={l.label} className="cr-bar-line" style={{ left: pct(l.at), background: l.tone }} />
          ))}
        </div>
      )}
      <div className="cr-bar-labels">
        {lines
          .filter((l) => !l.up)
          .map((l) => (
            <span key={l.label} style={{ left: pct(l.at), color: l.tone, transform: shift(l.at) }}>
              {l.label}
            </span>
          ))}
      </div>
    </div>
  );
}

function Legend({ items }: { items: [string, ReactNode, string?][] }) {
  return (
    <div className="cr-legend">
      {items.map(([k, v, cls]) => (
        <span key={k} className={cls}>
          <i />
          {k} <b>{v}</b>
        </span>
      ))}
    </div>
  );
}

export function PayrollBar({ w, club }: { w: World; club: WorldClub }) {
  const s = moneySummary(w, club);
  const mine = w.human?.club === club.id;
  if (s.system === 'cap') {
    const status =
      s.payroll < s.floor
        ? `Under the floor: the payroll must reach ${money(s.floor)} by the first game.`
        : s.payroll <= s.cap
          ? `Under the cap: ${money(s.cap - s.payroll)} of cap space to sign anyone.`
          : s.payroll <= s.tax
            ? `Over the cap, under the tax line. ${mine ? 'You' : 'They'} can re-sign ${mine ? 'your' : 'their'} own players, sign minimum deals (${money(MIN_CONTRACT)}) or use the mid-level exception (${money(s.midLevel)} left).`
            : `Over the tax line: luxury tax of $1.50 for every $1 over.`;
    return (
      <section className="cr-card cr-payroll">
        <div className="cr-card-head">
          <h2>Payroll against the cap</h2>
          <span className="cr-big">{money(s.payroll)}</span>
        </div>
        <Bar
          value={s.payroll}
          next={s.next}
          max={s.ceiling * 1.06}
          tone="var(--accent)"
          lines={[
            { at: s.floor, label: `Floor ${money(s.floor)}`, tone: 'var(--muted)' },
            { at: s.cap, label: `Cap ${money(s.cap)}`, tone: 'var(--text)', up: true },
            { at: s.tax, label: `Tax ${money(s.tax)}`, tone: 'var(--warn)' },
            { at: s.ceiling, label: `Hard ceiling ${money(s.ceiling)}`, tone: 'var(--cr-red)', up: true },
          ]}
        />
        <Legend items={[['This season', money(s.payroll)], ['Committed for next season', money(s.next), 'ghost']]} />
        <p className="cr-note">{status} Dev-squad players are on minimum deals outside the cap.</p>
      </section>
    );
  }
  const t = s.threshold;
  return (
    <section className="cr-card cr-payroll">
      <div className="cr-card-head">
        <h2>Club budget</h2>
        <span className="cr-big">
          {money(s.committed)} <small>of {money(s.budget)}</small>
        </span>
      </div>
      <Bar value={s.committed} next={s.next} max={s.budget * 1.08} tone="var(--accent)" lines={[{ at: s.budget, label: `Budget ${money(s.budget)}`, tone: 'var(--text)' }]} />
      <Legend items={[['Wages this season', money(s.committed)], ['Committed for next season', money(s.next), 'ghost']]} />
      <p className="cr-note">
        One budget pays wages, staff and buyout fees. Wages: first team {money(s.committed - devWages(w, club))}, dev squad {money(devWages(w, club))}. Room left: <b>{money(s.room)}</b>.
      </p>
      {t && (
        <div className="cr-threshold">
          <div className="cr-card-head">
            <h3>Big League payroll threshold</h3>
            <span className="cr-big small">
              {money(t.counted)} <small>of {money(t.limit)}</small>
            </span>
          </div>
          <Bar value={t.counted} max={t.limit * 1.15} tone="var(--cr-blue)" lines={[{ at: t.limit, label: `Threshold ${money(t.limit)}`, tone: 'var(--warn)' }]} />
          <p className="cr-note">
            Counts every wage except the 3 anchor players ({t.anchors.map((a) => a.p.name).join(', ')}) and players under {THRESHOLD_MIN_AGE}. Above it the club pays $0.50 for every $1 over.
          </p>
        </div>
      )}
    </section>
  );
}

const devWages = (w: World, club: WorldClub) => club.dev.reduce((s, id) => s + (w.players[id].contract?.wage ?? 0), 0);

/** Where a player came through: his college, a club's academy, or abroad. */
export function cameThrough(w: World, wp: WorldPlayer): string {
  const o = wp.origin;
  if (o.kind === 'college') return w.colleges.find((c) => c.id === o.college)?.name ?? 'College';
  if (o.kind === 'academy') return `${clubById(w, o.club)?.name ?? '?'} academy`;
  if (o.kind === 'star') return 'Established star';
  return 'International';
}
