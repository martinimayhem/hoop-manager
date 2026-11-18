// The season hub (SEASON_SPEC R2.4), one screen: the header (league, matchday, the season so far as a
// bar, match speed), your next match as the big card with the way on (play it, let the computer play
// it), the table with your club picked out, and beside it your season, the league's top scorers, the
// rest of this matchday and the last results.

import { useMemo } from 'react';
import { MATCHDAYS, fixtures, humanGames, poolOf, table, type QuickLeague } from '../../../game/league/quickLeague';
import { leagueName } from '../../../game/league/leagues';
import type { TableRow } from '../../../game/league/standings';
import type { Speed } from '../../match/controller';
import { useSort } from '../../components/sortable';

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/** The last five results as dots, oldest first; empty dots for games not yet played. */
function Form({ last5 }: { last5: string[] }) {
  const dots = [...Array(Math.max(0, 5 - last5.length)).fill(''), ...last5];
  return (
    <span className="form" title={last5.length ? `Last ${last5.length}: ${last5.join(' ')} (oldest first)` : 'No games yet'}>
      {dots.map((x, i) => (
        <span key={i} className={`form-dot ${x === 'W' ? 'w' : x === 'L' ? 'l' : ''}`}>
          {x}
        </span>
      ))}
    </span>
  );
}

