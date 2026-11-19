// The career's W1 screens (GAME_FLOW §6, slice brief W1 §6): Squad, the player page, Competitions (and
// each competition's table), and the club page (your Club screen, or any other club, read-only).

import { Info } from 'lucide-react';
import { useState } from 'react';
import { ATTRIBUTE_GROUPS, DEFAULT_SCOUT_ACCURACY, scoutAttr } from '../../../game/scouting';
import { money } from '../../../game/world/money';
import { EUROPE_COUNTRIES } from '../../../game/world/places';
import { ageOf, clubById, competitionById, competitionsOf, leagueOf, ordinal, standings, strength, whereIs } from '../../../game/world/query';
import { REGION_NAME, type Competition, type World, type WorldClub } from '../../../game/world/types';
import { Badge, cameThrough, contractEnd, country, isMine, MoraleFace, CareerPortrait, Stars, playerStars, mid, overallRange, PayrollBar, potentialRange, ratingTone, showRange, useFitRows, Pager } from './parts';
import { SquadControls, SquadTable, TAB_NOTE, useSquadView, type SquadTab } from './SquadView';
import type { CareerView as View } from '../../nav';
import { SeasonTable } from './season';

export type { View };

/** Opening another career screen (a new entry in the browser's history: Back returns). */
export interface Nav {
  go: (v: View) => void;
}


// ---------------------------------------------------------------------------

/** Where a club's squad ranks in its league: "6th of 12". */
function strengthRank(w: World, club: WorldClub): string {
  const league = leagueOf(w, club.id);
  const s = strength(w, club);
  const above = league.clubs.filter((id) => strength(w, clubById(w, id)!) > s).length;
  return `${ordinal(above + 1)} of ${league.clubs.length}`;
}

export function SquadScreen({ w, club, nav }: { w: World; club: WorldClub; nav: Nav }) {
  const [tab, setTab] = useState<SquadTab>('first');
  const [view, setView] = useSquadView();
  // One header row, the table, one key line: a whole squad fits every screen (GAME_FLOW §6.1a).
  return (
    <div className="cr-page">
      <div className="cr-row-head">
        <h1 title={TAB_NOTE[tab]}>Squad</h1>
        <SquadControls club={club} tab={tab} onTab={setTab} view={view} onView={setView} />
      </div>
      <SquadTable w={w} club={club} tab={tab} view={view} onPlayer={(id) => nav.go({ kind: 'player', id })} />
    </div>
  );
}

/** Team rating and average age, for the club screen. */
function squadFacts(w: World, club: WorldClub) {
  const first = club.roster.map((id) => w.players[id]);
  return { rating: strength(w, club).toFixed(0), rank: strengthRank(w, club), league: leagueOf(w, club.id).name, age: (first.reduce((s, p) => s + ageOf(w, p), 0) / first.length).toFixed(1) };
}

// ---------------------------------------------------------------------------

function AttrRow({ label, lo, hi }: { label: string; lo: number; hi: number }) {
  const tone = ratingTone((lo + hi) / 2);
  return (
    <div className="cr-attr">
      <span>{label}</span>
      <span className="cr-attr-bar">
        {lo === hi ? <i style={{ width: `${hi}%`, background: tone }} /> : <i className="cr-fill-range" style={{ left: `${lo}%`, width: `${Math.max(2, hi - lo)}%`, background: tone }} />}
      </span>
      <b>{lo === hi ? lo : `${lo}–${hi}`}</b>
    </div>
  );
}

const PERSONALITY: [keyof World['players'][string]['personality'], string][] = [
  ['professionalism', 'Professionalism'],
  ['ambition', 'Ambition'],
  ['loyalty', 'Loyalty'],
  ['temperament', 'Temperament'],
];

