import { useMemo, useRef, useState } from 'react';
import { positionGroup } from '../../engine/ratings';
import { createRng } from '../../engine/rng';
import type { Position, Team } from '../../engine/types';
import { aiDraftAll, aiDraftPick, aiSnakeTurns } from '../../game/ai';
import {
  canPick,
  createDraft,
  currentTurn,
  findPool,
  GROUPS,
  groupCounts,
  isComplete,
  isTeamComplete,
  MIN_PER_GROUP,
  pick,
  release,
  ROSTER_SIZE,
  toTeam,
  type DraftState,
} from '../../game/draft';
import { playerPool, type PoolPlayer } from '../../game/pool';
import { ATTRIBUTE_GROUPS, DEFAULT_SCOUT_ACCURACY, formatRange, potentialStars, scoutAttr, scoutGroup } from '../../game/scouting';
import type { Setup } from '../App';
import { RangeCell, Stars } from '../components/common';
import { abbrOf } from '../labels';

type SortKey = 'price' | 'name' | 'physical' | 'scoring' | 'playmaking' | 'defence';

const GROUP_LABEL = { guard: 'Guards', wing: 'Wings', big: 'Bigs' } as const;

export function DraftScreen({ setup, onDone }: { setup: Setup; onDone: (teams: [Team, Team]) => void }) {
  const rng = useRef(createRng(Date.now() >>> 0));
  const [state, setState] = useState<DraftState>(() => {
    const controllers = setup.mode === 'ai' ? (['human', 'ai'] as const) : (['human', 'human'] as const);
    let s = createDraft(setup.draft === 'snake' ? 'snake' : 'free', playerPool(), [
      { name: setup.names[0], abbr: abbrOf(setup.names[0]), controller: controllers[0] },
      { name: setup.names[1], abbr: abbrOf(setup.names[1]), controller: controllers[1] },
    ]);
    if (s.mode === 'free' && controllers[1] === 'ai') s = aiDraftAll(s, 1, rng.current);
    if (s.mode === 'snake') s = aiSnakeTurns(s, rng.current);
    return s;
  });
  const [posFilter, setPosFilter] = useState<Position | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('price');
  const [hideTaken, setHideTaken] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const turn = currentTurn(state);
  // Which team the human is acting for right now.
  const actingTeam: 0 | 1 | null =
    state.mode === 'snake' ? (turn !== null && state.teams[turn].controller === 'human' ? turn : null) : isTeamComplete(state, 0) ? null : 0;

  const doPick = (id: string) => {
    if (actingTeam === null) return;
    let s = pick(state, actingTeam, id);
    if (s.mode === 'snake') s = aiSnakeTurns(s, rng.current);
    setState(s);
  };

  const autoPick = () => {
    if (actingTeam === null) return;
    const id = aiDraftPick(state, actingTeam, rng.current);
    if (id) doPick(id);
  };

  const groupMid = (p: PoolPlayer, key: string) => {
    const g = ATTRIBUTE_GROUPS.find((x) => x.key === key)!;
    const r = scoutGroup(p.player, g, p.hype, DEFAULT_SCOUT_ACCURACY);
    return (r.lo + r.hi) / 2;
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = state.pool.filter(
      (p) =>
        (posFilter === 'all' || p.player.position === posFilter) &&
        (!hideTaken || !(p.player.id in state.owner)) &&
        (!q || p.player.name.toLowerCase().includes(q) || p.player.archetype.toLowerCase().includes(q)),
    );
    const by: Record<SortKey, (p: PoolPlayer) => number | string> = {
      price: (p) => -p.price,
      name: (p) => p.player.name,
      physical: (p) => -groupMid(p, 'physical'),
      scoring: (p) => -groupMid(p, 'scoring'),
      playmaking: (p) => -groupMid(p, 'playmaking'),
      defence: (p) => -groupMid(p, 'defence'),
    };
    const f = by[sort];
    return [...list].sort((a, b) => {
      const x = f(a);
      const y = f(b);
      return typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
    });
  }, [state, posFilter, sort, hideTaken, search]);

  const sel = selected ? findPool(state, selected) : null;
  const done = isComplete(state);
  const statusText = done
    ? 'Both squads are complete.'
    : state.mode === 'snake'
      ? `Pick ${state.pickNo + 1} of ${ROSTER_SIZE * 2}: ${turn !== null ? state.teams[turn].name : ''} to choose`
      : actingTeam === 0
        ? `Sign ${ROSTER_SIZE - state.teams[0].picks.length} more players. ${state.teams[1].name} already shopped: their signings are greyed out.`
        : 'Your squad is complete.';

  return (
    <div className="draft">
      <div className="panel market">
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{state.mode === 'snake' ? 'Snake draft' : 'Free draft'}</h2>
          <span className={turn === 1 ? 'away' : 'home'}>{statusText}</span>
          <div className="spacer" />
          {actingTeam !== null && (
            <button onClick={autoPick} title="Let the assistant pick a sensible player for you">
              Auto-pick
            </button>
          )}
          <button className="primary" disabled={!done} onClick={() => onDone([toTeam(state, 0, 'home'), toTeam(state, 1, 'away')])}>
            Continue to match prep ▶
          </button>
        </div>
        <div className="row wrap" style={{ marginBottom: 8 }}>
          {(['all', 'PG', 'SG', 'SF', 'PF', 'C'] as const).map((p) => (
            <button key={p} className={`small ${posFilter === p ? 'active' : ''}`} onClick={() => setPosFilter(p)}>
              {p === 'all' ? 'All' : p}
            </button>
          ))}
          <input placeholder="Search name or role…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 180 }} />
          <label className="small muted">
            <input type="checkbox" checked={hideTaken} onChange={(e) => setHideTaken(e.target.checked)} /> hide signed
          </label>
          <div className="spacer" />
          <span className="muted small">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="price">Price</option>
            <option value="scoring">Scoring</option>
            <option value="playmaking">Playmaking</option>
            <option value="defence">Defence &amp; boards</option>
            <option value="physical">Physical</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                <th className="left">Player</th>
                <th className="left">Pos</th>
                <th>Height</th>
                {ATTRIBUTE_GROUPS.map((g) => (
                  <th key={g.key}>{g.label}</th>
                ))}
                <th>Pot.</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const id = p.player.id;
                const owner = state.owner[id];
                const check = actingTeam !== null ? canPick(state, actingTeam, id) : { ok: false, reason: '' };
                return (
                  <tr
                    key={id}
                    className={`clickable ${owner !== undefined ? 'taken' : ''} ${selected === id ? 'selected' : ''}`}
                    onClick={() => setSelected(id)}
                    onDoubleClick={() => check.ok && doPick(id)}
                  >
                    <td className="left">
                      {owner !== undefined ? (
                        <span className={owner === 0 ? 'home' : 'away'}>{state.teams[owner].abbr}</span>
                      ) : (
                        <button
                          className={`small ${check.ok ? 'primary' : ''}`}
                          disabled={!check.ok}
                          title={check.ok ? `Sign for ${p.price} credits` : check.reason}
                          onClick={(e) => {
                            e.stopPropagation();
                            doPick(id);
                          }}
                        >
                          + Sign
                        </button>
                      )}
                    </td>
                    <td className="left">
                      <b>{p.player.name}</b> <span className="tag">{p.player.archetype}</span>
                    </td>
                    <td className="left">{p.player.position}</td>
                    <td>{p.player.heightCm} cm</td>
                    {ATTRIBUTE_GROUPS.map((g) => (
                      <td key={g.key}>
                        <RangeCell r={scoutGroup(p.player, g, p.hype, DEFAULT_SCOUT_ACCURACY)} />
                      </td>
                    ))}
                    <td>
                      <Stars n={potentialStars(p.player, DEFAULT_SCOUT_ACCURACY)} />
                    </td>
                    <td className="price">{p.price}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="side">
        {sel && (
          <PlayerDetail
            p={sel}
            owner={state.owner[sel.player.id] !== undefined ? state.teams[state.owner[sel.player.id]].name : null}
            check={actingTeam !== null ? canPick(state, actingTeam, sel.player.id) : { ok: false, reason: 'Not your turn' }}
            onSign={() => doPick(sel.player.id)}
          />
        )}
        {([0, 1] as const).map((team) => {
          const t = state.teams[team];
          const counts = groupCounts(state, team);
          return (
            <div key={team} className="panel">
              <div className="row">
                <h2 className={team === 0 ? 'home' : 'away'} style={{ margin: 0 }}>
                  {t.name}
                </h2>
                <div className="spacer" />
                <span className="budget">{t.budgetLeft}</span>
                <span className="muted small">credits left</span>
              </div>
              <div className="row need">
                {GROUPS.map((g) => (
                  <span key={g} className={counts[g] >= MIN_PER_GROUP ? 'good' : 'muted'}>
                    {GROUP_LABEL[g]} {counts[g]}/{MIN_PER_GROUP}+
                  </span>
                ))}
                <div className="spacer" />
                <span>
                  {t.picks.length}/{ROSTER_SIZE}
                </span>
              </div>
              <div style={{ marginTop: 6 }}>
                {t.picks.map((id) => {
                  const p = findPool(state, id);
                  return (
                    <div key={id} className="roster-slot">
                      <span className="tag">{p.player.position}</span>
                      <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => setSelected(id)}>
                        {p.player.name}
                      </span>
                      <span className="price">{p.price}</span>
                      {state.mode === 'free' && t.controller === 'human' && (
                        <button className="small" onClick={() => setState(release(state, team, id))} title="Release (refund)">
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
                {t.picks.length === 0 && <div className="muted small">No players yet.</div>}
              </div>
            </div>
          );
        })}
        <div className="panel muted small">
          Click a player to see details, then press <b>+ Sign</b> (or double-click the row). Prices follow reputation, not usefulness. A cheap, unknown player might be exactly what your system needs. Ratings are scout
          ranges: famous players are easy to read, unknowns are a gamble. Need at least {MIN_PER_GROUP} guards (PG/SG), wings (SF) and bigs
          (PF/C).
        </div>
      </div>
    </div>
  );
}

function PlayerDetail({ p, owner, check, onSign }: { p: PoolPlayer; owner: string | null; check: { ok: boolean; reason?: string }; onSign: () => void }) {
  const pl = p.player;
  return (
    <div className="panel">
      <div className="row">
        <h2 style={{ margin: 0 }}>{pl.name}</h2>
        <div className="spacer" />
        {owner ? (
          <span className="muted">Signed by {owner}</span>
        ) : (
          <button className="primary" disabled={!check.ok} onClick={onSign} title={check.reason}>
            Sign for {p.price} credits
          </button>
        )}
      </div>
      {!owner && !check.ok && check.reason && <div className="bad small">{check.reason}</div>}
      <div className="muted small" style={{ marginBottom: 6 }}>
        {pl.position} · {pl.archetype} · {pl.heightCm} cm · {pl.weightKg} kg · {positionGroup(pl.position)} · fame {p.hype}
      </div>
      <table>
        <tbody>
          {ATTRIBUTE_GROUPS.map((g) =>
            g.attrs.map((a, i) => (
              <tr key={a.key}>
                <td className="left muted small">{i === 0 ? g.label : ''}</td>
                <td className="left">{a.label}</td>
                <td>
                  <RangeCell r={scoutAttr(pl, a.key, p.hype, DEFAULT_SCOUT_ACCURACY)} />
                </td>
              </tr>
            )),
          )}
          <tr>
            <td className="left muted small">Hidden</td>
            <td className="left">Potential</td>
            <td>
              <Stars n={potentialStars(pl, DEFAULT_SCOUT_ACCURACY)} />
            </td>
          </tr>
        </tbody>
      </table>
      <div className="muted small">Ranges like {formatRange({ lo: 70, hi: 85 })} are scout estimates; the true value is somewhere inside.</div>
    </div>
  );
}
