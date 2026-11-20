// The career's postseason screens (slice brief W2b §8): brackets, cups, History, your situation on Home,
// what Continue stopped for (the postseason, a draw, knocked out, your season over), Key moments, and
// the season review with "Start the next season". Within the screen rules: nothing scrolls, 14 px.

import { useState } from 'react';
import { setGamePlan } from '../../../engine/match';
import type { GamePlan, MatchState, Side } from '../../../engine/types';
import { longDate, shortDate } from '../../../game/season/calendar';
import { quarterCard, type KeyStop } from '../../../game/season/keymoments';
import { compGames, humanGames, isKey, playOf, seasonLine, table, type SimInput } from '../../../game/season/play';
import { BL_AMERICA, BL_EUROPE, BL_FINAL, ROUND_NAME, compLabel, cupsOf, tieScore } from '../../../game/season/post';
import { movements } from '../../../game/season/rollover';
import type { SeasonGame, Tie } from '../../../game/season/types';
import { BIG_LEAGUE } from '../../../game/season/types';
import { clubById, competitionsOf, leagueOf, ordinal } from '../../../game/world/query';
import type { World } from '../../../game/world/types';
import { gameScore } from '../../../engine/stats';
import { PlanEditor } from '../../components/PlanEditor';
import { useMedia } from '../../components/useMedia';
import { TopBar, type Crumb } from '../../components/TopBar';
import { NextIcon, PrevIcon } from '../../icons';
import { Badge, Pager, useFitRows } from './parts';
import type { Nav } from './screens';

const nameOf = (w: World, c: string) => clubById(w, c)?.name ?? c;

/** A small "Key game" marker (WORLD_SPEC §1.1). */
export function KeyTag() {
  return <span className="cr-tag key">Key game</span>;
}

// ---------------------------------------------------------------------------
// Your situation: leagues, postseason ties, cups

export function situationLines(w: World): string[] {
  const human = w.human?.club;
  if (!human || !w.play) return [];
  const out: string[] = [];
  for (const c of competitionsOf(w, human)) {
    const rows = table(w, c.id);
    const i = rows.findIndex((r) => r.club === human);
    if (i >= 0 && rows[i].played) out.push(`${c.name}: ${ordinal(i + 1)}, ${rows[i].won}–${rows[i].lost}`);
  }
  const ties = (w.play.ties ?? []).filter((t) => t.a === human || t.b === human);
  // The latest tie per competition says where you are in it.
  const latest = new Map<string, Tie>();
  for (const t of ties) latest.set(t.comp, t);
  for (const t of latest.values()) {
    const opp = t.a === human ? t.b : t.a;
    const wins = tieScore(w.play.games, t);
    const round = ROUND_NAME[t.round] ?? t.round;
    const score = t.bestOf > 1 ? `, ${wins[human] ?? 0}–${wins[opp] ?? 0}` : '';
    if (!t.winner) out.push(`${compLabel(w, t.comp)}: ${round} v ${nameOf(w, opp)}${score}${t.bestOf > 1 ? (wins[human] > wins[opp] ? ' up' : wins[human] < wins[opp] ? ' down' : '') : ''}`);
    else if (t.winner === human) out.push(['ff-final', 'final', 'bl-final', 'cf', 'promo-final'].includes(t.round) ? `${compLabel(w, t.comp)}: ${t.round === 'promo-final' ? 'promoted through the playoff' : t.round === 'cf' ? 'conference champions' : 'champions'}!` : `${compLabel(w, t.comp)}: won the ${round.toLowerCase()} v ${nameOf(w, opp)}${score}`);
    else out.push(`${compLabel(w, t.comp)}: out in the ${round.toLowerCase()} (${nameOf(w, opp)}${score})`);
  }
  return out;
}

