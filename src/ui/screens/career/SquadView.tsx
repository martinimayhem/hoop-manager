// A club's squad (GAME_FLOW §6.2, §6.4; slice brief W1 §6): tabs First team / Dev squad / Academy
// (academy only at European clubs) and a view switch Overview / Attributes / Profile. Every column
// sorts; other clubs' players show scout ranges; potential is always a range. A name opens the
// player page. The chosen view is remembered on this device. Every view fits 768 px.

import { useState, type ReactNode } from 'react';
import { ATTRIBUTE_GROUPS, DEFAULT_SCOUT_ACCURACY, scoutAttr, type AttrKey, type Range } from '../../../game/scouting';
import { money } from '../../../game/world/money';
import { academy, ageOf, devSquad, squad } from '../../../game/world/query';
import { MORALES, type World, type WorldClub, type WorldPlayer } from '../../../game/world/types';
import { useSort, type SortValue } from '../../components/sortable';
import { cameThrough, CareerPortrait, code3, contractEnd, country, isMine, mid, MoraleFace, MoraleLegend, overallRange, playerStars, potentialRange, ratingTone, Stars, useFitRows, Pager, type StarKind } from './parts';
import { starScale } from '../../../game/world/query';

export type SquadTab = 'first' | 'dev' | 'academy';
export type SquadViewId = 'overview' | 'attributes' | 'profile';
const POS_ORDER = 'PG SG SF PF C';
const VIEW_KEY = 'hm.squadView';

export function SquadTabs({ club, tab, onTab }: { club: WorldClub; tab: SquadTab; onTab: (t: SquadTab) => void }) {
  const tabs: [SquadTab, string, string][] = [
    ['first', 'First team', `· ${club.roster.length}`],
    ['dev', 'Dev squad', `· ${club.dev.length}/5`],
    ...(club.region === 'europe' ? ([['academy', 'Academy', `· ${club.academy.length}`]] as [SquadTab, string, string][]) : []),
  ];
  return (
    <div className="cr-tabs" role="tablist" aria-label="Squad lists">
      {tabs.map(([id, label, count]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => onTab(id)}>
          {label} <span className="cr-count">{count}</span>
        </button>
      ))}
    </div>
  );
}

const VIEWS: [SquadViewId, string][] = [
  ['overview', 'Overview'],
  ['attributes', 'Attributes'],
  ['profile', 'Profile'],
];

/** The view last chosen on this device (Overview by default). */
export function useSquadView(): [SquadViewId, (v: SquadViewId) => void] {
  const [view, setView] = useState<SquadViewId>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === 'attributes' || v === 'profile' ? v : 'overview';
    } catch {
      return 'overview';
    }
  });
  const set = (v: SquadViewId) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* this visit only */
    }
  };
  return [view, set];
}

