// Building the squads: the market on the left (every player, sortable by any column, filtered by
// position, name, price and whether he can still be signed), the selected player and both squads on
// the right. Ratings are scout estimates: a range for players you do not know well.

import { useEffect, useMemo, useRef, useState } from 'react';
import { positionGroup } from '../../engine/ratings';
import { createRng } from '../../engine/rng';
import type { Position, Side, Team } from '../../engine/types';
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
import { BUDGET } from '../../game/pricing';
import { ATTRIBUTE_GROUPS, DEFAULT_SCOUT_ACCURACY, potentialStars, scoutAttr, scoutRating, type Range } from '../../game/scouting';
import type { Setup } from '../App';
import { RangeCell, Stars } from '../components/common';
import { Portrait } from '../components/Portrait';
import { abbrOf } from '../labels';

/** The ratings shown for every player, as on the break screen. */
const RATINGS = [
  { key: 'overall', label: 'OVR', tip: 'Overall rating (what the market thinks)' },
  { key: 'three', label: '3PT', tip: 'Three-point shooting' },
  { key: 'insideScoring', label: 'Inside', tip: 'Scoring near the basket (size + finishing)' },
  { key: 'playmaking', label: 'Pass', tip: 'Passing and ball handling' },
  { key: 'perimeterD', label: 'Guard', tip: 'Perimeter defence: staying in front of guards and wings' },
  { key: 'rimProtection', label: 'Rim D', tip: 'Protecting the basket: blocks and contesting inside shots' },
  { key: 'rebounding', label: 'Boards', tip: 'Rebounding' },
  { key: 'speed', label: 'Speed', tip: 'Speed' },
] as const;
type RatingKey = (typeof RATINGS)[number]['key'];
type SortKey = RatingKey | 'name' | 'pos' | 'height' | 'weight' | 'potential' | 'price';