export function SituationCard({ w }: { w: World }) {
  const lines = situationLines(w);
  if (!lines.length) return null;
  return (
    <section className="cr-card cr-situation">
      <h2>Your season</h2>
      <ul className="cr-lines">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Brackets

function TieCard({ w, t, nav }: { w: World; t: Tie; nav: Nav }) {
  const games = w.play!.games;
  const wins = tieScore(games, t);
  const last = [...t.games].reverse().map((id) => games[id]).find((g) => g.score && !g.off);
  const me = w.human?.club;
  const row = (c: string) => (
    <div className={`cr-tie-row ${t.winner === c ? 'won' : t.winner ? 'lost' : ''} ${c === me ? 'me' : ''}`}>
      <button className="cr-name with-badge" onClick={() => nav.go({ kind: 'club', id: c })}>
        <Badge club={clubById(w, c)!} size={20} />
        <span className="cr-ellipsis">{nameOf(w, c)}</span>
      </button>
      {last ? (
        <button className="cr-tie-score" onClick={() => nav.go({ kind: 'game', id: String(last.id) })} title={`The box score of ${t.bestOf > 1 ? 'the last game' : 'the game'}, ${shortDate(w.season, last.day)}`}>
          {t.bestOf > 1 ? (wins[c] ?? 0) : last.home === c ? last.score![0] : last.score![1]}
        </button>
      ) : (
        <b className="muted">{t.bestOf > 1 ? 0 : '–'}</b>
      )}
    </div>
  );
  return (
    <div className="cr-tie">
      {row(t.a)}
      {row(t.b)}
    </div>
  );
}

/** A competition's play-ins and playoffs, round by round in columns. */
export function Bracket({ w, comp, nav }: { w: World; comp: string; nav: Nav }) {
  const ties = (w.play?.ties ?? []).filter((t) => t.comp === comp || (comp === BL_AMERICA || comp === BL_EUROPE ? t.comp === BL_FINAL : false));
  if (!ties.length) return <p className="cr-sub">The playoffs start when the regular season is over.</p>;
  const rounds = [...new Set(ties.map((t) => t.round))];
  return (
    <div className="cr-bracket" style={{ ['--rounds' as string]: rounds.length }}>
      {rounds.map((r) => (
        <div key={r} className="cr-bracket-round">
          <span className="cr-label">{ROUND_NAME[r] ?? r}</span>
          {ties
            .filter((t) => t.round === r)
            .map((t) => (
              <TieCard key={t.id} w={w} t={t} nav={nav} />
            ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cups

export function CupScreen({ w, id, nav }: { w: World; id: string; nav: Nav }) {
  const cup = cupsOf(w).find((c) => c.id === id);
  const ties = (w.play?.ties ?? []).filter((t) => t.comp === id);
  const made = cup ? cup.rounds.filter((r) => ties.some((t) => t.round === r.key)) : [];
  const [ri, setRi] = useState(() => Math.max(0, made.length - 1));
  const fit = useFitRows(ties.filter((t) => t.round === made[ri]?.key).length, '.cr-cup-ties .cr-tie', `${id}|${ri}`);
  if (!cup) return <div className="cr-page">Cup not found.</div>;
  const round = made[Math.min(ri, made.length - 1)];
  const these = round ? ties.filter((t) => t.round === round.key) : [];
  return (
    <div className="cr-page">
      <div className="cr-row-head start">
        <h1>{cup.name}</h1>
        {made.length > 0 && (
          <div className="cr-tabs wrap" role="tablist" aria-label="Rounds">
            {made.map((r, i) => (
              <button key={r.key} role="tab" aria-selected={i === ri} className={i === ri ? 'on' : ''} onClick={() => setRi(i)}>
                {ROUND_NAME[r.key] ?? r.key}
              </button>
            ))}
          </div>
        )}
        <Pager fit={fit} total={these.length} />
      </div>
      {round ? (
        <>
          <span className="cr-sub">
            {longDate(w.season, round.day)}
            {round.key === 'ff' ? ' and the final two days later, at one venue' : ''} · single games, the lower-tier club at home
          </span>
          <div className="cr-cup-ties">
            {these.slice(fit.from, fit.to).map((t) => (
              <TieCard key={t.id} w={w} t={t} nav={nav} />
            ))}
          </div>
        </>
      ) : (
        <p className="cr-sub">{w.play?.noCups ? 'This season has no cup: cups start with the next season.' : `The first round is drawn two weeks before ${shortDate(w.season, cup.rounds[0].day)}.`}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History: champions and cup winners per season

export function HistoryScreen({ w, nav }: { w: World; nav: Nav }) {
  const seasons = [...(w.history ?? [])].reverse();
  const [i, setI] = useState(0);
  const [group, setGroup] = useState(0);
  const a = seasons[i];
  const kind = (k: string) => w.competitions.find((c) => c.id === k);
  const groups: [string, string[]][] = a
    ? [
        ['Big League', [BL_FINAL, BL_AMERICA, BL_EUROPE]],
        ['National champions', Object.keys(a.champions).filter((k) => kind(k)?.kind === 'nationalLeague' && kind(k)?.tier === 1)],
        ['Second tiers and US divisions', Object.keys(a.champions).filter((k) => kind(k)?.kind === 'usDivision' || (kind(k)?.kind === 'nationalLeague' && kind(k)?.tier === 2))],
        ['Cups', Object.keys(a.champions).filter((k) => k.startsWith('cup-'))],
      ]
    : [];
  return (
    <div className="cr-page">
      <div className="cr-row-head start">
        <h1>History</h1>
        {a && (
          <div className="cr-pager" role="navigation" aria-label="Seasons">
            <button className="cr-back icon" disabled={i >= seasons.length - 1} onClick={() => setI(i + 1)} aria-label="Earlier season">
              <PrevIcon />
            </button>
            <span className="cr-month">
              {a.season}–{String(a.season + 1).slice(2)}
            </span>
            <button className="cr-back icon" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Later season">
              <NextIcon />
            </button>
          </div>
        )}
        {a && (
          <div className="cr-tabs" role="tablist" aria-label="Champions">
            {groups.map(([title], gi) => (
              <button key={title} role="tab" aria-selected={gi === group} className={gi === group ? 'on' : ''} onClick={() => setGroup(gi)}>
                {title}
              </button>
            ))}
          </div>
        )}
      </div>
      {!a ? (
        <p className="cr-sub">No season has finished yet: champions and cup winners appear here at the end of each season.</p>
      ) : (
        <section className="cr-card">
          <dl className="cr-facts cr-columns">
            {groups[group][1]
              .filter((k) => a.champions[k])
              .map((k) => (
                <div key={k} className="cr-review-pos">
                  <dt>{k === BL_FINAL ? 'Big League champion' : compLabel(w, k)}</dt>
                  <dd>
                    <button className="cr-name" onClick={() => nav.go({ kind: 'club', id: a.champions[k] })}>
                      {nameOf(w, a.champions[k])}
                    </button>
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      )}
    </div>
  );
}
// ---------------------------------------------------------------------------
// What Continue stopped for (full-screen moment)

export function MomentScreen({ w, crumbs, onContinue, onSimToEnd, onLeave }: { w: World; crumbs: Crumb[]; onContinue: () => void; onSimToEnd: () => void; onLeave: () => void }) {
  const m = playOf(w).moment;
  const over = m?.kind === 'over' || m?.lines.some((l) => l.startsWith('Your season is over'));
  const out = m?.kind === 'out';
  return (
    <div className="cr cr-review">
      <TopBar crumbs={crumbs} leave={onLeave} />
      <div className="cr-review-body cr-moment">
        <h1>{m?.title ?? 'Nothing new'}</h1>
        <div className="cr-review-grid two">
          <section className="cr-card">
            {(m?.lines ?? []).map((l) => (
              <p key={l} className="cr-moment-line">
                {l}
              </p>
            ))}
          </section>
          {(out || over) && (
            <section className="cr-card">
              <h2>Your season so far</h2>
              <ul className="cr-lines">
                {situationLines(w).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="cr-row-head start">
          <button className="primary cr-start" onClick={onContinue}>
            Continue <NextIcon />
          </button>
          {over && (
            <button className="cr-sim-end big-text" onClick={onSimToEnd}>
              Simulate to the end of the season
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key moments: quarter cards and breaks (tactics and rotation), then the live part

export function KeyMomentsScreen({
  w,
  g,
  s,
  inp,
  side,
  stop,
  crumbs,
  onPlayOn,
  onLeave,
}: {
  w: World;
  g: SeasonGame;
  s: MatchState;
  inp: SimInput;
  side: Side;
  stop: KeyStop;
  crumbs: Crumb[];
  onPlayOn: () => void;
  onLeave: () => void;
}) {
  const [section, setSection] = useState<'card' | 'tactics' | 'rotation'>('card');
  // A short screen: the rotation's hint and Sort button go beside the tabs.
  const short = useMedia('(max-height: 800px)');
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [plan, setPlan] = useState<GamePlan>(() => s.teams[side].plan);
  const after = stop.kind === 'break' ? stop.after : 4;
  const card = quarterCard(s, after);
  const team = inp.teams[side];
  const opp = inp.teams[1 - side];
  const names = (sd: Side, id: string) => s.teams[sd].team.players.find((p) => p.id === id)?.name ?? id;
  const change = (p: GamePlan) => {
    setPlan(p);
    setGamePlan(s, side, p);
  };
  const label = stop.kind === 'live' ? 'Play the last 5 minutes live' : stop.kind === 'final' ? 'To the result' : after === 2 ? 'Play the 3rd quarter' : `Play the ${after === 1 ? '2nd' : '4th'} quarter`;
  return (
    <div className="cr cr-review">
      <TopBar
        crumbs={crumbs}
        leave={onLeave}
        right={
          <button className="primary cr-continue-top" onClick={onPlayOn}>
            {label} <NextIcon />
          </button>
        }
      />
      <div className="cr-review-body cr-km">
        <div className="cr-row-head start">
          <h1>
            {stop.kind === 'break' ? (after === 2 ? 'Halftime' : `End of the ${ordinal(after)} quarter`) : stop.kind === 'live' ? '5 minutes left' : 'Final'}
          </h1>
          <span className="cr-game-score">
            {inp.teams[0].abbr} {s.teams[0].score}–{s.teams[1].score} {inp.teams[1].abbr}
          </span>
          {isKey(w, g) && <KeyTag />}
          <div className="cr-tabs" role="tablist" aria-label="Break">
            {(
              [
                ['card', 'Quarter card'],
                ['tactics', 'Tactics'],
                ['rotation', 'Starting five & bench'],
              ] as const
            ).map(([id, l]) => (
              <button key={id} role="tab" aria-selected={section === id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
                {l}
              </button>
            ))}
          </div>
          {short && <div className="brk-views-slot prep-tabs-row" ref={setSlot} />}
        </div>
        {section === 'card' ? (
          <div className="cr-review-grid">
            <section className="cr-card">
              <h2>{ordinal(after)} quarter</h2>
              <dl className="cr-facts">
                {([0, 1] as const).map((sd) => (
                  <div key={sd} className="cr-review-pos">
                    <dt>{inp.teams[sd].name}</dt>
                    <dd>
                      <b>{card.points[sd]}</b> points · best run {card.runs[sd]}–0
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="cr-card">
              <h2>Top scorers in the quarter</h2>
              <ul className="cr-lines">
                {card.top.map((t) => (
                  <li key={`${t.side}${t.id}`}>
                    {names(t.side, t.id)} ({inp.teams[t.side].abbr}), {t.pts}
                  </li>
                ))}
              </ul>
            </section>
            <section className="cr-card">
              <h2>By quarter</h2>
              <table className="cr-table cr-mini cr-quarters">
                <thead>
                  <tr>
                    <th />
                    {s.teams[0].quarterPoints.slice(0, after).map((_, i) => (
                      <th key={i}>{i < 4 ? `Q${i + 1}` : `OT${i - 3}`}</th>
                    ))}
                    <th>T</th>
                  </tr>
                </thead>
                <tbody>
                  {([0, 1] as const).map((sd) => (
                    <tr key={sd}>
                      <td className="left">
                        <b>{inp.teams[sd].abbr}</b>
                      </td>
                      {s.teams[sd].quarterPoints.slice(0, after).map((q, i) => (
                        <td key={i}>{q}</td>
                      ))}
                      <td>
                        <b>{s.teams[sd].score}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        ) : (
          <section className="cr-card prep-panel cr-tactics">
            <PlanEditor team={team} opponent={opp} plan={plan} side={side} section={section} slot={short && section === 'rotation' ? slot : null} onChange={change} />
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The season review (GAME_FLOW §3.6, the parts that exist now) and "Start the next season"

export function SeasonReview({ w, crumbs, onLeave, onNext }: { w: World; crumbs: Crumb[]; onLeave: () => void; onNext: () => void }) {
  const me = clubById(w, w.human!.club)!;
  const [tab, setTab] = useState<'you' | 'champions' | 'moves' | 'players'>('you');
  const m = movements(w);
  const league = leagueOf(w, me.id);
  const games = humanGames(w).filter((g) => g.score);
  const won = games.filter((g) => (g.home === me.id ? g.score![0] > g.score![1] : g.score![1] > g.score![0])).length;
  const trophies = Object.entries(m.champions).filter(([, c]) => c === me.id);
  const perGame = (id: string, comp?: string) => {
    const s = seasonLine(w, id, comp);
    return s && s.games ? { s, ppg: s.pts / s.games, rpg: (s.oreb + s.dreb) / s.games, apg: s.ast / s.games, gs: gameScore(s) / s.games } : null;
  };
  const best = me.roster
    .map((id) => ({ id, x: perGame(id) }))
    .filter((r) => r.x && r.x.s.games >= 5)
    .sort((a, b) => b.x!.gs - a.x!.gs)
    .slice(0, 5);
  const leagueKey = league.kind === 'bigLeague' ? BIG_LEAGUE : league.id;
  const minGames = Math.ceil(compGames(w, league.id).filter((g) => g.home === me.id || g.away === me.id).length / 2);
  const leaders = league.clubs
    .flatMap((c) => clubById(w, c)!.roster)
    .map((id) => ({ id, x: perGame(id, leagueKey) }))
    .filter((r) => r.x && r.x.s.games >= minGames)
    .sort((a, b) => b.x!.ppg - a.x!.ppg)
    .slice(0, 5);
  const champs = Object.entries(m.champions);
  const fit = useFitRows(champs.length, '.cr-champions .cr-review-pos', tab);
  const names = (ids: string[]) => (ids.length ? ids.map((c) => nameOf(w, c)).join(', ') : 'none');
  return (
    <div className="cr cr-review">
      <TopBar
        crumbs={crumbs}
        leave={onLeave}
        right={
          <button className="primary cr-continue-top" onClick={onNext}>
            Start the next season <NextIcon />
          </button>
        }
      />
      <div className="cr-review-body">
        <div className="cr-row-head start">
          <Badge club={me} size={44} />
          <h1>
            {me.name}: the {w.season}–{String(w.season + 1).slice(2)} season
          </h1>
          <span className="cr-sub">
            {won}–{games.length - won} in all games
          </span>
          <div className="cr-tabs" role="tablist" aria-label="Review">
            {(
              [
                ['you', 'Your season'],
                ['champions', 'Champions'],
                ['moves', 'Up and down'],
                ['players', 'Players'],
              ] as const
            ).map(([id, l]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {tab === 'you' && (
          <div className="cr-review-grid two">
            <section className="cr-card">
              <h2>Final positions</h2>
              <ul className="cr-lines">
                {situationLines(w).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </section>
            <section className="cr-card">
              <h2>Trophies</h2>
              <ul className="cr-lines">
                {trophies.length ? trophies.map(([k]) => <li key={k}>{k === BL_FINAL ? 'Big League champions' : compLabel(w, k)}</li>) : <li>None this season.</li>}
              </ul>
            </section>
          </div>
        )}
        {tab === 'champions' && (
          <section className="cr-card cr-champions">
            <dl className="cr-facts cr-columns">
              {champs.slice(fit.from, fit.to).map(([k, c]) => (
                <div key={k} className="cr-review-pos">
                  <dt>{k === BL_FINAL ? 'Big League champion' : compLabel(w, k)}</dt>
                  <dd className={c === me.id ? 'me' : ''}>{nameOf(w, c)}</dd>
                </div>
              ))}
            </dl>
            <Pager fit={fit} total={champs.length} />
          </section>
        )}
        {tab === 'moves' && (
          <div className="cr-review-grid two">
            <section className="cr-card">
              <h2>Promoted</h2>
              <p className="cr-moment-line">{names(m.moves.filter((x) => x.up).map((x) => x.club))}</p>
              <h2>Relegated</h2>
              <p className="cr-moment-line">{names(m.moves.filter((x) => !x.up).map((x) => x.club))}</p>
            </section>
            <section className="cr-card">
              <h2>Big League Europe</h2>
              <dl className="cr-facts">
                <dt>Licences lost</dt>
                <dd>{names(m.licenceLost)}</dd>
                <dt>Licences won</dt>
                <dd>{names(m.licenceWon)}</dd>
                <dt>Next season's wildcards</dt>
                <dd>{names(m.wildcards)}</dd>
              </dl>
            </section>
          </div>
        )}
        {tab === 'players' && (
          <div className="cr-review-grid two">
            <section className="cr-card">
              <h2>Your best players</h2>
              <table className="cr-table cr-mini">
                <thead>
                  <tr>
                    <th className="left">Player</th>
                    <th style={{ width: 40 }}>G</th>
                    <th style={{ width: 50 }}>PTS</th>
                    <th style={{ width: 50 }}>REB</th>
                    <th style={{ width: 50 }}>AST</th>
                  </tr>
                </thead>
                <tbody>
                  {best.map(({ id, x }) => (
                    <tr key={id}>
                      <td className="left">{w.players[id].p.name}</td>
                      <td>{x!.s.games}</td>
                      <td>{x!.ppg.toFixed(1)}</td>
                      <td>{x!.rpg.toFixed(1)}</td>
                      <td>{x!.apg.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="cr-card">
              <h2>League leaders · {league.name}</h2>
              <table className="cr-table cr-mini">
                <thead>
                  <tr>
                    <th className="left">Player</th>
                    <th className="left" style={{ width: '38%' }}>
                      Club
                    </th>
                    <th style={{ width: 50 }}>PTS</th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.map(({ id, x }) => (
                    <tr key={id} className={w.players[id].club === me.id ? 'me' : ''}>
                      <td className="left">{w.players[id].p.name}</td>
                      <td className="left muted">{nameOf(w, w.players[id].club!)}</td>
                      <td>{x!.ppg.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
