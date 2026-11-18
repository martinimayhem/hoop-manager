// Career screens' shared parts: a squad table, a player card, a club card. Your own players are shown
// as they are; everyone else as your scouts see them (a range: narrow for the famous, wide for
// unknowns), as in the rest of the game.

import type { ReactNode } from 'react';
import { composite } from '../../../engine/ratings';
import { ATTRIBUTE_GROUPS, DEFAULT_SCOUT_ACCURACY, potentialStars, scoutGroup, scoutRating, type Range } from '../../../game/scouting';
import { money } from '../../../game/world/money';
import { COUNTRY_NAME } from '../../../game/world/places';
import { ageOf, clubById, leagueLabel, payroll, whereIs } from '../../../game/world/query';
import type { World, WorldClub, WorldPlayer } from '../../../game/world/types';
import { RangeCell, Stars } from '../../components/common';
import { useSort } from '../../components/sortable';

/** Whether the player is one of yours (shown exactly). */
export function isMine(w: World, wp: WorldPlayer): boolean {
  return !!w.human && wp.status !== 'free' && wp.status !== 'college' && wp.club === w.human.club;
}

/** His overall: exact for your own, a scout's range for anyone else. */
export function overallRange(w: World, wp: WorldPlayer): Range {
  if (isMine(w, wp)) {
    const v = Math.round(composite(wp.p).overall);
    return { lo: v, hi: v };
  }
  return scoutRating(wp.p, 'overall', wp.reputation, DEFAULT_SCOUT_ACCURACY);
}

/** The middle of what you know about him, for sorting. */
const mid = (r: Range) => (r.lo + r.hi) / 2;

/** Where a player came through: his college, a club's academy, or abroad. */
export function cameThrough(w: World, wp: WorldPlayer): string {
  const o = wp.origin;
  if (o.kind === 'college') return w.colleges.find((c) => c.id === o.college)?.name ?? 'College';
  if (o.kind === 'academy') return `${clubById(w, o.club)?.name ?? '?'} academy`;
  if (o.kind === 'star') return 'An established star';
  return 'Abroad';
}

export const country = (code: string) => COUNTRY_NAME[code] ?? code;