const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const GROUP_LABEL = { guard: 'Guards', wing: 'Wings', big: 'Bigs' } as const;
const mid = (r: Range) => (r.lo + r.hi) / 2;

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
  const [positions, setPositions] = useState<Position[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'price', desc: true });
  const [hideTaken, setHideTaken] = useState(true);
  const [affordable, setAffordable] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  /** Click a player to see him; click him again (or press Escape) to put him away. */
  const toggleSelected = (id: string) => setSelected((cur) => (cur === id ? null : id));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // Every player's scouted ratings, worked out once.
  const scouted = useMemo(() => {
    const out = new Map<string, Record<RatingKey, Range>>();
    for (const p of state.pool) {
      out.set(p.player.id, Object.fromEntries(RATINGS.map((r) => [r.key, scoutRating(p.player, r.key, p.hype, DEFAULT_SCOUT_ACCURACY)])) as Record<RatingKey, Range>);
    }
    return out;
  }, [state.pool]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = state.pool.filter((p) => {
      const id = p.player.id;
      if (positions.length > 0 && !positions.includes(p.player.position)) return false;
      if (hideTaken && id in state.owner) return false;
      if (affordable && (actingTeam === null || !canPick(state, actingTeam, id).ok)) return false;
      return !q || p.player.name.toLowerCase().includes(q) || p.player.archetype.toLowerCase().includes(q);
    });
    const value = (p: PoolPlayer): number | string => {
      switch (sort.key) {
        case 'name':
          return p.player.name;
        case 'pos':
          return POSITIONS.indexOf(p.player.position);
        case 'height':
          return p.player.heightCm;
        case 'weight':
          return p.player.weightKg;
        case 'potential':
          return potentialStars(p.player, DEFAULT_SCOUT_ACCURACY);
        case 'price':
          return p.price;
        default:
          return mid(scouted.get(p.player.id)![sort.key]);
      }
    };
    return [...list].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.desc ? -c : c;
    });
  }, [state, positions, sort, hideTaken, affordable, search, actingTeam, scouted]);

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'name' && key !== 'pos' }));
  const togglePosition = (p: Position) => setPositions((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]));

  const sel = selected ? findPool(state, selected) : null;
  const done = isComplete(state);
  const statusText = done
    ? 'Both squads are complete.'
    : state.mode === 'snake'
      ? `Pick ${state.pickNo + 1} of ${ROSTER_SIZE * 2}: ${turn !== null ? state.teams[turn].name : ''} to choose`
      : actingTeam === 0
        ? `Sign ${ROSTER_SIZE - state.teams[0].picks.length} more players. ${state.teams[1].name} already shopped: their signings are greyed out.`
        : 'Your squad is complete.';

  const Th = ({ k, label, tip, left }: { k: SortKey; label: string; tip?: string; left?: boolean }) => (
    <th className={`sortable ${left ? 'left' : ''} ${sort.key === k ? 'sorted' : ''}`} title={tip ? `${tip}. Click to sort.` : 'Click to sort.'} onClick={() => sortBy(k)}>
      {label}
      {sort.key === k ? (sort.desc ? ' ▼' : ' ▲') : ''}
    </th>
  );

  return (
    <div className="dr">
      <div className="panel dr-market">
        <div className="dr-head">
          <h1>{state.mode === 'snake' ? 'Snake draft' : 'Free draft'}</h1>
          <span className={`small ${turn === 1 ? 'away' : 'home'}`}>{statusText}</span>
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

        <div className="dr-filters">
          <span className="brk-chips">
            <button className={`chip ${positions.length === 0 ? 'active' : ''}`} onClick={() => setPositions([])}>
              All
            </button>
            {POSITIONS.map((p) => (
              <button key={p} className={`chip ${positions.includes(p) ? 'active' : ''}`} onClick={() => togglePosition(p)} title="Click several to combine">
                {p}
              </button>
            ))}
          </span>
          <input className="dr-search" placeholder="Search name or role…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="small">
            <input type="checkbox" checked={hideTaken} onChange={(e) => setHideTaken(e.target.checked)} /> Hide signed
          </label>
          <label className="small" title="Only players you can sign now: within budget, and leaving room for the positions you still need">
            <input type="checkbox" checked={affordable} onChange={(e) => setAffordable(e.target.checked)} disabled={actingTeam === null} /> Only ones I can sign
          </label>
          <div className="spacer" />
          <span className="muted small">{rows.length} players · click a column to sort</span>
        </div>

        <div className="dr-scroll">
          <table className="brk-table dr-table">
            <thead>
              <tr>
                <th />
                <Th k="name" label="Player" left />
                <Th k="pos" label="Pos" left />
                <Th k="height" label="Ht" tip="Height (cm)" />
                <Th k="weight" label="Wt" tip="Weight (kg)" />
                {RATINGS.map((r) => (
                  <Th key={r.key} k={r.key} label={r.label} tip={r.tip} />
                ))}
                <Th k="potential" label="Pot." tip="Development potential (scout estimate)" />
                <Th k="price" label="Price" tip="Price in credits" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const id = p.player.id;
                const owner = state.owner[id];
                const check = actingTeam !== null ? canPick(state, actingTeam, id) : { ok: false, reason: '' };
                const r = scouted.get(id)!;
                return (
                  <tr
                    key={id}
                    className={`clickable ${owner !== undefined ? 'taken' : ''} ${selected === id ? 'selected picked-row' : ''}`}
                    onClick={() => toggleSelected(id)}
                    onDoubleClick={() => {
                      // The two clicks of a double-click select and unselect: keep him selected as he signs.
                      setSelected(id);
                      if (check.ok) doPick(id);
                    }}
                  >
                    <td className="left">
                      {owner !== undefined ? (
                        <b className={owner === 0 ? 'home' : 'away'}>{state.teams[owner].abbr}</b>
                      ) : (
                        <button
                          className={`tiny ${check.ok ? 'primary' : ''}`}
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
                      <span className="player-cell">
                        <Portrait player={p.player} side={owner} size={26} number={false} />
                        <span className="dr-who">
                          <b>{p.player.name}</b>
                          <span className="muted"> {p.player.archetype}</span>
                        </span>
                      </span>
                    </td>
                    <td className="left">{p.player.position}</td>
                    <td className="muted">{p.player.heightCm}</td>
                    <td className="muted">{p.player.weightKg}</td>
                    {RATINGS.map((rt) => (
                      <td key={rt.key}>
                        <RangeCell r={r[rt.key]} />
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

      <div className="dr-side">
        {sel ? (
          <PlayerCard
            p={sel}
            ratings={scouted.get(sel.player.id)!}
            owner={state.owner[sel.player.id] !== undefined ? state.teams[state.owner[sel.player.id]].name : null}
            ownerSide={state.owner[sel.player.id]}
            check={actingTeam !== null ? canPick(state, actingTeam, sel.player.id) : { ok: false, reason: 'Not your turn' }}
            onSign={() => doPick(sel.player.id)}
            onClose={() => setSelected(null)}
          />
        ) : (
          <div className="brk-key dr-hint muted small">
            Click a player for his details; <b>+ Sign</b> (or a double-click) signs him. Prices follow reputation, not usefulness: a cheap unknown can be just what your system needs. Ratings are scout
            ranges: famous players are easy to read, unknowns are a gamble.
          </div>
        )}
        {([0, 1] as const).map((team) => (
          <Squad key={team} state={state} team={team} scouted={scouted} onSelect={toggleSelected} onRelease={(id) => setState(release(state, team, id))} />
        ))}
      </div>
    </div>
  );
}

/** The selected player: who he is, his game ratings, and every attribute the scouts have on him. */
function PlayerCard({
  p,
  ratings,
  owner,
  ownerSide,
  check,
  onSign,
  onClose,
}: {
  p: PoolPlayer;
  ratings: Record<RatingKey, Range>;
  owner: string | null;
  ownerSide?: Side;
  check: { ok: boolean; reason?: string };
  onSign: () => void;
  onClose: () => void;
}) {
  const pl = p.player;
  const colour = ownerSide === 0 ? 'var(--home)' : ownerSide === 1 ? 'var(--away)' : 'var(--line)';
  return (
    <div className="brk-key dr-card" style={{ borderColor: colour }}>
      <div className="brk-key-body">
        <Portrait player={pl} side={ownerSide} size={84} number={false} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row">
            <div className="brk-key-name">{pl.name}</div>
            <div className="spacer" />
            <button className="tiny" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
          <div className="muted small">
            {pl.position} · {pl.archetype} · {pl.heightCm} cm · {pl.weightKg} kg · {positionGroup(pl.position)} · fame {p.hype}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <Stars n={potentialStars(pl, DEFAULT_SCOUT_ACCURACY)} />
            <div className="spacer" />
            {owner ? (
              <span className="muted small">Signed by {owner}</span>
            ) : (
              <button className="primary small" disabled={!check.ok} onClick={onSign} title={check.reason}>
                Sign for {p.price}
              </button>
            )}
          </div>
          {!owner && !check.ok && check.reason && <div className="bad small">{check.reason}</div>}
        </div>
      </div>
      <div className="dr-ratings">
        {RATINGS.map((r) => (
          <div key={r.key} title={r.tip}>
            <span className="muted small">{r.label}</span>
            <RangeCell r={ratings[r.key]} />
          </div>
        ))}
      </div>
      <div className="dr-attrs">
        {ATTRIBUTE_GROUPS.flatMap((g) =>
          g.attrs.map((a) => (
            <div key={a.key}>
              <span className="muted small">{a.label}</span>
              <RangeCell r={scoutAttr(pl, a.key, p.hype, DEFAULT_SCOUT_ACCURACY)} />
            </div>
          )),
        )}
      </div>
    </div>
  );
}

/** One squad: budget, the positions it still needs, and its players. */
function Squad({
  state,
  team,
  scouted,
  onSelect,
  onRelease,
}: {
  state: DraftState;
  team: 0 | 1;
  scouted: Map<string, Record<RatingKey, Range>>;
  onSelect: (id: string) => void;
  onRelease: (id: string) => void;
}) {
  const t = state.teams[team];
  const counts = groupCounts(state, team);
  const colour = team === 0 ? 'var(--home)' : 'var(--away)';
  const canRelease = state.mode === 'free' && t.controller === 'human';
  return (
    <div className="brk-roster dr-squad" style={{ borderTopColor: colour }}>
      <div className="brk-roster-head">
        <b style={{ color: colour }}>{t.name}</b>
        <span className="small">
          {t.picks.length}/{ROSTER_SIZE}
        </span>
        <div className="spacer" />
        <span className="small">
          <b className="price">{t.budgetLeft}</b> <span className="muted">of {BUDGET} credits left</span>
        </span>
      </div>
      <div className="dr-budget">
        <div style={{ width: `${(100 * t.budgetLeft) / BUDGET}%`, background: colour }} />
      </div>
      <div className="brk-chips" style={{ margin: '4px 0' }}>
        {GROUPS.map((g) => (
          <span key={g} className={`dr-need ${counts[g] >= MIN_PER_GROUP ? 'met' : ''}`} title={`At least ${MIN_PER_GROUP} ${GROUP_LABEL[g].toLowerCase()}`}>
            {GROUP_LABEL[g]} {counts[g]}/{MIN_PER_GROUP}
          </span>
        ))}
      </div>
      {t.picks.length === 0 ? (
        <div className="muted small">No players yet.</div>
      ) : (
        <table className="brk-table">
          <tbody>
            {t.picks.map((id) => {
              const p = findPool(state, id);
              return (
                <tr key={id} className="clickable" onClick={() => onSelect(id)}>
                  <td className="left">
                    <span className="player-cell">
                      <Portrait player={p.player} side={team} size={22} number={false} />
                      <span className="brk-name">{p.player.name}</span>
                    </span>
                  </td>
                  <td className="left muted">{p.player.position}</td>
                  <td title="Overall (scouted)">
                    <RangeCell r={scouted.get(id)!.overall} />
                  </td>
                  <td className="price">{p.price}</td>
                  <td>
                    {canRelease && (
                      <button
                        className="tiny"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRelease(id);
                        }}
                        title="Release (refund)"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
