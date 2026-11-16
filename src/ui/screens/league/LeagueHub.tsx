// The season hub (SEASON_SPEC R2.4): the table, this matchday's games, the last results, and the
// way on: play your match, let the computer play it, or sim to the end of the season.

import { MATCHDAYS, fixtures, humanGames, table, type QuickLeague } from '../../../game/league/quickLeague';
import { LEAGUES } from '../../../game/league/leagues';

export function LeagueHub({
  league,
  onPlay,
  onSimMine,
  onSimSeason,
  onMenu,
  onNewLeague,
}: {
  league: QuickLeague;
  onPlay: () => void;
  onSimMine: () => void;
  onSimSeason: () => void;
  onMenu: () => void;
  onNewLeague: () => void;
}) {
  const rows = table(league);
  const name = (i: number) => league.teams[i].name;
  const cls = (i: number) => (league.teams[i].human === 0 ? 'home' : league.teams[i].human === 1 ? 'away' : '');
  const last = league.records.filter((g) => g.matchday === league.matchday - 1);
  const mine = humanGames(league);
  const over = league.phase === 'finished';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <button onClick={onMenu}>☰ Menu</button>
        <h1 style={{ margin: 0 }}>{LEAGUES[league.league].name}</h1>
        <span className="muted">{over ? 'Season over' : `Matchday ${league.matchday + 1} of ${MATCHDAYS}`}</span>
        <div className="spacer" />
        {!over && (
          <>
            <button onClick={onSimSeason} title="Every remaining match, yours included, is played by the computer.">
              Sim to the end of the season
            </button>
            {mine.length > 0 && (
              <button onClick={onSimMine} title="The computer plays your match this matchday, with the plan it would suggest. The result stands.">
                Sim my match
              </button>
            )}
            <button className="primary" onClick={onPlay}>
              Play matchday {league.matchday + 1} ▶
            </button>
          </>
        )}
        {over && (
          <button className="primary" onClick={onNewLeague}>
            New league ▶
          </button>
        )}
      </div>

      {over && (
        <div className="panel">
          <h2 style={{ margin: 0 }}>
            🏆 <span className={cls(rows[0].team)}>{name(rows[0].team)}</span> finish top of the table
          </h2>
          <div className="muted">
            {league.teams
              .filter((t) => t.human !== null)
              .map((t) => {
                const at = rows.findIndex((r) => league.teams[r.team].id === t.id);
                return `${t.name}: ${at + 1}${['st', 'nd', 'rd'][at] ?? 'th'}, ${rows[at].won}–${rows[at].lost}`;
              })
              .join(' · ')}
          </div>
        </div>
      )}

      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="panel" style={{ flex: '2 1 520px' }}>
          <h3>Table</h3>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th className="left">Team</th>
                <th title="Played">P</th>
                <th title="Won">W</th>
                <th title="Lost">L</th>
                <th title="Win %">%</th>
                <th title="Games behind the leader">GB</th>
                <th title="Points for">PF</th>
                <th title="Points against">PA</th>
                <th title="Point difference">+/−</th>
                <th className="left">Last 5</th>
                <th>Streak</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.team}>
                  <td>{i + 1}</td>
                  <td className="left">
                    <b className={cls(r.team)}>{name(r.team)}</b>
                  </td>
                  <td>{r.played}</td>
                  <td>{r.won}</td>
                  <td>{r.lost}</td>
                  <td>{r.played ? r.pct.toFixed(3).replace(/^0/, '') : '–'}</td>
                  <td>{i === 0 || !r.played ? '–' : r.behind}</td>
                  <td>{r.pf}</td>
                  <td>{r.pa}</td>
                  <td>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                  <td className="left">{r.last5.map((x, k) => <span key={k} style={{ color: x === 'W' ? 'var(--good, #4caf50)' : 'var(--bad, #e57373)' }}>{x}</span>)}</td>
                  <td>{r.streak}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted small" style={{ marginTop: 6 }}>
            Ties: head-to-head wins, then head-to-head points, then point difference, then points scored.
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12, flex: '1 1 300px' }}>
          {!over && (
            <div className="panel">
              <h3>Matchday {league.matchday + 1}</h3>
              <table>
                <tbody>
                  {fixtures(league).map((f, k) => (
                    <tr key={k}>
                      <td className="left">
                        <span className={cls(f.home)}>{name(f.home)}</span>
                      </td>
                      <td className="muted small">v</td>
                      <td className="left">
                        <span className={cls(f.away)}>{name(f.away)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {last.length > 0 && (
            <div className="panel">
              <h3>Matchday {league.matchday} results</h3>
              <table>
                <tbody>
                  {last.map((g, k) => (
                    <tr key={k}>
                      <td className="left">
                        <span className={cls(g.home)}>{name(g.home)}</span>
                      </td>
                      <td>
                        <b>
                          {g.score[0]}–{g.score[1]}
                        </b>
                        {g.overtime ? <span className="muted small"> OT</span> : null}
                      </td>
                      <td className="left">
                        <span className={cls(g.away)}>{name(g.away)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