/** The player page, compact: everything fits a desktop screen without scrolling. */
export function PlayerPage({ w, id, nav }: { w: World; id: string; nav: Nav }) {
  const wp = w.players[id];
  if (!wp) return <div className="cr-page">Player not found.</div>;
  const mine = isMine(w, wp);
  const club = wp.club ? clubById(w, wp.club) : undefined;
  const r = overallRange(w, wp);
  const pot = potentialRange(w, wp);
  const stars = playerStars(w, wp);
  const k = wp.contract;
  const cap = club?.moneySystem === 'cap';
  const origin = wp.origin.kind === 'academy' ? 'Academy graduate' : wp.origin.kind === 'college' ? 'College' : wp.origin.kind === 'star' ? 'Established star' : 'International';
  const group = (keys: string[]) =>
    ATTRIBUTE_GROUPS.filter((g) => keys.includes(g.key)).map((g) => (
      <div key={g.key} className="cr-attr-group">
        <span className="cr-label">{g.label}</span>
        {g.attrs.map((a) => {
          const v = wp.p.attrs[a.key];
          const s = mine ? { lo: v, hi: v } : scoutAttr(wp.p, a.key, wp.reputation, DEFAULT_SCOUT_ACCURACY);
          return <AttrRow key={a.key} label={a.label} lo={s.lo} hi={s.hi} />;
        })}
      </div>
    ));
  return (
    <div className="cr-page cr-player">
      <section className="cr-card cr-player-head">
        <CareerPortrait w={w} wp={wp} size={112} />
        <div className="cr-player-id">
          <div className="cr-player-name">
            <h1>{wp.p.name}</h1>
            <span className="cr-num">
              #{wp.p.number} · {wp.p.position}
            </span>
          </div>
          <span className="cr-sub big">
            {ageOf(w, wp)} years · {country(wp.nationality)} · {wp.p.heightCm} cm, {wp.p.weightKg} kg · {wp.p.archetype} · {origin}
          </span>
          <div className="cr-chips">
            <span className="cr-chip">
              <MoraleFace m={wp.morale} size={18} label />
            </span>
            {club ? (
              <button className="cr-chip link" onClick={() => nav.go({ kind: 'club', id: club.id })}>
                {whereIs(w, wp)}
              </button>
            ) : (
              <span className="cr-chip">{whereIs(w, wp)}</span>
            )}
            <span className="cr-chip">Stars vs {stars.scale.label.replace(/^the /, '')}</span>
          </div>
        </div>
        <div className="cr-player-stars">
          <span className="cr-label">Ability</span>
          <Stars n={stars.ability} kind="ability" size={20} />
          <b className="cr-star-num" style={{ color: ratingTone(mid(r)) }} title="Overall">
            {showRange(r)}
          </b>
          <span className="cr-label">Potential</span>
          <Stars n={stars.potential} kind="potential" size={20} />
          <b className="cr-star-num" style={{ color: 'var(--cr-blue)' }} title="Potential range">
            {showRange(pot)}
          </b>
        </div>
      </section>

      <div className="cr-player-grid">
        <section className="cr-card cr-player-attrs">
          <h2>Attributes</h2>
          <div className="cr-attr-cols">
            <div>{group(['physical', 'scoring'])}</div>
            <div>
              {group(['playmaking', 'defence'])}
              <div className="cr-attr-group">
                <span className="cr-label">Personality</span>
                {mine ? (
                  PERSONALITY.map(([key, label]) => (
                    <div key={key} className="cr-attr">
                      <span>{label}</span>
                      <span className="cr-attr-bar">
                        <i style={{ width: `${(wp.personality[key] / 20) * 100}%`, background: ratingTone((wp.personality[key] / 20) * 99) }} />
                      </span>
                      <b>{wp.personality[key]}</b>
                    </div>
                  ))
                ) : (
                  <span className="cr-sub">Unknown until he joins you.</span>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="cr-card">
          <h2>Contract</h2>
          <dl className="cr-facts">
            {k && club ? (
              <>
                <dt>Wage</dt>
                <dd>{money(k.wage)} a year</dd>
                <dt>Until</dt>
                <dd>
                  Summer {contractEnd(w, k.years)} · {k.years} {k.years === 1 ? 'season' : 'seasons'} left
                </dd>
                {cap ? (
                  <>
                    <dt>Type</dt>
                    <dd>{k.rookie ? 'Rookie scale' : wp.status === 'dev' ? 'Minimum, outside the cap' : 'Salary cap'}</dd>
                  </>
                ) : (
                  <>
                    <dt>Buyout fee</dt>
                    <dd>{money(k.buyout ?? 0)}</dd>
                  </>
                )}
                <dt>Promises</dt>
                <dd className="muted">{wp.promises.length ? wp.promises.map((p) => p.what).join(', ') : 'None'}</dd>
              </>
            ) : (
              <>
                <dt>Contract</dt>
                <dd className="muted">{wp.status === 'academy' ? 'Academy, none yet' : wp.status === 'free' ? 'Free agent' : 'None'}</dd>
              </>
            )}
          </dl>
          <h2>Background</h2>
          <dl className="cr-facts">
            <dt>Born</dt>
            <dd>{wp.born}</dd>
            <dt>Hometown</dt>
            <dd>{wp.hometown}</dd>
            <dt>Came through</dt>
            <dd>{cameThrough(w, wp)}</dd>
            <dt>Known</dt>
            <dd>{wp.reputation >= 80 ? 'Everywhere' : wp.reputation >= 55 ? 'Across the league' : wp.reputation >= 30 ? 'In his league' : wp.reputation >= 12 ? 'Locally' : 'Hardly at all'}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function CompetitionsScreen({ w, nav }: { w: World; nav: Nav }) {
  const mine = w.human ? new Set(competitionsOf(w, w.human.club).map((c) => c.id)) : new Set<string>();
  const link = (c: Competition, label = c.name) => (
    <button key={c.id} className={`cr-comp ${mine.has(c.id) ? 'mine' : ''}`} onClick={() => nav.go({ kind: 'competition', id: c.id })}>
      {label}
      <small>{c.clubs.length}</small>
    </button>
  );
  const america = w.competitions.filter((c) => c.region === 'america');
  const bigEurope = w.competitions.find((c) => c.kind === 'bigLeague' && c.region === 'europe')!;
  // Tier 2 is shown as "2" beside its country's first tier ("Spanish League · 2").
  return (
    <div className="cr-page">
      <div className="cr-row-head">
        <h1>Competitions</h1>
        <span className="cr-sub">Your competitions are marked. Open one for its table and results.</span>
      </div>
      <section className="cr-card cr-comp-region">
        <h2>{REGION_NAME.america}</h2>
        <div className="cr-comps">{america.map((c) => link(c))}</div>
      </section>
      <section className="cr-card cr-comp-region">
        <div className="cr-row-head">
          <h2>{REGION_NAME.europe}</h2>
          <div className="cr-comps">{link(bigEurope)}</div>
        </div>
        <div className="cr-countries">
          {EUROPE_COUNTRIES.map((cc) => {
            const tiers = w.competitions.filter((c) => c.country === cc).sort((a, b) => a.tier - b.tier);
            return (
              <div key={cc} className="cr-country">
                <span className="cr-label">{country(cc)}</span>
                <div className="cr-comps">{tiers.map((c) => link(c, c.tier === 1 ? 'Tier 1' : 'Tier 2'))}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function CompetitionTable({ w, id, nav }: { w: World; id: string; nav: Nav }) {
  const comp = competitionById(w, id);
  if (!comp) return <div className="cr-page">Not found.</div>;
  // From the season's first day the table counts (slice W2a); a W1 world without a season is in name order.
  return w.play ? <SeasonTable w={w} comp={comp} nav={nav} /> : <CompetitionRows w={w} comp={comp} all={standings(w, comp)} nav={nav} />;
}

function CompetitionRows({ w, comp, all, nav }: { w: World; comp: Competition; all: ReturnType<typeof standings>; nav: Nav }) {
  const fit = useFitRows(all.length, '.cr-table tbody tr', comp.id);
  const rows = all.slice(fit.from, fit.to);
  const europe = comp.kind === 'bigLeague' && comp.region === 'europe';
  return (
    <div className="cr-page">
      <div className="cr-row-head start">
        <h1>{comp.name}</h1>
        <span className="cr-sub">
          {comp.country ? `${country(comp.country)} · ` : ''}
          {comp.clubs.length} clubs · in name order until the first game
        </span>
        <Pager fit={fit} total={all.length} />
      </div>
      <div className="cr-card cr-table-wrap">
        <table className="cr-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="left">Club</th>
              <th>W</th>
              <th>L</th>
              <th className="left">{europe ? 'Place' : 'Also plays in'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const c = row.club;
              const me = w.human?.club === c.id;
              const also = competitionsOf(w, c.id).filter((x) => x.id !== comp.id);
              const note = europe ? (c.licence === 'licence' ? 'Licence' : 'Wildcard this season') : also.map((x) => x.name).join(', ');
              return (
                <tr key={c.id} className={me ? 'me' : ''}>
                  <td className="muted">{fit.from + i + 1}</td>
                  <td className="left">
                    <button className="cr-name with-badge" onClick={() => nav.go({ kind: 'club', id: c.id })}>
                      <Badge club={c} size={22} />
                      {c.name}
                    </button>
                    {me && <span className="cr-tag accent">You</span>}
                  </td>
                  <td>{row.w}</td>
                  <td>{row.l}</td>
                  <td className="left">{note && <span className={`cr-tag ${c.licence === 'wildcard' && europe ? 'warn' : ''}`}>{note}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The club's identity and money: the header, the payroll bar, facilities and squad facts. */
function ClubInfo({ w, club, nav }: { w: World; club: WorldClub; nav: Nav }) {
  const comps = competitionsOf(w, club.id);
  const f = club.facilities;
  const facts = squadFacts(w, club);
  return (
    <>
      <section className="cr-card cr-club-head">
        <Badge club={club} size={52} />
        <div className="cr-club-id">
          <span className="cr-sub big">
            {club.city}, {club.state ?? country(club.country)} · {club.arena.name} ({club.arena.capacity.toLocaleString('en-US')}) · {club.fans >= 1000 ? `${(club.fans / 1000).toFixed(1)}M` : `${club.fans}k`} fans
          </span>
          <div className="cr-chips">
            {comps.map((c) => (
              <button key={c.id} className="cr-chip link" onClick={() => nav.go({ kind: 'competition', id: c.id })}>
                {c.name}
              </button>
            ))}
            {club.licence && <span className="cr-chip warn">{club.licence === 'licence' ? 'Big League licence' : 'Big League wildcard'}</span>}
          </div>
        </div>
      </section>
      <div className="cr-club-grid">
        <PayrollBar w={w} club={club} />
        <section className="cr-card">
          <h2>Squad and facilities</h2>
          <dl className="cr-facts">
            <dt>Team rating</dt>
            <dd>
              {facts.rating} · {facts.rank} in {facts.league}
            </dd>
            <dt>Average age</dt>
            <dd>{facts.age}</dd>
            <dt>Training centre</dt>
            <dd>{f.training} / 20</dd>
            <dt>{club.region === 'europe' ? 'Youth academy' : 'College scouting'}</dt>
            <dd>{f.youth} / 20</dd>
            <dt>Medical centre</dt>
            <dd>{f.medical} / 20</dd>
          </dl>
        </section>
      </div>
    </>
  );
}

export function ClubPage({ w, id, nav }: { w: World; id: string; nav: Nav }) {
  const club = clubById(w, id);
  const [tab, setTab] = useState<SquadTab>('first');
  const [view, setView] = useSquadView();
  const [info, setInfo] = useState(false);
  if (!club) return <div className="cr-page">Club not found.</div>;
  const mine = w.human?.club === club.id;
  if (mine)
    return (
      <div className="cr-page">
        <div className="cr-row-head start">
          <h1>Club · {club.name}</h1>
        </div>
        <ClubInfo w={w} club={club} nav={nav} />
      </div>
    );
  // Another club: one header row, then its squad (or its club information), so the whole squad fits.
  return (
    <div className="cr-page">
      <div className="cr-row-head cr-club-bar">
        <Badge club={club} size={30} />
        <h1 className="cr-club-title" title={club.name}>
          {club.name}
        </h1>
        {!info && <SquadControls club={club} tab={tab} onTab={setTab} view={view} onView={setView} />}
        <button className={`cr-toggle ${info ? 'on' : ''}`} aria-pressed={info} onClick={() => setInfo(!info)} title={info ? 'Back to the squad' : 'Club information and money'}>
          <Info size={18} aria-hidden="true" /> {info ? 'Squad' : 'Club'}
        </button>
      </div>
      {info ? <ClubInfo w={w} club={club} nav={nav} /> : <SquadTable w={w} club={club} tab={tab} view={view} onPlayer={(pid) => nav.go({ kind: 'player', id: pid })} />}
    </div>
  );
}
