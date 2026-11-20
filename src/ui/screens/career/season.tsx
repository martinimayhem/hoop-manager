// The career's season screens (slice brief W2a §4): Home, Tactics, Schedule, a game's box score, the
// competition tables that now count, and the season review. Within the screen rules: nothing scrolls
// (long lists are paged), 14 px, Back in the top bar.

import { useState } from 'react';
import type { GamePlan } from '../../../engine/types';
import { longDate, monthOf, shortDate } from '../../../game/season/calendar';
import {
  boxOf,
  boxScore,
  compGames,
  compName,
  dressedIds,
  humanGames,
  humanGameToday,
  humanPlan,
  isKey,
  nextHumanGame,
  playOf,
  squadTeam,
  table,
  type Row,
} from '../../../game/season/play';
import { BIG_LEAGUE, type SeasonGame } from '../../../game/season/types';
import { clubById, competitionById, competitionsOf } from '../../../game/world/query';
import type { Competition, World, WorldClub } from '../../../game/world/types';
import { TeamTable } from '../../components/BoxScoreTable';
import { PlanEditor } from '../../components/PlanEditor';
import { useMedia } from '../../components/useMedia';
import { NextIcon, PrevIcon } from '../../icons';
import { Badge, Pager, useFitRows } from './parts';
import { Bracket, KeyTag, SituationCard } from './postseason';
import type { Nav } from './screens';

const TEAM_COLOURS = ['var(--home)', 'var(--away)'];

/** A game from one club's side: the opponent, home or away, and the result once played. */
function fromSide(w: World, g: SeasonGame, clubId: string) {
  const home = g.home === clubId;
  const opp = clubById(w, home ? g.away : g.home)!;
  const result = g.score ? { us: home ? g.score[0] : g.score[1], them: home ? g.score[1] : g.score[0] } : null;
  return { home, opp, result, won: result ? result.us > result.them : null };
}

/** The competition a game is shown under (a Big League game: the conference of the club looking at it). */
function compOfGame(w: World, g: SeasonGame, clubId: string): Competition | undefined {
  if (g.comp !== BIG_LEAGUE) return competitionById(w, g.comp);
  return competitionsOf(w, clubId).find((c) => c.kind === 'bigLeague');
}

function record(rows: Row[], clubId: string): string {
  const r = rows.find((x) => x.club === clubId);
  return r ? `${r.won}–${r.lost}` : '0–0';
}

/** A club's record in the competition of a game. */
function recordIn(w: World, g: SeasonGame, clubId: string): string {
  const c = compOfGame(w, g, clubId);
  return c ? record(table(w, c.id), clubId) : '0–0';
}