export function ViewSwitch({ view, onView }: { view: SquadViewId; onView: (v: SquadViewId) => void }) {
  return (
    <div className="cr-tabs cr-views" role="radiogroup" aria-label="Table view">
      {VIEWS.map(([id, label]) => (
        <button key={id} role="radio" aria-checked={view === id} className={view === id ? 'on' : ''} onClick={() => onView(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** The tabs and the view switch, side by side (wrapping on a narrow screen). */
export function SquadControls({ club, tab, onTab, view, onView }: { club: WorldClub; tab: SquadTab; onTab: (t: SquadTab) => void; view: SquadViewId; onView: (v: SquadViewId) => void }) {
  return (
    <div className="cr-controls">
      <SquadTabs club={club} tab={tab} onTab={onTab} />
      <ViewSwitch view={view} onView={onView} />
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

/** The 11 ratings in the Attributes view, in the player page's order, with their short headers. */
const SHORT: Record<AttrKey, string> = { speed: 'SPD', stamina: 'STA', shooting: 'MID', three: '3PT', freeThrow: 'FT', layup: 'LAY', dunk: 'DNK', passing: 'PAS', dribbling: 'DRI', rebounding: 'REB', tactics: 'IQ' };
const ATTRS = ATTRIBUTE_GROUPS.flatMap((g) => g.attrs);

function attrRange(w: World, wp: WorldPlayer, key: AttrKey): Range {
  if (isMine(w, wp)) return { lo: wp.p.attrs[key], hi: wp.p.attrs[key] };
  return scoutAttr(wp.p, key, wp.reputation, DEFAULT_SCOUT_ACCURACY);
}

/** A rating cell: the number (or range) in its colour. On a tablet the Attributes view stacks a range: low, then –high. */
function RangeNum({ r }: { r: Range }) {
  return (
    <span className="cr-num-cell" style={{ color: ratingTone(mid(r)) }}>
      {r.lo === r.hi ? (
        r.lo
      ) : (
        <>
          {r.lo}
          <span className="hi">–{r.hi}</span>
        </>
      )}
    </span>
  );
}

export function SquadTable({ w, club, tab, view, onPlayer }: { w: World; club: WorldClub; tab: SquadTab; view: SquadViewId; onPlayer: (id: string) => void }) {
  const cap = club.moneySystem === 'cap';
  const { sorted, th, sortButton } = useSort<WorldPlayer>((wp, key): SortValue => {
    if (key.startsWith('a:')) return mid(attrRange(w, wp, key.slice(2) as AttrKey));
    switch (key) {
      case 'pos':
        return POS_ORDER.indexOf(wp.p.position);
      case 'name':
        return wp.p.name;
      case 'age':
        return ageOf(w, wp);
      case 'nat':
        return country(wp.nationality);
      case 'ht':
        return wp.p.heightCm;
      case 'wt':
        return wp.p.weightKg;
      case 'ovr':
        return mid(overallRange(w, wp));
      case 'pot':
        return mid(potentialRange(w, wp));
      case 'abil*':
        return playerStars(w, wp).ability * 100 + mid(overallRange(w, wp));
      case 'pot*':
        return playerStars(w, wp).potential * 100 + mid(potentialRange(w, wp));
      case 'morale':
        return MORALES.indexOf(wp.morale);
      case 'end':
        return wp.contract?.years ?? null;
      case 'wage':
        return wp.contract?.wage ?? null;
      case 'last':
        return cap ? (wp.contract?.years ?? null) : (wp.contract?.buyout ?? null);
      case 'arch':
        return wp.p.archetype;
      case 'origin':
        return cameThrough(w, wp);
      case 'home':
        return wp.hometown;
    }
    return null;
  });
  const all = sorted(playersOn(w, club, tab));
  const fit = useFitRows(all.length, '.cr-table tbody tr', `${club.id}|${tab}|${view}`);
  const rows = all.slice(fit.from, fit.to);
  const name = (wp: WorldPlayer) => (
    <td className="left cr-player-cell">
      <button className="cr-name" onClick={() => onPlayer(wp.p.id)}>
        {wp.p.name}
      </button>
      {wp.contract?.rookie && <span className="cr-tag">Rookie</span>}
    </td>
  );
  const pos = (wp: WorldPlayer) => <td className="cr-pos">{wp.p.position}</td>;
  const ovr = (wp: WorldPlayer) => (
    <td className="cr-ovr">
      <RangeNum r={overallRange(w, wp)} />
    </td>
  );
  const face = (wp: WorldPlayer) => (
    <td className="cr-portrait-cell" aria-hidden="true">
      <CareerPortrait w={w} wp={wp} size={26} />
    </td>
  );
  const star = (wp: WorldPlayer, kind: StarKind) => (
    <td className="cr-star-cell">
      <Stars n={playerStars(w, wp)[kind]} kind={kind} size={11} />
    </td>
  );
  const scale = starScale(w, club.id);
  const starKey = (
    <>
      Stars vs {scale.label.replace(/^the /, '')}: <b className="cr-ab">ability</b> · <b className="cr-po">potential</b> (estimates)
    </>
  );

  let head: ReactNode;
  let body: (wp: WorldPlayer) => ReactNode;
  let key: ReactNode = null;
  if (view === 'overview') {
    head = (
      <>
        {th('face', '', { plain: true })}
        {th('pos', 'Pos')}
        {th('name', 'Player', { left: true })}
        {th('age', 'Age')}
        {th('nat', 'Nat', { tip: 'Nationality' })}
        {th('abil*', 'Ability', { left: true, tip: 'Ability stars' })}
        {th('pot*', 'Potential', { left: true, tip: 'Potential stars' })}
        {th('morale', 'Mor.', { tip: 'Morale' })}
        {th('end', 'Ends', { tip: 'The summer the contract ends' })}
        {th('wage', 'Wage', { tip: 'Per season' })}
        {cap ? th('last', 'Yrs left', { tip: 'Years left on the contract' }) : th('last', 'Buyout', { tip: 'The fee another club pays to release him' })}
      </>
    );
    body = (wp) => {
      const k = wp.contract;
      return (
        <>
          {face(wp)}
          {pos(wp)}
          {name(wp)}
          <td>{ageOf(w, wp)}</td>
          <td className="muted">{code3(wp.nationality)}</td>
          {star(wp, 'ability')}
          {star(wp, 'potential')}
          <td className="cr-face-cell">
            <MoraleFace m={wp.morale} />
          </td>
          <td className="muted">{k ? contractEnd(w, k.years) : '—'}</td>
          <td>{k ? money(k.wage) : '—'}</td>
          <td className="muted">{k ? (cap ? k.years : money(k.buyout ?? 0)) : '—'}</td>
        </>
      );
    };
    key = (
      <>
        {starKey}
        <MoraleLegend />
      </>
    );
  } else if (view === 'attributes') {
    head = (
      <>
        {th('pos', 'Pos')}
        {th('name', 'Player', { left: true })}
        {th('ovr', 'OVR')}
        {ATTRS.map((a) => th(`a:${a.key}`, SHORT[a.key], { tip: a.label }))}
      </>
    );
    body = (wp) => (
      <>
        {pos(wp)}
        {name(wp)}
        {ovr(wp)}
        {ATTRS.map((a) => (
          <td key={a.key} className="cr-attr-cell">
            <RangeNum r={attrRange(w, wp, a.key)} />
          </td>
        ))}
      </>
    );
    key = <>{ATTRS.map((a) => `${SHORT[a.key]} ${a.label.toLowerCase()}`).join(' · ')}.</>;
  } else {
    head = (
      <>
        {th('face', '', { plain: true })}
        {th('pos', 'Pos')}
        {th('name', 'Player', { left: true })}
        {th('age', 'Age')}
        {th('ht', 'Ht', { tip: 'Height' })}
        {th('wt', 'Wt', { tip: 'Weight' })}
        {th('arch', 'Archetype', { left: true })}
        {th('origin', 'Origin', { left: true, tip: 'College or academy' })}
        {th('home', 'Hometown', { left: true })}
        {th('pot*', 'Potential', { left: true, tip: 'Potential stars' })}
      </>
    );
    body = (wp) => (
      <>
        {face(wp)}
        {pos(wp)}
        {name(wp)}
        <td>{ageOf(w, wp)}</td>
        <td>{wp.p.heightCm}</td>
        <td>{wp.p.weightKg}</td>
        <td className="left wrap">{wp.p.archetype}</td>
        <td className="left wrap muted">{cameThrough(w, wp)}</td>
        <td className="left wrap muted">{wp.hometown}</td>
        {star(wp, 'potential')}
      </>
    );
    key = (
      <>
        {starKey} · Ht cm · Wt kg
      </>
    );
  }

  return (
    <>
      {sortButton}
      <div className={`cr-card cr-table-wrap view-${view}`}>
        <table className="cr-table">
          <thead>
            <tr>{head}</tr>
          </thead>
          <tbody>
            {rows.map((wp) => (
              <tr key={wp.p.id}>{body(wp)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="cr-key">
        {key}
        {view === 'attributes' && rows.some((wp) => !isMine(w, wp)) ? ' · ranges are scout estimates' : ''}
        <Pager fit={fit} total={all.length} />
      </span>
    </>
  );
}
