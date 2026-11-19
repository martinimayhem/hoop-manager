// A new game, step 2: the league chosen, pick the club you will manage. All eight clubs have their
// squads already (put together by the computer); each card says how strong it is, what kind of team
// it is and who its best players are, and the chosen club's whole squad is beside them.

import { useMemo, useState } from 'react';
import { composite } from '../../../engine/ratings';
import type { Team } from '../../../engine/types';
import { LEAGUES, type LeagueId } from '../../../game/league/leagues';
import { createLeague, takeOver, teamOf, type QuickLeague } from '../../../game/league/quickLeague';
import { listSlots, summarise } from '../../../game/league/saves';
import { Rating } from '../../components/common';
import { browserStorage } from './storage';
import { TopBar } from '../../components/TopBar';
import { useConfirm } from '../../components/Confirm';
import { NextIcon } from '../../icons';

interface Club {
  index: number;
  team: Team;
  strength: number;
  rank: number;
  tags: string[];
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

function standing(rank: number): { label: string; cls: string } {
  if (rank <= 2) return { label: 'Title favourites', cls: 'fav' };
  if (rank <= 4) return { label: 'Contenders', cls: 'con' };
  if (rank <= 6) return { label: 'Mid-table', cls: 'mid' };
  return { label: 'Underdogs', cls: 'dog' };
}

/** How strong each club is (its best eight), and what kind of team it is next to the others. */
function clubsOf(q: QuickLeague): Club[] {
  const teams = q.teams.map((_, i) => teamOf(q, i));
  const top8 = (t: Team) => [...t.players].sort((a, b) => composite(b).overall - composite(a).overall).slice(0, 8);
  const stats = teams.map((t) => {
    const ps = top8(t);
    return {
      strength: avg(ps.map((p) => composite(p).overall)),
      height: avg(ps.map((p) => p.heightCm)),
      speed: avg(ps.map((p) => p.attrs.speed)),
      three: avg(ps.map((p) => composite(p).three)),
      inside: avg(ps.map((p) => composite(p).insideScoring)),
    };
  });
  const mean = (k: keyof (typeof stats)[number]) => avg(stats.map((s) => s[k]));
  const ranked = [...stats.keys()].sort((a, b) => stats[b].strength - stats[a].strength);
  return teams.map((team, index) => {
    const s = stats[index];
    const tags: string[] = [];
    if (s.height >= mean('height') + 1.5) tags.push('Big');
    else if (s.height <= mean('height') - 1.5) tags.push('Small');
    if (s.speed >= mean('speed') + 1.5) tags.push('Quick');
    if (s.three >= mean('three') + 1.5) tags.push('Shooters');
    if (s.inside >= mean('inside') + 1.5) tags.push('Strong inside');
    return { index, team, strength: s.strength, rank: ranked.indexOf(index) + 1, tags: tags.slice(0, 2) };
  });
}

export function ClubPicker({ league, onStart }: { league: LeagueId; onStart: (q: QuickLeague, slot: number) => void }) {
  // A new league each time the screen opens: new squads, a new schedule.
  const [q] = useState(() => createLeague(league, Date.now() >>> 0));
  const clubs = useMemo(() => clubsOf(q), [q]);
  const [pick, setPick] = useState(() => clubs.find((c) => c.rank === 4)?.index ?? 0);
  const [manager, setManager] = useState('');
  const [slots] = useState(() => listSlots(browserStorage));
  const empty = slots.findIndex((s) => s.status === 'empty');
  const [replace, setReplace] = useState<number | null>(null);
  const slot = empty >= 0 ? empty : replace;
  const chosen = clubs[pick];
  const roster = [...chosen.team.players].sort((a, b) => composite(b).overall - composite(a).overall);
  const st = standing(chosen.rank);

  const confirm = useConfirm();
  const start = () => {
    if (slot === null) return;
    const go = () => onStart(takeOver(q, pick, manager.trim() || undefined), slot);
    if (empty >= 0) return go();
    const s = slots[slot];
    const what = s.status === 'ok' ? `${summarise(s.data).club} (${summarise(s.data).league})` : 'the save';
    confirm.ask({ title: `Replace ${what}?`, body: `Your new game goes in slot ${slot + 1}, and the game saved there is gone for good.`, confirm: 'Replace it', cancel: 'Keep it', danger: true }, go);
  };

  return (
    <div className="cp">
      <TopBar crumbs={[{ label: 'New Quick League', route: { s: 'menu' } }, { label: LEAGUES[league].name, route: { s: 'quick-new', league } }]} />
      {confirm.dialog}
      <header className="cp-bar">
        <div>
          <h1>{LEAGUES[league].name}</h1>
          <span className="muted small">Choose the club you will manage. 14 matchdays against the other seven.</span>
        </div>
      </header>

      <div className="cp-main">
        <div className="cp-grid" role="radiogroup" aria-label="Club">
          {clubs.map((c) => {
            const s = standing(c.rank);
            const stars = [...c.team.players].sort((a, b) => composite(b).overall - composite(a).overall).slice(0, 2);
            return (
              <button key={c.index} role="radio" aria-checked={pick === c.index} className={`cp-club ${pick === c.index ? 'on' : ''}`} onClick={() => setPick(c.index)}>
                <div className="cp-club-top">
                  <b>{c.team.name}</b>
                  <span className="cp-strength" title="Average rating of the best eight players">
                    {c.strength.toFixed(1)}
                  </span>
                </div>
                <div className="cp-club-mid">
                  <span className={`cp-standing ${s.cls}`}>{s.label}</span>
                  {c.tags.map((t) => (
                    <span key={t} className="cp-tag">
                      {t}
                    </span>
                  ))}
                </div>
                <small>
                  Stars: {stars.map((p) => p.name).join(', ')}
                </small>
              </button>
            );
          })}
        </div>

        <aside className="panel cp-side">
          <h3>{chosen.team.name}</h3>
          <div className="cp-side-sum">
            <span className={`cp-standing ${st.cls}`}>{st.label}</span>
            <span className="muted small">
              {chosen.rank === 1 ? 'The strongest squad in the league' : `${chosen.rank}${['th', 'st', 'nd', 'rd'][chosen.rank] ?? 'th'} strongest squad of 8`}
            </span>
          </div>
          <table className="eq cp-roster">
            <thead>
              <tr>
                <th className="left wide" style={{ width: '58%' }}>
                  Player
                </th>
                <th>Pos</th>
                <th title="Height (cm)">Ht</th>
                <th title="Overall rating">OVR</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((p) => (
                <tr key={p.id}>
                  <td className="left">
                    {p.name} <span className="muted small">{p.archetype}</span>
                  </td>
                  <td>{p.position}</td>
                  <td className="muted">{p.heightCm}</td>
                  <td>
                    <Rating v={composite(p).overall} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="cp-name">
            <span>Your name (manager)</span>
            <input value={manager} maxLength={24} placeholder="optional" onChange={(e) => setManager(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && start()} />
          </label>
          {empty < 0 && (
            <div className="cp-replace">
              <span className="muted small">All three save slots are in use. Save over:</span>
              {slots.map((s) => (
                <button key={s.slot} className={`small ${replace === s.slot ? 'active' : ''}`} onClick={() => setReplace(s.slot)} title={s.status === 'ok' ? `${summarise(s.data).club}, ${summarise(s.data).league}` : undefined}>
                  Slot {s.slot + 1}
                  {s.status === 'ok' ? ` · ${summarise(s.data).club}` : ''}
                </button>
              ))}
            </div>
          )}
          <button className="primary big" disabled={slot === null} onClick={start}>
            Manage {chosen.team.name} <NextIcon />
          </button>
        </aside>
      </div>
    </div>
  );
}