function ResultTag({ won, result }: { won: boolean | null; result: { us: number; them: number } | null }) {
  if (!result) return <span className="muted">—</span>;
  return (
    <span className={`cr-result ${won ? 'won' : 'lost'}`}>
      <b>{won ? 'W' : 'L'}</b> {result.us}–{result.them}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Home

export function HomeScreen({ w, nav, onPrepare }: { w: World; nav: Nav; onPrepare: () => void }) {
  const p = playOf(w);
  const me = clubById(w, w.human!.club)!;
  const next = nextHumanGame(w);
  const today = humanGameToday(w);
  const played = humanGames(w).filter((g) => g.score);
  const last = played.slice(-5).reverse();
  const comps = competitionsOf(w, me.id);
  const inbox = [...p.inbox].reverse();
  // Inbox messages can be long: it pages down to one at a time if it must.
  const fit = useFitRows(inbox.length, '.cr-inbox li', p.inbox.length, undefined, 1);
  return (
    <div className="cr-page">
      <div className="cr-row-head">
        <h1>Home</h1>
        <span className="cr-sub">{p.phase === 'before' ? 'The season starts with your next Continue.' : p.phase === 'review' ? 'The regular season is over.' : longDate(w.season, p.day)}</span>
      </div>
      <div className="cr-home">
        <div className="cr-home-col">
          <section className="cr-card cr-next">
            <h2>{p.phase === 'review' ? 'Season over' : today ? 'Your game today' : 'Next game'}</h2>
            {next ? (
              (() => {
                const s = fromSide(w, next, me.id);
                return (
                  <>
                    <div className="cr-next-teams">
                      <div className="cr-next-team">
                        <Badge club={me} size={44} />
                        <b>{me.name}</b>
                        <span className="cr-sub">{recordIn(w, next, me.id)}</span>
                      </div>
                      <span className="cr-next-vs">{s.home ? 'v' : 'at'}</span>
                      <button className="cr-next-team link" onClick={() => nav.go({ kind: 'club', id: s.opp.id })}>
                        <Badge club={s.opp} size={44} />
                        <b>{s.opp.name}</b>
                        <span className="cr-sub">{recordIn(w, next, s.opp.id)}</span>
                      </button>
                    </div>
                    <span className="cr-next-when">
                      {longDate(w.season, next.day)} · {compName(w, next.comp)}
                      {next.label ? `, ${next.label.toLowerCase()}` : ''} · {s.home ? 'home' : 'away'} {isKey(w, next) && <KeyTag />}
                    </span>
                    {today && (
                      <button className="primary cr-start" onClick={onPrepare}>
                        Prepare for the game <NextIcon />
                      </button>
                    )}
                  </>
                );
              })()
            ) : p.phase === 'review' ? (
              <button className="primary cr-start" onClick={() => nav.go({ kind: 'review' })}>
                Season review <NextIcon />
              </button>
            ) : (
              <span className="cr-sub">No games left.</span>
            )}
          </section>
          <section className="cr-card">
            <h2>Last results</h2>
            {last.length ? (
              <table className="cr-table cr-mini">
                <colgroup>
                  <col style={{ width: 100 }} />
                  <col />
                  <col style={{ width: 104 }} />
                </colgroup>
                <tbody>
                  {last.map((g) => {
                    const s = fromSide(w, g, me.id);
                    return (
                      <tr key={g.id}>
                        <td className="left muted">{shortDate(w.season, g.day)}</td>
                        <td className="left">
                          {s.home ? 'v' : 'at'} {s.opp.name}
                        </td>
                        <td>
                          <button className="cr-name" onClick={() => nav.go({ kind: 'game', id: String(g.id) })}>
                            <ResultTag won={s.won} result={s.result} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <span className="cr-sub">No games played yet.</span>
            )}
          </section>
        </div>
        <div className="cr-home-col">
          {comps.map((c) => (
            <MiniTable key={c.id} w={w} comp={c} me={me} nav={nav} />
          ))}
        </div>
        <div className="cr-home-col cr-home-inbox">
        <SituationCard w={w} />
        <section className="cr-card">
          <div className="cr-row-head">
            <h2>Inbox</h2>
            <Pager fit={fit} total={inbox.length} />
          </div>
          {inbox.length ? (
            <ul className="cr-inbox">
              {inbox.slice(fit.from, fit.to).map((m, i) => (
                <li key={`${m.day}-${i}-${m.kind}`}>
                  <span className="cr-label">{m.day >= 0 ? shortDate(w.season, m.day) : 'Before the season'}</span>
                  {m.game !== undefined ? (
                    <button className="cr-name" onClick={() => nav.go({ kind: 'game', id: String(m.game) })}>
                      {m.text}
                    </button>
                  ) : (
                    <span>{m.text}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <span className="cr-sub">Nothing yet. Press Continue to start the season.</span>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}

/** Five rows of a table round your place. */
function MiniTable({ w, comp, me, nav }: { w: World; comp: Competition; me: WorldClub; nav: Nav }) {
  const rows = table(w, comp.id);
  // Five rows round your place; three on a short touch screen (its rows are 44 px).
  const n = useMedia('(pointer: coarse) and (max-height: 800px)') ? 3 : 5;
  const i = Math.max(0, rows.findIndex((r) => r.club === me.id));
  const from = Math.max(0, Math.min(rows.length - n, i - Math.floor(n / 2)));
  return (
    <section className="cr-card">
      <div className="cr-row-head">
        <h2>{comp.name}</h2>
        <button className="cr-chip link" onClick={() => nav.go({ kind: 'competition', id: comp.id })}>
          Full table
        </button>
      </div>
      <table className="cr-table cr-mini">
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th className="left">Club</th>
            <th style={{ width: 34 }}>W</th>
            <th style={{ width: 34 }}>L</th>
            <th style={{ width: 40 }} title="Games behind the leader">GB</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(from, from + n).map((r, k) => {
            const club = clubById(w, r.club)!;
            return (
              <tr key={r.club} className={r.club === me.id ? 'me' : ''}>
                <td className="muted">{from + k + 1}</td>
                <td className="left">
                  <button className="cr-name with-badge" onClick={() => nav.go({ kind: 'club', id: club.id })}>
                    <Badge club={club} size={20} />
                    <span className="cr-ellipsis">{club.name}</span>
                  </button>
                </td>
                <td>{r.won}</td>
                <td>{r.lost}</td>
                <td className="muted">{r.behind ? r.behind.toFixed(1).replace(/\.0$/, '') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tactics

export function TacticsScreen({ w, onPlan }: { w: World; onPlan: (p: GamePlan) => void }) {
  const me = clubById(w, w.human!.club)!;
  const [section, setSection] = useState<'tactics' | 'rotation' | 'matchup'>('tactics');
  const short = useMedia('(max-height: 800px)');
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const plan = humanPlan(w);
  const team = squadTeam(w, me, [...plan.starters, ...plan.bench]);
  const next = nextHumanGame(w);
  const oppId = next ? (next.home === me.id ? next.away : next.home) : null;
  const opp = oppId ? squadTeam(w, clubById(w, oppId)!, dressedIds(w, oppId)) : team;
  return (
    <div className="cr-page">
      <section className="cr-card prep-panel cr-tactics">
        <div className="prep-tabs-row">
        <h1 title={`Your game plan and rotation: every game starts with it.${next && oppId ? ` Suggestions are for your next game, against ${clubById(w, oppId)!.name}.` : ''}`}>Tactics</h1>
        <div className="prep-tabs" role="tablist">
          {(
            [
              ['tactics', 'Tactics'],
              ['rotation', 'Starting five & bench'],
              ['matchup', 'Key matchup'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={section === id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
              {label}
            </button>
          ))}
        </div>
        {short && <div className="brk-views-slot" ref={setSlot} />}
        </div>
        <PlanEditor team={team} opponent={opp} plan={plan} side={0} section={section} dressed={12} slot={short && section === 'rotation' ? slot : null} onChange={onPlan} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule

export function ScheduleScreen({ w, nav }: { w: World; nav: Nav }) {
  const me = clubById(w, w.human!.club)!;
  const games = humanGames(w);
  const months = [...new Map(games.map((g) => [monthOf(w.season, g.day).key, monthOf(w.season, g.day).name])).entries()];
  const p = playOf(w);
  const nowKey = monthOf(w.season, Math.max(0, p.day)).key;
  const [m, setM] = useState(() => Math.max(0, months.findIndex(([k]) => k === nowKey)));
  const [key, name] = months[Math.min(m, months.length - 1)] ?? ['', ''];
  const inMonth = games.filter((g) => monthOf(w.season, g.day).key === key);
  const fit = useFitRows(inMonth.length, '.cr-table tbody tr', key);
  const won = games.filter((g) => g.score && fromSide(w, g, me.id).won).length;
  const lost = games.filter((g) => g.score).length - won;
  return (
    <div className="cr-page">
      <div className="cr-row-head start">
        <h1>Schedule</h1>
        <span className="cr-sub">
          {games.length} games · {won}–{lost} so far
        </span>
        <div className="cr-pager" role="navigation" aria-label="Months">
          <button className="cr-back icon" disabled={m === 0} onClick={() => setM(m - 1)} aria-label="Previous month">
            <PrevIcon />
          </button>
          <span className="cr-month">{name}</span>
          <button className="cr-back icon" disabled={m >= months.length - 1} onClick={() => setM(m + 1)} aria-label="Next month">
            <NextIcon />
          </button>
        </div>
      </div>
      <div className="cr-card cr-table-wrap">
        <table className="cr-table">
          <thead>
            <tr>
              <th className="left">Date</th>
              <th className="left">Competition</th>
              <th className="left" title="Home or away">H/A</th>
              <th className="left">Opponent</th>
              <th className="left">Result</th>
            </tr>
          </thead>
          <tbody>
            {inMonth.slice(fit.from, fit.to).map((g) => {
              const s = fromSide(w, g, me.id);
              const today = p.phase === 'regular' && g.day === p.day;
              return (
                <tr key={g.id} className={today ? 'me' : ''}>
                  <td className="left">{shortDate(w.season, g.day)}</td>
                  <td className="left muted wrap">
                    {compName(w, g.comp)}
                    {g.label ? `, ${g.label.toLowerCase()}` : ''} {!g.score && isKey(w, g) && <KeyTag />}
                  </td>
                  <td className="left">{s.home ? 'Home' : 'Away'}</td>
                  <td className="left">
                    <button className="cr-name with-badge" onClick={() => nav.go({ kind: 'club', id: s.opp.id })}>
                      <Badge club={s.opp} size={20} />
                      {s.opp.name}
                    </button>
                  </td>
                  <td className="left">
                    {g.score ? (
                      <button className="cr-name" onClick={() => nav.go({ kind: 'game', id: String(g.id) })}>
                        <ResultTag won={s.won} result={s.result} />
                      </button>
                    ) : today ? (
                      <span className="cr-tag accent">Today</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="cr-key">
        Your games by month: click a result for its box score.
        <Pager fit={fit} total={inMonth.length} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A competition: its table (counted from the results) and its results by day

export function SeasonTable({ w, comp, nav }: { w: World; comp: Competition; nav: Nav }) {
  const [tab, setTab] = useState<'table' | 'results' | 'playoffs'>(() => ((w.play?.ties ?? []).some((t) => t.comp === comp.id) ? 'playoffs' : 'table'));
  return (
    <div className="cr-page">
      <div className="cr-row-head start">
        <h1>{comp.name}</h1>
        <div className="cr-tabs" role="tablist" aria-label="Table or results">
          {(
            [
              ['table', 'Table'],
              ['results', 'Results'],
              ['playoffs', 'Playoffs'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'table' ? <TableRows w={w} comp={comp} nav={nav} /> : tab === 'results' ? <Results w={w} comp={comp} nav={nav} /> : <Bracket w={w} comp={comp.id} nav={nav} />}
    </div>
  );
}

function TableRows({ w, comp, nav }: { w: World; comp: Competition; nav: Nav }) {
  const all = table(w, comp.id);
  const fit = useFitRows(all.length, '.cr-table tbody tr', comp.id);
  const europe = comp.kind === 'bigLeague' && comp.region === 'europe';
  return (
    <>
      <div className="cr-card cr-table-wrap">
        <table className="cr-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="left">Club</th>
              <th title="Played">P</th>
              <th title="Won">W</th>
              <th title="Lost">L</th>
              <th title="Share of games won">Win %</th>
              <th title="Games behind the leader">GB</th>
              <th title="Points difference">+/−</th>
              <th className="left" title="Last five games, oldest first">Last 5</th>
            </tr>
          </thead>
          <tbody>
            {all.slice(fit.from, fit.to).map((r, i) => {
              const c = clubById(w, r.club)!;
              const me = w.human?.club === c.id;
              return (
                <tr key={c.id} className={me ? 'me' : ''}>
                  <td className="muted">{fit.from + i + 1}</td>
                  <td className="left">
                    <button className="cr-name with-badge" onClick={() => nav.go({ kind: 'club', id: c.id })}>
                      <Badge club={c} size={22} />
                      {c.name}
                    </button>
                    {me && <span className="cr-tag accent">You</span>}
                    {europe && c.licence === 'wildcard' && <span className="cr-tag warn">Wildcard</span>}
                  </td>
                  <td>{r.played}</td>
                  <td>{r.won}</td>
                  <td>{r.lost}</td>
                  <td>{r.played ? r.pct.toFixed(3).replace(/^0/, '') : '—'}</td>
                  <td className="muted">{r.behind ? r.behind.toFixed(1).replace(/\.0$/, '') : '—'}</td>
                  <td>{r.played ? `${r.diff > 0 ? '+' : ''}${r.diff}` : '—'}</td>
                  <td className="left">
                    <span className="cr-form" aria-label={`Last five: ${r.last5.join(' ') || 'none'}`}>
                      {r.last5.map((x, k) => (
                        <span key={k} className={`cr-form-dot ${x === 'W' ? 'w' : 'l'}`}>
                          {x}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="cr-key">
        {comp.country ? '' : comp.kind === 'bigLeague' ? 'Every Big League game of these clubs counts, against both conferences. ' : ''}Order: win %, then head-to-head, then points difference.
        <Pager fit={fit} total={all.length} />
      </span>
    </>
  );
}

function Results({ w, comp, nav }: { w: World; comp: Competition; nav: Nav }) {
  const games = compGames(w, comp.id);
  const days = [...new Set(games.map((g) => g.day))].sort((a, b) => a - b);
  const p = playOf(w);
  const lastPlayed = days.filter((d) => games.some((g) => g.day === d && g.score)).pop();
  const [i, setI] = useState(() => Math.max(0, lastPlayed !== undefined ? days.indexOf(lastPlayed) : days.findIndex((d) => d >= p.day)));
  const day = days[Math.min(i, days.length - 1)];
  const onDay = games.filter((g) => g.day === day);
  const fit = useFitRows(onDay.length, '.cr-table tbody tr', day);
  return (
    <>
      <div className="cr-row-head start">
        <div className="cr-pager" role="navigation" aria-label="Matchdays">
          <button className="cr-back icon" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Previous matchday">
            <PrevIcon />
          </button>
          <span className="cr-month">{day !== undefined ? longDate(w.season, day) : '—'}</span>
          <button className="cr-back icon" disabled={i >= days.length - 1} onClick={() => setI(i + 1)} aria-label="Next matchday">
            <NextIcon />
          </button>
        </div>
        <span className="cr-sub">
          Matchday {Math.min(i, days.length - 1) + 1} of {days.length}
        </span>
      </div>
      <div className="cr-card cr-table-wrap">
        <table className="cr-table">
          <thead>
            <tr>
              <th className="left">Home</th>
              <th>Score</th>
              <th className="left">Away</th>
            </tr>
          </thead>
          <tbody>
            {onDay.slice(fit.from, fit.to).map((g) => {
              const h = clubById(w, g.home)!;
              const a = clubById(w, g.away)!;
              const mine = w.human && (g.home === w.human.club || g.away === w.human.club);
              return (
                <tr key={g.id} className={mine ? 'me' : ''}>
                  <td className="left">
                    <button className="cr-name with-badge" onClick={() => nav.go({ kind: 'club', id: h.id })}>
                      <Badge club={h} size={20} />
                      {h.name}
                    </button>
                  </td>
                  <td>
                    {g.score ? (
                      <button className="cr-name" onClick={() => nav.go({ kind: 'game', id: String(g.id) })}>
                        <b>
                          {g.score[0]}–{g.score[1]}
                        </b>
                        {g.ot ? ' OT' : ''}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="left">
                    <button className="cr-name with-badge" onClick={() => nav.go({ kind: 'club', id: a.id })}>
                      <Badge club={a} size={20} />
                      {a.name}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="cr-key">
        Click a score for its box score.
        <Pager fit={fit} total={onDay.length} />
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// A game's box score

export function GameScreen({ w, id, nav }: { w: World; id: string; nav: Nav }) {
  const g = playOf(w).games[Number(id)];
  const [side, setSide] = useState<0 | 1>(() => (g && w.human && g.away === w.human.club ? 1 : 0));
  if (!g || !g.score) return <div className="cr-page">This game hasn't been played yet.</div>;
  const sides = boxOf(w, g)!;
  const teams = boxScore(w, g, sides);
  const h = clubById(w, g.home)!;
  const a = clubById(w, g.away)!;
  const periods = Math.max(4, teams[0].quarterPoints.length, teams[1].quarterPoints.length);
  return (
    <div className="cr-page">
      <div className="cr-row-head start cr-game-head">
        <h1 className="cr-game-title">
          <button className="cr-name with-badge" onClick={() => nav.go({ kind: 'club', id: h.id })}>
            <Badge club={h} size={28} />
            {h.name}
          </button>
          <span className="cr-game-score">
            {g.score[0]}–{g.score[1]}
            {g.ot ? ' OT' : ''}
          </span>
          <button className="cr-name with-badge" onClick={() => nav.go({ kind: 'club', id: a.id })}>
            <Badge club={a} size={28} />
            {a.name}
          </button>
        </h1>
        <span className="cr-sub">
          {longDate(w.season, g.day)} · {compName(w, g.comp)}
        </span>
      </div>
      <div className="cr-row-head start">
        <table className="cr-table cr-mini cr-quarters">
          <thead>
            <tr>
              <th />
              {Array.from({ length: periods }, (_, i) => (
                <th key={i}>{i < 4 ? `Q${i + 1}` : `OT${periods > 5 ? i - 3 : ''}`}</th>
              ))}
              <th>T</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t, s) => (
              <tr key={s}>
                <td className="left">
                  <b>{t.abbr}</b>
                </td>
                {Array.from({ length: periods }, (_, i) => (
                  <td key={i} className="muted">
                    {t.quarterPoints[i] ?? 0}
                  </td>
                ))}
                <td>
                  <b>{t.score}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="cr-tabs" role="tablist" aria-label="Box score">
          {teams.map((t, s) => (
            <button key={s} role="tab" aria-selected={side === s} className={side === s ? 'on' : ''} onClick={() => setSide(s as 0 | 1)}>
              {t.name}
            </button>
          ))}
        </div>
      </div>
      <div className="cr-card cr-box">
        <TeamTable key={side} t={teams[side]} colour={TEAM_COLOURS[side]} side={side} head={false} />
      </div>
    </div>
  );
}