/** A list of players: name, position, age, country, overall, potential, wage. Click a row to see him. */
export function PlayerTable({ w, players, selected, onSelect, showWage = true, showWhere = false }: { w: World; players: WorldPlayer[]; selected?: string | null; onSelect: (id: string) => void; showWage?: boolean; showWhere?: boolean }) {
  const { sorted, th } = useSort<WorldPlayer>((wp, key) => {
    switch (key) {
      case 'name':
        return wp.p.name;
      case 'pos':
        return 'PG SG SF PF C'.indexOf(wp.p.position);
      case 'age':
        return ageOf(w, wp);
      case 'nat':
        return country(wp.nationality);
      case 'ovr':
        return mid(overallRange(w, wp));
      case 'pot':
        return potentialStars(wp.p, DEFAULT_SCOUT_ACCURACY);
      case 'wage':
        return wp.contract?.wage ?? null;
      case 'where':
        return whereIs(w, wp);
    }
    return null;
  });
  const cur = (wp: WorldPlayer) => (wp.club ? (clubById(w, wp.club)?.currency ?? 'USD') : 'USD');
  return (
    <table className="eq cw-table">
      <thead>
        <tr>
          {th('name', 'Player', { left: true, wide: true, tip: 'Click a player to see him' })}
          {th('pos', 'Pos', { tip: 'Position' })}
          {th('age', 'Age')}
          {th('nat', 'Nat', { tip: 'Nationality' })}
          {th('ovr', 'OVR', { tip: 'Overall rating: exact for your players, a scout estimate for others' })}
          {th('pot', 'Pot', { tip: 'Potential: how good he can become (always an estimate)' })}
          {showWage && th('wage', 'Wage', { tip: 'Wage per season' })}
          {showWhere && th('where', 'Where', { left: true })}
        </tr>
      </thead>
      <tbody>
        {sorted(players).map((wp) => (
          <tr key={wp.p.id} className={`cw-row ${selected === wp.p.id ? 'on' : ''}`} onClick={() => onSelect(wp.p.id)}>
            <td className="left">
              {wp.p.name} <span className="muted small">{wp.p.archetype}</span>
            </td>
            <td>{wp.p.position}</td>
            <td>{ageOf(w, wp)}</td>
            <td title={country(wp.nationality)}>{wp.nationality}</td>
            <td>
              <RangeCell r={overallRange(w, wp)} />
            </td>
            <td>
              <Stars n={potentialStars(wp.p, DEFAULT_SCOUT_ACCURACY)} />
            </td>
            {showWage && <td className="muted">{wp.contract ? money(wp.contract.wage, cur(wp)) : '—'}</td>}
            {showWhere && <td className="left muted small">{whereIs(w, wp)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One player: who he is, where he is from, his contract and ratings. */
export function PlayerCard({ w, id }: { w: World; id: string | null }) {
  const wp = id ? w.players[id] : undefined;
  if (!wp) return <div className="muted cw-empty">Click a player to see him here.</div>;
  const mine = isMine(w, wp);
  const club = wp.club ? clubById(w, wp.club) : undefined;
  const acc = DEFAULT_SCOUT_ACCURACY;
  const group = (g: (typeof ATTRIBUTE_GROUPS)[number]): Range => {
    if (!mine) return scoutGroup(wp.p, g, wp.reputation, acc);
    const v = Math.round(g.attrs.reduce((s, a) => s + wp.p.attrs[a.key], 0) / g.attrs.length);
    return { lo: v, hi: v };
  };
  const per = wp.personality;
  return (
    <div className="cw-card">
      <div className="cw-card-head">
        <h3>{wp.p.name}</h3>
        <span className="muted">
          #{wp.p.number} · {wp.p.position} · {wp.p.archetype}
        </span>
        <span className="cw-where">{whereIs(w, wp)}</span>
      </div>
      <dl className="cw-facts">
        <dt>Age</dt>
        <dd>
          {ageOf(w, wp)} <span className="muted small">(born {wp.born})</span>
        </dd>
        <dt>Size</dt>
        <dd>
          {wp.p.heightCm} cm · {wp.p.weightKg} kg
        </dd>
        <dt>Country</dt>
        <dd>{country(wp.nationality)}</dd>
        <dt>Hometown</dt>
        <dd>{wp.hometown}</dd>
        <dt>Came through</dt>
        <dd>{cameThrough(w, wp)}</dd>
        <dt>Contract</dt>
        <dd>{wp.contract && club ? `${money(wp.contract.wage, club.currency)} a season, ${wp.contract.years} ${wp.contract.years === 1 ? 'season' : 'seasons'} left` : wp.status === 'free' ? 'None: a free agent' : 'None'}</dd>
        <dt>Known</dt>
        <dd>{wp.reputation >= 80 ? 'Everywhere' : wp.reputation >= 55 ? 'Across the league' : wp.reputation >= 30 ? 'In his league' : wp.reputation >= 12 ? 'Locally' : 'Hardly at all'}</dd>
      </dl>
      <div className="cw-ratings">
        <div className="cw-rating-top">
          <span>Overall</span>
          <RangeCell r={overallRange(w, wp)} />
          <span>Potential</span>
          <Stars n={potentialStars(wp.p, acc)} />
        </div>
        {ATTRIBUTE_GROUPS.map((g) => (
          <div key={g.key} className="cw-rating">
            <span>{g.label}</span>
            <RangeCell r={group(g)} />
          </div>
        ))}
        <div className="muted small cw-scout-note">{mine ? 'Your player: exact ratings.' : 'Scout estimates: the true rating is inside the range. Famous players are easier to read.'}</div>
      </div>
      {mine ? (
        <div className="cw-personality">
          {(
            [
              ['Professional', per.professionalism, 'Trains well: grows faster, declines slower'],
              ['Ambitious', per.ambition, 'Wants minutes and a bigger club'],
              ['Loyal', per.loyalty, 'Likes to stay at his club'],
              ['Calm', per.temperament, 'Keeps his head in a heated game'],
            ] as const
          ).map(([label, v, tip]) => (
            <div key={label} className="cw-trait" title={tip}>
              <span>{label}</span>
              <div className="bar">
                <div style={{ width: `${(v / 20) * 100}%`, background: v >= 14 ? 'var(--good)' : v >= 8 ? 'var(--warn)' : 'var(--bad)' }} />
              </div>
              <b>{v}</b>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted small cw-personality">His character you learn once he is at your club.</div>
      )}
    </div>
  );
}

/** A club at a glance: league, arena, fans, money, facilities (compact: the four that matter when choosing). */
export function ClubFacts({ w, club, compact = false }: { w: World; club: WorldClub; compact?: boolean }) {
  const pay = payroll(w, club);
  const f = club.facilities;
  const items: { key: string; label: string; value: ReactNode; tip?: string }[] = [
    { key: 'league', label: 'League', value: leagueLabel(club.region, club.tier) },
    { key: 'city', label: 'City', value: `${club.city}, ${club.state ?? country(club.country)}` },
    { key: 'arena', label: 'Arena', value: `${club.arena.name} · ${club.arena.capacity.toLocaleString('en-US')}` },
    { key: 'fans', label: 'Fans', value: club.fans >= 1000 ? `${(club.fans / 1000).toFixed(1)}M` : `${club.fans}k` },
    {
      key: 'wages',
      label: 'Wages',
      tip: 'What the squad is paid this season, of the wage budget the board gives',
      value: (
        <>
          {money(pay, club.currency)} <span className="muted small">of {money(club.budget.wages, club.currency)}</span>
        </>
      ),
    },
    { key: 'transfers', label: 'Transfers', value: money(club.budget.transfers, club.currency), tip: 'Transfer budget this season' },
    {
      key: 'facilities',
      label: 'Facilities',
      tip: `Training ${f.training}, ${club.region === 'europe' ? 'youth academy' : 'college scouting'} ${f.youth}, medical ${f.medical} (out of 20)`,
      value: (
        <>
          {f.training} · {f.youth} · {f.medical} <span className="muted small">/20</span>
        </>
      ),
    },
  ];
  const shown = compact ? items.filter((i) => ['city', 'arena', 'wages', 'facilities'].includes(i.key)) : items;
  return (
    <div className={`cw-clubfacts ${compact ? 'compact' : ''}`}>
      {shown.map((i) => (
        <div key={i.key} title={i.tip}>
          <span>{i.label}</span>
          <b>{i.value}</b>
        </div>
      ))}
    </div>
  );
}
