// A club's squad (GAME_FLOW §6.2, slice brief W1 §6): tabs First team / Dev squad / Academy (academy
// only at European clubs) and a table: position, name, age, nationality, overall, morale, contract end,
// wage, and the buyout fee (budget clubs) or years left (cap clubs). A name opens the player page.

import { useState } from 'react';
import { money } from '../../../game/world/money';
import { academy, ageOf, devSquad, squad } from '../../../game/world/query';
import type { World, WorldClub, WorldPlayer } from '../../../game/world/types';
import { useSort } from '../../components/sortable';
import { MORALES } from '../../../game/world/types';
import { code3, contractEnd, country, mid, MoraleDot, overallRange, ratingTone, showRange } from './parts';

export type SquadTab = 'first' | 'dev' | 'academy';
const POS_ORDER = 'PG SG SF PF C';

export function SquadTabs({ club, tab, onTab }: { club: WorldClub; tab: SquadTab; onTab: (t: SquadTab) => void }) {
  const tabs: [SquadTab, string][] = [
    ['first', `First team · ${club.roster.length}`],
    ['dev', `Dev squad · ${club.dev.length}/5`],
    ...(club.region === 'europe' ? ([['academy', `Academy · ${club.academy.length}`]] as [SquadTab, string][]) : []),
  ];
  return (
    <div className="cr-tabs" role="tablist" aria-label="Squad lists">
      {tabs.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => onTab(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export const TAB_NOTE: Record<SquadTab, string> = {
  first: '13 players · 12 dress for a game',
  dev: 'Train with the club, don’t play in the league. Minimum wages, outside the cap and the threshold.',
  academy: 'Ages 15–18. They graduate to the first team at 18 or are released.',
};

export function playersOn(w: World, club: WorldClub, tab: SquadTab): WorldPlayer[] {
  return tab === 'first' ? squad(w, club) : tab === 'dev' ? devSquad(w, club) : academy(w, club);
}

export function SquadTable({ w, club, tab, onPlayer }: { w: World; club: WorldClub; tab: SquadTab; onPlayer: (id: string) => void }) {
  const cap = club.moneySystem === 'cap';
  const { sorted, th } = useSort<WorldPlayer>((wp, key) => {
    switch (key) {
      case 'pos':
        return POS_ORDER.indexOf(wp.p.position);
      case 'name':
        return wp.p.name;
      case 'age':
        return ageOf(w, wp);
      case 'nat':
        return country(wp.nationality);
      case 'ovr':
        return mid(overallRange(w, wp));
      case 'morale':
        return MORALES.indexOf(wp.morale);
      case 'end':
        return wp.contract?.years ?? null;
      case 'wage':
        return wp.contract?.wage ?? null;
      case 'last':
        return cap ? (wp.contract?.years ?? null) : (wp.contract?.buyout ?? null);
    }
    return null;
  });
  const rows = sorted(playersOn(w, club, tab));
  return (
    <div className="cr-card cr-table-wrap">
      <table className="cr-table">
        <thead>
          <tr>
            {th('pos', 'Pos')}
            {th('name', 'Player', { left: true })}
            {th('age', 'Age')}
            {th('nat', 'Nat', { tip: 'Nationality' })}
            {th('ovr', 'OVR', { tip: 'Overall: exact for your players, a scout estimate for others' })}
            {th('morale', 'Morale', { left: true })}
            {th('end', 'Contract', { tip: 'The summer the contract ends' })}
            {th('wage', 'Wage', { tip: 'Per season' })}
            {cap ? th('last', 'Years left') : th('last', 'Buyout', { tip: 'The fee another club pays to release him' })}
          </tr>
        </thead>
        <tbody>
          {rows.map((wp) => {
            const r = overallRange(w, wp);
            const k = wp.contract;
            return (
              <tr key={wp.p.id}>
                <td className="cr-pos">{wp.p.position}</td>
                <td className="left">
                  <button className="cr-name" onClick={() => onPlayer(wp.p.id)}>
                    {wp.p.name}
                  </button>
                  {k?.rookie && <span className="cr-tag">Rookie</span>}
                </td>
                <td>{ageOf(w, wp)}</td>
                <td className="muted" title={country(wp.nationality)}>
                  {code3(wp.nationality)}
                </td>
                <td className="cr-ovr" style={{ color: ratingTone(mid(r)) }}>
                  {showRange(r)}
                </td>
                <td className="left">
                  <MoraleDot m={wp.morale} />
                </td>
                <td className="muted">{k ? contractEnd(w, k.years) : 'Academy'}</td>
                <td>{k ? money(k.wage) : '—'}</td>
                <td className="muted">{k ? (cap ? `${k.years} ${k.years === 1 ? 'year' : 'years'}` : money(k.buyout ?? 0)) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SquadSection({ w, club, onPlayer }: { w: World; club: WorldClub; onPlayer: (id: string) => void }) {
  const [tab, setTab] = useState<SquadTab>('first');
  return (
    <>
      <div className="cr-row-head">
        <span className="cr-sub">{TAB_NOTE[tab]}</span>
        <SquadTabs club={club} tab={tab} onTab={setTab} />
      </div>
      <SquadTable w={w} club={club} tab={tab} onPlayer={onPlayer} />
    </>
  );
}
