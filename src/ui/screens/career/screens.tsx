// The career's W1 screens (GAME_FLOW §6, slice brief W1 §6): Squad, the player page, Competitions (and
// each competition's table), and the club page (your Club screen, or any other club, read-only).

import { useState } from 'react';
import { ATTRIBUTE_GROUPS, DEFAULT_SCOUT_ACCURACY, scoutAttr } from '../../../game/scouting';
import { money } from '../../../game/world/money';
import { EUROPE_COUNTRIES } from '../../../game/world/places';
import { ageOf, clubById, competitionById, competitionsOf, leagueOf, moneySummary, ordinal, standings, strength, whereIs } from '../../../game/world/query';
import { REGION_NAME, type Competition, type World, type WorldClub } from '../../../game/world/types';
import { Badge, cameThrough, contractEnd, country, isMine, MoraleFace, CareerPortrait, Stars, playerStars, mid, overallRange, PayrollBar, potentialRange, ratingTone, showRange } from './parts';
import { SquadControls, SquadTable, TAB_NOTE, useSquadView, type SquadTab } from './SquadView';

export type View = { kind: 'squad' } | { kind: 'player'; id: string } | { kind: 'competitions' } | { kind: 'competition'; id: string } | { kind: 'club'; id: string };

export interface Nav {
  go: (v: View) => void;
  back: () => void;
  canBack: boolean;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="cr-card cr-stat">
      <span className="cr-label">{label}</span>
      <span className="cr-big">
        {value} {sub && <small>{sub}</small>}
      </span>
    </div>
  );
}