export function LeagueHub({
  league,
  speed,
  onSpeed,
  onPlay,
  onSimMine,
  onSimSeason,
  onMenu,
  onNewLeague,
}: {
  league: QuickLeague;
  speed: Speed;
  onSpeed: (s: Speed) => void;
  onPlay: () => void;
  onSimMine: () => void;
  onSimSeason: () => void;
  onMenu: () => void;
  onNewLeague: () => void;
}) {
  const rows = table(league);
  const me = league.teams.findIndex((t) => t.human !== null);
  const name = (i: number) => league.teams[i].name;
  const rowOf = (team: number) => rows.find((r) => r.team === team)!;
  const placeOf = (team: number) => rows.findIndex((r) => r.team === team) + 1;
  const over = league.phase === 'finished';
  const last = league.records.filter((g) => g.matchday === league.matchday - 1);
  const mine = over ? undefined : humanGames(league)[0]?.fixture;
  const opponent = mine ? (mine.home === me ? mine.away : mine.home) : null;
  const others = over ? [] : fixtures(league).filter((f) => f.home !== me && f.away !== me);
  // The earlier meeting with this opponent (each pair meets twice).
  const earlier = opponent === null ? undefined : league.records.find((g) => (g.home === me && g.away === opponent) || (g.away === me && g.home === opponent));

  // Top scorers: points a game, having played at least a third of the matchdays so far.
  const leaders = useMemo(() => {
    const names = new Map(poolOf(league).map((p) => [p.player.id, p.player.name]));
    const tot = new Map<string, { team: number; pts: number; games: number }>();
    for (const g of league.records) {
      ([0, 1] as const).forEach((side) => {
        const team = side === 0 ? g.home : g.away;
        for (const [id, secs, pts] of g.lines[side]) {
          if (secs <= 0) continue;
          const t = tot.get(id) ?? { team, pts: 0, games: 0 };
          t.pts += pts;
          t.games++;
          tot.set(id, t);
        }
      });
    }
    const minGames = Math.max(1, Math.ceil(league.matchday / 3));
    return [...tot.entries()]
      .filter(([, t]) => t.games >= minGames)
      .map(([id, t]) => ({ id, name: names.get(id) ?? '?', team: t.team, ppg: t.pts / t.games }))
      .sort((a, b) => b.ppg - a.ppg)
      .slice(0, 5);
  }, [league]);

  const sorter = useSort<TableRow>((r, key) => {
    switch (key) {
      case 'rank':
        return -rows.indexOf(r);
      case 'team':
        return name(r.team);
      case 'last5':
        return r.last5.filter((x) => x === 'W').length;
      case 'streak':
        return r.streak ? (r.streak[0] === 'W' ? 1 : -1) * Number(r.streak.slice(1)) : 0;
      default:
        return r[key as 'played' | 'won' | 'lost' | 'pct' | 'behind' | 'diff'];
    }
  });

  const my = rowOf(me);
  const games = Math.max(1, my.played);

  const teamBlock = (team: number, where: string) => {
    const r = rowOf(team);
    return (
      <div className={`hub-side ${team === me ? 'me' : ''}`}>
        <div className="hub-side-where">{where}</div>
        <div className="hub-side-name">{name(team)}</div>
        <div className="hub-side-rec">{r.played ? `${ordinal(placeOf(team))} · ${r.won}–${r.lost}` : 'No games yet'}</div>
        <Form last5={r.last5} />
      </div>
    );
  };

  return (
    <div className="hub">
      <header className="hub-bar">
        <button onClick={onMenu}>☰ Menu</button>
        <div className="hub-title">
          <h1>{leagueName(league.league, league.region)}</h1>
          <span className="muted small">
            {over ? 'Season over' : `Matchday ${league.matchday + 1} of ${MATCHDAYS}`} · <span className="home">{name(me)}</span>
            {league.manager ? `, manager ${league.manager}` : ''}
          </span>
          <div className="hub-progress" title={`${Math.min(league.matchday, MATCHDAYS)} of ${MATCHDAYS} matchdays played`}>
            <div style={{ width: `${(100 * Math.min(league.matchday, MATCHDAYS)) / MATCHDAYS}%` }} />
          </div>
        </div>
        <div className="spacer" />
        {!over && (
          <>
            <span className="muted small">Match speed</span>
            <span className="hub-seg">
              <button className={speed === 'normal' ? 'on' : ''} onClick={() => onSpeed('normal')}>
                Normal
              </button>
              <button className={speed === 'fast' ? 'on' : ''} onClick={() => onSpeed('fast')}>
                Fast
              </button>
            </span>
            <button className="small" onClick={onSimSeason} title="Every remaining match, yours included, is played by the computer.">
              Sim to season end
            </button>
          </>
        )}
      </header>

      <div className="hub-main">
        <div className="hub-left">
          {over ? (
            <section className="panel hub-next">
              <div className="hub-next-label">Season over</div>
              <div className="hub-champion">
                🏆 <b>{name(rows[0].team)}</b> are the champions
              </div>
              <div className="hub-next-sub">
                <span className="home">{name(me)}</span> finished {ordinal(placeOf(me))}, {my.won}–{my.lost}
              </div>
              <div className="hub-next-actions">
                <button className="primary big" onClick={onNewLeague}>
                  New game ▶
                </button>
              </div>
            </section>
          ) : mine && opponent !== null ? (
            <section className="panel hub-next">
              <div className="hub-next-label">Next match · matchday {league.matchday + 1}</div>
              <div className="hub-versus">
                {teamBlock(mine.home, 'Home')}
                <div className="hub-vs">
                  <span>VS</span>
                  {earlier && (
                    <small className="muted">
                      Last time: {league.teams[earlier.home].abbr} {earlier.score[0]}–{earlier.score[1]} {league.teams[earlier.away].abbr}
                    </small>
                  )}
                </div>
                {teamBlock(mine.away, 'Away')}
              </div>
              <div className="hub-next-actions">
                <button onClick={onSimMine} title="The computer plays your match with the plan it would suggest. The result stands.">
                  Sim my match
                </button>
                <button className="primary big" onClick={onPlay}>
                  Play the match ▶
                </button>
              </div>
            </section>
          ) : (
            <section className="panel hub-next">
              <div className="hub-next-label">Matchday {league.matchday + 1}</div>
              <div className="hub-next-sub">You have no game this matchday.</div>
              <div className="hub-next-actions">
                <button className="primary big" onClick={onPlay}>
                  Play matchday {league.matchday + 1} ▶
                </button>
              </div>
            </section>
          )}

          <section className="panel hub-table">
            <h3>Table</h3>
            <table className="eq standings">
              <thead>
                <tr>
                  {sorter.th('rank', '#', { tip: 'Place in the table' })}
                  {sorter.th('team', 'Team', { left: true, wide: true })}
                  {sorter.th('played', 'P', { tip: 'Played' })}
                  {sorter.th('won', 'W', { tip: 'Won' })}
                  {sorter.th('lost', 'L', { tip: 'Lost' })}
                  {sorter.th('pct', 'Win %', { tip: 'Share of games won' })}
                  {sorter.th('behind', 'GB', { tip: 'Games behind the leader' })}
                  {sorter.th('diff', '+/−', { tip: 'Point difference' })}
                  {sorter.th('last5', 'Form', { tip: 'Last five games, oldest first (sorts by wins)', width: 110 })}
                  {sorter.th('streak', 'Strk', { tip: 'Streak: the current run of wins or losses' })}
                </tr>
              </thead>
              <tbody>
                {sorter.sorted(rows).map((r) => {
                  const place = rows.indexOf(r) + 1;
                  return (
                    <tr key={r.team} className={`${r.team === me ? 'mine' : ''} ${place === 1 && r.played ? 'leader' : ''}`}>
                      <td>
                        <span className="place">{place}</span>
                      </td>
                      <td className="left">
                        <b>{name(r.team)}</b>
                      </td>
                      <td>{r.played}</td>
                      <td>{r.won}</td>
                      <td>{r.lost}</td>
                      <td>{r.played ? r.pct.toFixed(3).replace(/^0/, '') : '–'}</td>
                      <td>{place === 1 || !r.played ? '–' : r.behind}</td>
                      <td className={r.diff > 0 ? 'good' : r.diff < 0 ? 'bad' : ''}>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                      <td>
                        <Form last5={r.last5} />
                      </td>
                      <td>{r.streak || '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="muted small">Ties: head-to-head wins, then head-to-head points, then point difference, then points scored.</div>
          </section>
        </div>

        <aside className="hub-right">
          <section className="panel">
            <h3>Your season</h3>
            <div className="hub-stats">
              <div className="tile">
                <div className="tile-v">{my.played ? ordinal(placeOf(me)) : '–'}</div>
                <div className="tile-l">Place</div>
              </div>
              <div className="tile">
                <div className="tile-v">
                  {my.won}–{my.lost}
                </div>
                <div className="tile-l">Record</div>
              </div>
              <div className="tile">
                <div className="tile-v">{my.played ? (my.pf / games).toFixed(1) : '–'}</div>
                <div className="tile-l">Scored</div>
              </div>
              <div className="tile">
                <div className="tile-v">{my.played ? (my.pa / games).toFixed(1) : '–'}</div>
                <div className="tile-l">Conceded</div>
              </div>
            </div>
          </section>

          <section className="panel">
            <h3>Top scorers</h3>
            {leaders.length === 0 ? (
              <div className="muted small">After the first matchday.</div>
            ) : (
              <table className="eq hub-list">
                <tbody>
                  {leaders.map((l, i) => (
                    <tr key={l.id} className={l.team === me ? 'mine' : ''}>
                      <td style={{ width: 24 }}>{i + 1}</td>
                      <td className="left wide" style={{ width: '52%' }}>
                        <b>{l.name}</b>
                      </td>
                      <td className="muted small">{league.teams[l.team].abbr}</td>
                      <td>
                        <b>{l.ppg.toFixed(1)}</b> <span className="muted small">ppg</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {others.length > 0 && (
            <section className="panel">
              <h3>Also on matchday {league.matchday + 1}</h3>
              <table className="eq hub-list">
                <tbody>
                  {others.map((f, k) => (
                    <tr key={k}>
                      <td className="left wide" style={{ width: '45%' }}>
                        {name(f.home)}
                      </td>
                      <td className="muted small">v</td>
                      <td className="rt wide" style={{ width: '45%' }}>
                        {name(f.away)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {last.length > 0 && (
            <section className="panel">
              <h3>Matchday {league.matchday} results</h3>
              <table className="eq hub-list">
                <tbody>
                  {last.map((g, k) => {
                    const homeWon = g.score[0] > g.score[1];
                    return (
                      <tr key={k} className={g.home === me || g.away === me ? 'mine' : ''}>
                        <td className={`left wide ${homeWon ? 'won' : 'lost'}`} style={{ width: '38%' }}>
                          {name(g.home)}
                        </td>
                        <td className="score">
                          {g.score[0]}–{g.score[1]}
                          {g.overtime ? <span className="muted small"> OT</span> : null}
                        </td>
                        <td className={`rt wide ${homeWon ? 'lost' : 'won'}`} style={{ width: '38%' }}>
                          {name(g.away)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
