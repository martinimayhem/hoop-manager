// A league before its season: its 16 clubs, strongest first, with what makes each one what it is.

import { composite } from '../../../engine/ratings';
import { money } from '../../../game/world/money';
import { leagueClubs, squad, strength } from '../../../game/world/query';
import type { Region, Tier, World, WorldClub } from '../../../game/world/types';
import { useSort } from '../../components/sortable';

export function LeagueTable({ w, region, tier, selected, onOpen }: { w: World; region: Region; tier: Tier; selected?: string | null; onOpen: (clubId: string) => void }) {
  const clubs = leagueClubs(w, region, tier);
  const rank = new Map(clubs.map((c, i) => [c.id, i + 1]));
  const best = (c: WorldClub) => squad(w, c)[0];
  const { sorted, th } = useSort<WorldClub>((c, key) => {
    switch (key) {
      case 'rank':
        return rank.get(c.id) ?? 0;
      case 'club':
        return c.name;
      case 'str':
        return strength(w, c);
      case 'star':
        return composite(best(c).p).overall;
      case 'wages':
        return c.budget.wages;
      case 'arena':
        return c.arena.capacity;
    }
    return null;
  });
  const mine = w.human?.club;
  return (
    <table className="eq cw-table cw-league">
      <thead>
        <tr>
          {th('rank', '#', { tip: 'By squad strength' })}
          {th('club', 'Club', { left: true, wide: true })}
          {th('str', 'Squad', { tip: 'Squad strength: the average rating of the best eight players' })}
          {th('star', 'Best player', { left: true, tip: 'The best player in the squad' })}
          {th('wages', 'Wage budget', { tip: 'What the board lets the club spend on wages this season' })}
          {th('arena', 'Arena', { tip: 'Seats in the arena' })}
        </tr>
      </thead>
      <tbody>
        {sorted(clubs).map((c) => (
          <tr key={c.id} className={`cw-row ${selected === c.id ? 'on' : ''} ${mine === c.id ? 'mine' : ''}`} onClick={() => onOpen(c.id)}>
            <td className="muted">{rank.get(c.id)}</td>
            <td className="left">
              <span className="cw-dot" style={{ background: c.colours[0], borderColor: c.colours[1] }} />
              <b>{c.name}</b> <span className="muted small">{c.state ?? c.country}</span>
            </td>
            <td>
              <b>{strength(w, c).toFixed(1)}</b>
            </td>
            <td className="left small">{best(c).p.name}</td>
            <td>{money(c.budget.wages, c.currency)}</td>
            <td className="muted">{c.arena.capacity.toLocaleString('en-US')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** America | Europe, and the four divisions. */
export function WhereSwitch({ region, tier, onRegion, onTier }: { region: Region; tier: Tier; onRegion: (r: Region) => void; onTier: (t: Tier) => void }) {
  return (
    <div className="cw-switch">
      <span className="hub-seg" title="America and Europe are separate: their clubs only meet in the Big League Finals">
        {(['america', 'europe'] as Region[]).map((r) => (
          <button key={r} className={region === r ? 'on' : ''} onClick={() => onRegion(r)}>
            {r === 'america' ? 'America' : 'Europe'}
          </button>
        ))}
      </span>
      <span className="hub-seg">
        {([1, 2, 3, 4] as Tier[]).map((t) => (
          <button key={t} className={tier === t ? 'on' : ''} onClick={() => onTier(t)}>
            {t === 1 ? 'Big League' : `Division ${t}`}
          </button>
        ))}
      </span>
    </div>
  );
}