function BackLink({ nav, label }: { nav: Nav; label: string }) {
  if (!nav.canBack) return null;
  return (
    <button className="cr-back" onClick={nav.back}>
      ← {label}
    </button>
  );
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
  const first = club.roster.map((id) => w.players[id]);
  const avgAge = first.reduce((s, p) => s + ageOf(w, p), 0) / first.length;
  const m = moneySummary(w, club);
  return (
    <div className="cr-page">
      <div className="cr-row-head">
        <div>
          <h1>Squad</h1>
          <span className="cr-sub">{TAB_NOTE[tab]}</span>
        </div>
        <SquadControls club={club} tab={tab} onTab={setTab} view={view} onView={setView} />
      </div>
      <div className="cr-stats">
        <Stat label="Team rating" value={strength(w, club).toFixed(0)} sub={`· ${strengthRank(w, club)} in ${leagueOf(w, club.id).name}`} />
        <Stat label="Average age" value={avgAge.toFixed(1)} />
        {m.system === 'cap' ? <Stat label="Payroll" value={money(m.payroll)} sub={`/ cap ${money(m.cap)}`} /> : <Stat label="Budget used" value={money(m.committed)} sub={`/ ${money(m.budget)}`} />}
        <Stat label="Dev squad" value={`${club.dev.length}`} sub="/ 5" />
      </div>
      <SquadTable w={w} club={club} tab={tab} view={view} onPlayer={(id) => nav.go({ kind: 'player', id })} />
      <span className="cr-sub">Tap a name to open the player. Tap a column heading to sort.</span>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AttrRow({ label, lo, hi }: { label: string; lo: number; hi: number }) {
  const tone = ratingTone((lo + hi) / 2);
  return (
    <div className="cr-attr">
      <span>{label}</span>
      <span className="cr-attr-bar">
        {lo === hi ? <i style={{ width: `${hi}%`, background: tone }} /> : <i className="range" style={{ left: `${lo}%`, width: `${Math.max(2, hi - lo)}%`, background: tone }} />}
      </span>
      <b>{lo === hi ? lo : `${lo}–${hi}`}</b>
    </div>
  );
}

const PERSONALITY: [keyof World['players'][string]['personality'], string, string][] = [
  ['professionalism', 'Professionalism', 'Trains well: grows faster, declines slower'],
  ['ambition', 'Ambition', 'Wants minutes and a bigger club'],
  ['loyalty', 'Loyalty', 'Likes to stay at his club'],
  ['temperament', 'Temperament', 'Keeps his head in a heated game'],
];

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
  return (
    <div className="cr-page">
      <BackLink nav={nav} label="Back" />
      <section className="cr-card cr-player-head">
        <CareerPortrait w={w} wp={wp} size={132} />
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
            <span className="cr-chip">Hometown: {wp.hometown}</span>
          </div>
        </div>
        <div className="cr-player-stars">
          <div>
            <span className="cr-label">Ability</span>
            <Stars n={stars.ability} kind="ability" size={20} />
            <span className="cr-star-num">
              OVR <b style={{ color: ratingTone(mid(r)) }}>{showRange(r)}</b> <small>{mine ? 'exact' : 'scout estimate'}</small>
            </span>
          </div>
          <div>
            <span className="cr-label">Potential</span>
            <Stars n={stars.potential} kind="potential" size={20} />
            <span className="cr-star-num">
              Range <b style={{ color: 'var(--cr-blue)' }}>{showRange(pot)}</b> <small>{mine ? 'staff estimate' : 'scout estimate'}</small>
            </span>
          </div>
          <span className="cr-sub">Stars compare him with {stars.scale.label}.</span>
        </div>
      </section>

      <div className="cr-grid-2">
        <section className="cr-card">
          <h2>Attributes</h2>
          {ATTRIBUTE_GROUPS.map((g) => (
            <div key={g.key} className="cr-attr-group">
              <span className="cr-label">{g.label}</span>
              {g.attrs.map((a) => {
                const v = wp.p.attrs[a.key];
                const s = mine ? { lo: v, hi: v } : scoutAttr(wp.p, a.key, wp.reputation, DEFAULT_SCOUT_ACCURACY);
                return <AttrRow key={a.key} label={a.label} lo={s.lo} hi={s.hi} />;
              })}
            </div>
          ))}
          <div className="cr-attr-group">
            <span className="cr-label">Personality</span>
            {mine ? (
              PERSONALITY.map(([key, label, what]) => (
                <div key={key} className="cr-attr">
                  <span>{label}</span>
                  <span className="cr-attr-bar">
                    <i style={{ width: `${(wp.personality[key] / 20) * 100}%`, background: ratingTone((wp.personality[key] / 20) * 99) }} />
                  </span>
                  <b>{wp.personality[key]}</b>
                  <small className="cr-attr-what">{what}</small>
                </div>
              ))
            ) : (
              <span className="cr-sub">You learn his character once he is at your club.</span>
            )}
          </div>
          {!mine && <p className="cr-note">Scout estimates: the true rating is inside the range. Famous players are easier to read.</p>}
        </section>

        <div className="cr-col">
          <section className="cr-card">
            <h2>Contract</h2>
            {k && club ? (
              <dl className="cr-facts">
                <dt>Wage</dt>
                <dd>{money(k.wage)} a year</dd>
                <dt>Until</dt>
                <dd>
                  Summer {contractEnd(w, k.years)} · {k.years} {k.years === 1 ? 'season' : 'seasons'} left
                </dd>
                {cap ? (
                  <>
                    <dt>Type</dt>
                    <dd>{k.rookie ? 'Rookie-scale contract' : wp.status === 'dev' ? 'Minimum deal, outside the cap' : 'Salary-cap contract'}</dd>
                    <dt>Buyout fee</dt>
                    <dd className="muted">None: cap-system players move by trade</dd>
                  </>
                ) : (
                  <>
                    <dt>Buyout fee</dt>
                    <dd>{money(k.buyout ?? 0)}</dd>
                  </>
                )}
                <dt>Promises</dt>
                <dd className="muted">{wp.promises.length ? wp.promises.map((p) => p.what).join(', ') : 'None'}</dd>
              </dl>
            ) : (
              <p className="cr-note">{wp.status === 'academy' ? 'An academy player: no professional contract yet.' : wp.status === 'free' ? 'None: a free agent.' : wp.status === 'college' ? 'A college player: no contract.' : 'None.'}</p>
            )}
          </section>
          <section className="cr-card">
            <h2>Background</h2>
            <dl className="cr-facts">
              <dt>Born</dt>
              <dd>{wp.born}</dd>
              <dt>Came through</dt>
              <dd>{cameThrough(w, wp)}</dd>
              <dt>Known</dt>
              <dd>{wp.reputation >= 80 ? 'Everywhere' : wp.reputation >= 55 ? 'Across the league' : wp.reputation >= 30 ? 'In his league' : wp.reputation >= 12 ? 'Locally' : 'Hardly at all'}</dd>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function CompetitionsScreen({ w, nav }: { w: World; nav: Nav }) {
  const mine = w.human ? new Set(competitionsOf(w, w.human.club).map((c) => c.id)) : new Set<string>();
  const link = (c: Competition, label = c.name) => (
    <button key={c.id} className={`cr-comp ${mine.has(c.id) ? 'mine' : ''}`} onClick={() => nav.go({ kind: 'competition', id: c.id })}>
      <span>{label}</span>
      <small>
        {c.clubs.length} clubs{mine.has(c.id) ? ' · yours' : ''}
      </small>
    </button>
  );
  const america = w.competitions.filter((c) => c.region === 'america');
  const bigEurope = w.competitions.find((c) => c.kind === 'bigLeague' && c.region === 'europe')!;
  return (
    <div className="cr-page">
      <div>
        <h1>Competitions</h1>
        <span className="cr-sub">Every league in the world, before the season: all clubs 0–0. Cups start next slice.</span>
      </div>
      <section className="cr-card">
        <h2>{REGION_NAME.america}</h2>
        <div className="cr-comps">{america.map((c) => link(c))}</div>
      </section>
      <section className="cr-card">
        <h2>{REGION_NAME.europe}</h2>
        <div className="cr-comps">{link(bigEurope)}</div>
        <div className="cr-countries">
          {EUROPE_COUNTRIES.map((cc) => (
            <div key={cc} className="cr-country">
              <span className="cr-label">{country(cc)}</span>
              <div className="cr-comps">{w.competitions.filter((c) => c.country === cc).map((c) => link(c))}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const COMP_NOTE: Record<string, string> = {
  bigLeague: 'One league, two conferences. Big League Europe clubs also play their national league.',
  usDivision: 'Champion promoted, places 2–5 play off for the second spot; the bottom two go down.',
  nationalLeague: 'Double round-robin, then the national playoffs (tier 1) or a promotion race (tier 2).',
};

export function CompetitionTable({ w, id, nav }: { w: World; id: string; nav: Nav }) {
  const comp = competitionById(w, id);
  if (!comp) return <div className="cr-page">Not found.</div>;
  const rows = standings(w, comp);
  const europe = comp.kind === 'bigLeague' && comp.region === 'europe';
  return (
    <div className="cr-page">
      <BackLink nav={nav} label="Back" />
      <div>
        <h1>{comp.name}</h1>
        <span className="cr-sub">
          {comp.country ? `${country(comp.country)} · ` : ''}
          {comp.clubs.length} clubs · {COMP_NOTE[comp.kind]}
        </span>
      </div>
      <div className="cr-card cr-table-wrap">
        <table className="cr-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="left">Club</th>
              <th>W</th>
              <th>L</th>
              <th className="left">{europe ? 'Place' : 'Note'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const c = row.club;
              const me = w.human?.club === c.id;
              const also = competitionsOf(w, c.id).filter((x) => x.id !== comp.id);
              const note = europe ? (c.licence === 'licence' ? 'Licence' : 'Wildcard (this season)') : also.length ? `Also in ${also.map((x) => x.name).join(', ')}` : '';
              return (
                <tr key={c.id} className={me ? 'me' : ''}>
                  <td className="muted">{i + 1}</td>
                  <td className="left">
                    <button className="cr-name with-badge" onClick={() => nav.go({ kind: 'club', id: c.id })}>
                      <Badge club={c} size={28} />
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
      {europe && <span className="cr-sub">Licence clubs keep their place (a licence is lost after a third bottom-2 finish). Wildcards are earned again every season.</span>}
      <span className="cr-sub">Before the season every club is level at 0–0, so the table is in name order.</span>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ClubPage({ w, id, nav }: { w: World; id: string; nav: Nav }) {
  const club = clubById(w, id);
  const [tab, setTab] = useState<SquadTab>('first');
  const [view, setView] = useSquadView();
  if (!club) return <div className="cr-page">Club not found.</div>;
  const mine = w.human?.club === club.id;
  const comps = competitionsOf(w, club.id);
  const f = club.facilities;
  return (
    <div className="cr-page">
      {!mine && <BackLink nav={nav} label="Back" />}
      <section className="cr-card cr-club-head">
        <Badge club={club} size={64} />
        <div className="cr-club-id">
          <h1>{mine ? `Club · ${club.name}` : club.name}</h1>
          <span className="cr-sub big">
            {club.city}, {club.state ?? country(club.country)} · {club.arena.name} ({club.arena.capacity.toLocaleString('en-US')})
          </span>
          <div className="cr-chips">
            {comps.map((c) => (
              <button key={c.id} className="cr-chip link" onClick={() => nav.go({ kind: 'competition', id: c.id })}>
                {c.name}
              </button>
            ))}
            {club.licence && <span className="cr-chip warn">{club.licence === 'licence' ? 'Big League licence' : 'Big League wildcard'}</span>}
            <span className="cr-chip">{club.moneySystem === 'cap' ? 'Salary cap' : 'Club budget'}</span>
          </div>
        </div>
        <div className="cr-club-nums">
          <div>
            <span className="cr-label">Team rating</span>
            <span className="cr-huge">{strength(w, club).toFixed(0)}</span>
          </div>
          <div>
            <span className="cr-label">Fans</span>
            <span className="cr-huge small">{club.fans >= 1000 ? `${(club.fans / 1000).toFixed(1)}M` : `${club.fans}k`}</span>
          </div>
        </div>
      </section>

      <PayrollBar w={w} club={club} />

      {mine ? (
        <section className="cr-card">
          <h2>Facilities</h2>
          <dl className="cr-facts">
            <dt>Training centre</dt>
            <dd>{f.training} / 20</dd>
            <dt>{club.region === 'europe' ? 'Youth academy' : 'College scouting'}</dt>
            <dd>{f.youth} / 20</dd>
            <dt>Medical centre</dt>
            <dd>{f.medical} / 20</dd>
          </dl>
          <p className="cr-note">The board, staff, sponsors and facility requests arrive in a later slice.</p>
        </section>
      ) : (
        <>
          <div className="cr-row-head">
            <h2>Squad</h2>
            <SquadControls club={club} tab={tab} onTab={setTab} view={view} onView={setView} />
          </div>
          <SquadTable w={w} club={club} tab={tab} view={view} onPlayer={(pid) => nav.go({ kind: 'player', id: pid })} />
        </>
      )}
    </div>
  );
}
