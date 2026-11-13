// A timeout or a quarter break on one screen: the score by quarter, each side's key player, the two
// teams side by side, every player's line, and the tactics with the assistant's advice. Changes to
// the five on court and the plan are made here and go in when play resumes.

import { useState } from 'react';
import { composite } from '../../engine/ratings';
import { playerRating } from '../../engine/stats';
import { DEFENCE_SCHEMES, OFFENSIVE_FOCI, TEMPOS, type GamePlan, type KeyMatchup, type Player, type PlayerStats, type Side } from '../../engine/types';
import { suggestPlan } from '../../game/ai';
import type { Controller } from '../../game/draft';
import { TALKS } from '../../game/teamTalk';
import { DEFENCE_INFO, OFFENCE_INFO, TEMPO_INFO, periodLabel, type OptionInfo } from '../labels';
import type { LiveMatch } from '../match/controller';
import { EnergyBar, RatingBadge } from './common';
import { Portrait, ShirtNumber } from './Portrait';

const other = (s: Side): Side => (s === 0 ? 1 : 0);
const pct = (made: number, att: number) => (att > 0 ? `${Math.round((100 * made) / att)}%` : '–');

export function BreakScreen({ m, controllers, onDone }: { m: LiveMatch; controllers: [Controller, Controller]; onDone: () => void }) {
  // An ejected coach is not on the bench in a timeout; at a quarter break his orders go through the assistant.
  const humans = ([0, 1] as const).filter((s) => controllers[s] === 'human' && !(m.phase === 'timeout' && m.view[s].coachEjected));
  // The side that called the timeout goes first.
  const ordered = m.timeoutSide !== null && humans.includes(m.timeoutSide) ? [m.timeoutSide, ...humans.filter((s) => s !== m.timeoutSide)] : humans;
  const livePlan = (side: Side): GamePlan => {
    const t = m.s.teams[side];
    const lineup = [...t.lineup];
    const rest = [...t.plan.starters, ...t.plan.bench, ...t.team.players.map((p) => p.id)].filter((id, i, arr) => !lineup.includes(id) && arr.indexOf(id) === i);
    return { ...t.plan, starters: lineup, bench: rest };
  };
  const [drafts, setDrafts] = useState<Record<number, GamePlan>>(() => Object.fromEntries(ordered.map((s) => [s, livePlan(s)])));
  const [tab, setTab] = useState<Side>(ordered[0] ?? 0);
  // Whose roster is "ours" on screen: the coach's, or the home side when nobody here coaches.
  const us: Side = ordered.length > 0 ? tab : 0;

  const title =
    m.phase === 'timeout'
      ? `Timeout: ${m.s.teams[m.timeoutSide ?? 0].team.name}`
      : m.breakQuarter === 2
        ? 'Halftime'
        : m.breakQuarter >= 4
          ? 'End of regulation: overtime!'
          : `End of Q${m.breakQuarter}`;

  const valid = ordered.every((s) => drafts[s].starters.length === 5);
  const apply = () => {
    for (const s of ordered) {
      const after = drafts[s];
      if (JSON.stringify(livePlan(s)) !== JSON.stringify(after)) m.applyPlan(s, after);
    }
    onDone();
  };
  const editing = drafts[us] ? us : null;

  return (
    <div className="overlay">
      <div className="panel modal brk">
        <BreakHeader m={m} title={title} valid={valid} onBack={apply} />
        {ordered.length > 1 && (
          <div className="tabs">
            {ordered.map((s) => (
              <button key={s} className={tab === s ? 'active' : ''} onClick={() => setTab(s)} style={{ borderColor: s === 0 ? 'var(--home)' : 'var(--away)' }}>
                {m.s.teams[s].team.name}
                {m.phase === 'timeout' && s !== m.timeoutSide ? ' (may adjust too)' : ''}
              </button>
            ))}
          </div>
        )}

        <div className="brk-top">
          <KeyPlayer m={m} side={0} />
          <TeamCompare m={m} />
          <KeyPlayer m={m} side={1} />
        </div>

        <div className="brk-rosters">
          {([us, other(us)] as const).map((side) => (
            <Roster
              key={side}
              m={m}
              side={side}
              plan={side === editing ? drafts[side] : livePlan(side)}
              onChange={side === editing ? (p) => setDrafts((d) => ({ ...d, [side]: p })) : undefined}
            />
          ))}
        </div>

        {editing !== null ? (
          <Tactics m={m} side={editing} plan={drafts[editing]} onChange={(p) => setDrafts((d) => ({ ...d, [editing]: p }))} />
        ) : (
          <div className="muted">The coaches are talking it over…</div>
        )}
      </div>
    </div>
  );
}

/** Title, the score by quarter, and the way back to the game. */
function BreakHeader({ m, title, valid, onBack }: { m: LiveMatch; title: string; valid: boolean; onBack: () => void }) {
  const periods = Math.max(4, ...m.s.teams.map((t) => t.quarterPoints.length));
  // Quarters played so far: at a break the one just finished, in a timeout the one under way.
  const played = m.phase === 'break' ? m.breakQuarter : m.quarter;
  return (
    <div className="brk-head">
      <h1>{title}</h1>
      <table className="brk-quarters">
        <thead>
          <tr>
            <th />
            {Array.from({ length: periods }, (_, i) => (
              <th key={i}>{periodLabel(i + 1)}</th>
            ))}
            <th>T</th>
          </tr>
        </thead>
        <tbody>
          {([0, 1] as const).map((side) => (
            <tr key={side}>
              <td className={`left ${side === 0 ? 'home' : 'away'}`}>
                <b>{m.s.teams[side].team.abbr}</b>
              </td>
              {Array.from({ length: periods }, (_, i) => (
                <td key={i} className="muted">
                  {i < played ? (m.s.teams[side].quarterPoints[i] ?? 0) : ''}
                </td>
              ))}
              <td>
                <b>{m.score[side]}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="spacer" />
      <button className="primary" disabled={!valid} onClick={onBack}>
        Back to the game ▶
      </button>
    </div>
  );
}

/** The player of the match so far for one side: the best rating among those who have played. */
function KeyPlayer({ m, side }: { m: LiveMatch; side: Side }) {
  const t = m.s.teams[side];
  const best = t.team.players
    .map((p) => ({ p, s: t.players[p.id].stats, r: playerRating(t.players[p.id].stats) }))
    .filter((x) => x.r !== null)
    .sort((a, b) => (b.r ?? 0) - (a.r ?? 0))[0];
  const colour = side === 0 ? 'var(--home)' : 'var(--away)';
  return (
    <div className="card-star" style={{ ['--team' as string]: colour }}>
      <div className="card-star-head">Key player · {t.team.name}</div>
      {best ? (
        <>
          <div className="card-star-body">
            <div className="card-star-portrait">
              <Portrait player={best.p} side={side} size={72} number={false} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="card-star-name">{best.p.name}</div>
              <div className="card-star-team">
                #{best.p.number} · {best.p.position} · {Math.round(best.s.seconds / 60)} min
              </div>
            </div>
          </div>
          <div className="card-tiles">
            <div className="tile hot">
              <div className="tile-v">{(best.r ?? 0).toFixed(1)}</div>
              <div className="tile-l">Rating</div>
            </div>
            {[
              [`${best.s.pts}`, 'Pts'],
              [`${best.s.oreb + best.s.dreb}`, 'Reb'],
              [`${best.s.ast}`, 'Ast'],
              [`${best.s.fgm}-${best.s.fga}`, 'FG'],
              [`${best.s.tpm}-${best.s.tpa}`, '3P'],
            ].map(([v, l]) => (
              <div key={l} className="tile">
                <div className="tile-v">{v}</div>
                <div className="tile-l">{l}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="muted small" style={{ padding: 12 }}>
          Nobody has played yet.
        </div>
      )}
    </div>
  );
}

/** The two teams side by side: each row a stat, with a bar that leans to whoever is ahead on it. */
function TeamCompare({ m }: { m: LiveMatch }) {
  const tot = ([0, 1] as const).map((side) => {
    const t = m.s.teams[side];
    const sum = (k: keyof PlayerStats) => Object.values(t.players).reduce((a, p) => a + p.stats[k], 0);
    return { fgm: sum('fgm'), fga: sum('fga'), tpm: sum('tpm'), tpa: sum('tpa'), ftm: sum('ftm'), fta: sum('fta'), reb: sum('oreb') + sum('dreb'), ast: sum('ast'), tov: sum('tov'), stl: sum('stl'), blk: sum('blk'), extras: t.extras };
  });
  const rows: { label: string; v: [number, number]; text: [string, string]; lowerIsBetter?: boolean }[] = [
    { label: 'Field goals', v: [rate(tot[0].fgm, tot[0].fga), rate(tot[1].fgm, tot[1].fga)], text: [`${tot[0].fgm}/${tot[0].fga} ${pct(tot[0].fgm, tot[0].fga)}`, `${tot[1].fgm}/${tot[1].fga} ${pct(tot[1].fgm, tot[1].fga)}`] },
    { label: 'Three-pointers', v: [rate(tot[0].tpm, tot[0].tpa), rate(tot[1].tpm, tot[1].tpa)], text: [`${tot[0].tpm}/${tot[0].tpa} ${pct(tot[0].tpm, tot[0].tpa)}`, `${tot[1].tpm}/${tot[1].tpa} ${pct(tot[1].tpm, tot[1].tpa)}`] },
    { label: 'Free throws', v: [rate(tot[0].ftm, tot[0].fta), rate(tot[1].ftm, tot[1].fta)], text: [`${tot[0].ftm}/${tot[0].fta} ${pct(tot[0].ftm, tot[0].fta)}`, `${tot[1].ftm}/${tot[1].fta} ${pct(tot[1].ftm, tot[1].fta)}`] },
    { label: 'Rebounds', v: [tot[0].reb, tot[1].reb], text: [`${tot[0].reb}`, `${tot[1].reb}`] },
    { label: 'Assists', v: [tot[0].ast, tot[1].ast], text: [`${tot[0].ast}`, `${tot[1].ast}`] },
    { label: 'Turnovers', v: [tot[0].tov, tot[1].tov], text: [`${tot[0].tov}`, `${tot[1].tov}`], lowerIsBetter: true },
    { label: 'Steals · blocks', v: [tot[0].stl + tot[0].blk, tot[1].stl + tot[1].blk], text: [`${tot[0].stl} · ${tot[0].blk}`, `${tot[1].stl} · ${tot[1].blk}`] },
    { label: 'Points in the paint', v: [tot[0].extras.paintPts, tot[1].extras.paintPts], text: [`${tot[0].extras.paintPts}`, `${tot[1].extras.paintPts}`] },
    { label: 'Fast-break points', v: [tot[0].extras.fastBreakPts, tot[1].extras.fastBreakPts], text: [`${tot[0].extras.fastBreakPts}`, `${tot[1].extras.fastBreakPts}`] },
  ];
  return (
    <div className="brk-compare">
      {rows.map((r) => {
        const total = r.v[0] + r.v[1];
        const home = total > 0 ? r.v[0] / total : 0.5;
        const better = r.v[0] === r.v[1] ? -1 : (r.v[0] > r.v[1]) !== !!r.lowerIsBetter ? 0 : 1;
        return (
          <div key={r.label} className="brk-cmp-row">
            <span className={`brk-cmp-v ${better === 0 ? 'lead' : ''}`}>{r.text[0]}</span>
            <div className="brk-cmp-mid">
              <div className="brk-cmp-label">{r.label}</div>
              <div className="brk-cmp-bar">
                <div style={{ width: `${home * 100}%`, background: 'var(--home)' }} />
                <div style={{ width: `${(1 - home) * 100}%`, background: 'var(--away)' }} />
              </div>
            </div>
            <span className={`brk-cmp-v right ${better === 1 ? 'lead' : ''}`}>{r.text[1]}</span>
          </div>
        );
      })}
    </div>
  );
}

const rate = (made: number, att: number) => (att > 0 ? made / att : 0);

/**
 * One side's players: on court first, then the bench in sub order. With `onChange` it is the coach's
 * own team: click a player on court and one on the bench to swap them, arrows set the sub order.
 */
function Roster({ m, side, plan, onChange }: { m: LiveMatch; side: Side; plan: GamePlan; onChange?: (p: GamePlan) => void }) {
  const t = m.s.teams[side];
  const byId = new Map(t.team.players.map((p) => [p.id, p]));
  const bench = [...plan.bench, ...t.team.players.map((p) => p.id).filter((id) => !plan.starters.includes(id) && !plan.bench.includes(id))];
  const [picked, setPicked] = useState<string | null>(null);
  const set = (patch: Partial<GamePlan>) => onChange?.({ ...plan, ...patch });

  const pick = (id: string) => {
    if (!onChange || t.players[id].fouledOut) return;
    if (!picked || picked === id) return setPicked(picked === id ? null : id);
    const pickedOn = plan.starters.includes(picked);
    if (pickedOn === plan.starters.includes(id)) return setPicked(id);
    const [onId, offId] = pickedOn ? [picked, id] : [id, picked];
    set({ starters: plan.starters.map((x) => (x === onId ? offId : x)), bench: bench.map((x) => (x === offId ? onId : x)) });
    setPicked(null);
  };
  const move = (id: string, delta: number) => {
    const order = [...bench];
    const i = order.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    set({ bench: order });
  };

  const row = (id: string, onCourt: boolean, benchIndex = 0) => {
    const p = byId.get(id) as Player;
    const ps = t.players[id];
    const s = ps.stats;
    const out = ps.fouledOut;
    return (
      <tr
        key={id}
        className={`${onChange ? 'clickable' : ''} ${out ? 'taken' : ''} ${onCourt ? 'starter' : ''} ${picked === id ? 'selected picked-row' : ''}`}
        onClick={() => pick(id)}
        title={out ? (ps.ejected ? 'Ejected' : 'Fouled out') : onChange ? 'Click to swap' : undefined}
      >
        <td className="left">
          <span className="player-cell">
            <Portrait player={p} side={side} size={24} />
            <ShirtNumber player={p} side={side} />
            <span className="brk-name">{p.name}</span>
          </span>
        </td>
        <td className="left muted">{p.position}</td>
        <td title="Overall rating">{Math.round(composite(p).overall)}</td>
        <td>
          <RatingBadge r={playerRating(s)} />
        </td>
        <td>{Math.round(s.seconds / 60)}</td>
        <td>
          <b>{s.pts}</b>
        </td>
        <td>{s.oreb + s.dreb}</td>
        <td>{s.ast}</td>
        <td title={pct(s.fgm, s.fga)}>
          {s.fgm}/{s.fga}
        </td>
        <td title={pct(s.tpm, s.tpa)}>
          {s.tpm}/{s.tpa}
        </td>
        <td className={ps.fouls >= 5 || ps.technicals > 0 ? 'bad' : ''}>
          {ps.ejected ? 'EJ' : out ? 'OUT' : ps.fouls}
          {!out && ps.technicals > 0 ? ' T' : ''}
        </td>
        <td>
          <EnergyBar energy={ps.energy} width={46} />
        </td>
        {onChange && (
          <td onClick={(e) => e.stopPropagation()} className="brk-order">
            {!onCourt && (
              <>
                <span className="muted small">{benchIndex + 1}</span>
                <button className="tiny" onClick={() => move(id, -1)} title="Comes in earlier">
                  ↑
                </button>
                <button className="tiny" onClick={() => move(id, 1)} title="Comes in later">
                  ↓
                </button>
              </>
            )}
          </td>
        )}
      </tr>
    );
  };

  return (
    <div className="brk-roster" style={{ ['--team' as string]: side === 0 ? 'var(--home)' : 'var(--away)' }}>
      <div className="brk-roster-head">
        <b>{t.team.name}</b>
        <span className="muted small">
          {onChange ? (picked ? `${byId.get(picked)?.name} picked: now click who swaps with him.` : 'Click a player on court, then one on the bench, to swap.') : 'Their players'}
        </span>
      </div>
      <table className="brk-table">
        <thead>
          <tr>
            <th className="left">Player</th>
            <th className="left">Pos</th>
            <th title="Overall rating">OVR</th>
            <th title="Match rating so far">RTG</th>
            <th title="Minutes">MIN</th>
            <th>PTS</th>
            <th>REB</th>
            <th>AST</th>
            <th title="Field goals made/attempted">FG</th>
            <th title="Three-pointers made/attempted">3P</th>
            <th title="Personal fouls (6 = out); T = a technical">PF</th>
            <th title="Energy: tired players play worse">Energy</th>
            {onChange && <th title="Who comes off the bench first">Sub</th>}
          </tr>
        </thead>
        <tbody>
          {plan.starters.map((id) => row(id, true))}
          <tr className="brk-divider">
            <td colSpan={13} />
          </tr>
          {bench.map((id, i) => row(id, false, i))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The plan, compact: the assistant's advice on top (what he would play, why, and what he has seen in
 * this game), then attack, defence and tempo as rows of choices; each option explains itself on hover.
 */
function Tactics({ m, side, plan, onChange }: { m: LiveMatch; side: Side; plan: GamePlan; onChange: (p: GamePlan) => void }) {
  const team = m.s.teams[side].team;
  const opponent = m.s.teams[other(side)].team;
  const suggestion = suggestPlan(team, opponent);
  const follows = plan.offence === suggestion.offence && plan.defence === suggestion.defence && plan.tempo === suggestion.tempo;
  const seen = m.tips.filter((t) => t.side === side).slice(0, 2);
  const set = (patch: Partial<GamePlan>) => onChange({ ...plan, ...patch });
  const km = plan.keyMatchup;
  const oppSorted = [...opponent.players].sort((a, b) => composite(b).overall - composite(a).overall);
  const setKm = (k: KeyMatchup) => set({ keyMatchup: k });
  return (
    <div className="brk-tactics">
      <div className="brk-advice">
        <div className="row">
          <b>🧑‍🏫 Assistant coach:</b>
          <span>
            {follows ? 'Stick with it: ' : 'I would go '}
            <b>
              {OFFENCE_INFO[suggestion.offence].icon} {OFFENCE_INFO[suggestion.offence].label} · {DEFENCE_INFO[suggestion.defence].icon} {DEFENCE_INFO[suggestion.defence].label} ·{' '}
              {TEMPO_INFO[suggestion.tempo].icon} {TEMPO_INFO[suggestion.tempo].label}
            </b>
          </span>
          <div className="spacer" />
          <button className="small" disabled={follows} onClick={() => set({ offence: suggestion.offence, defence: suggestion.defence, tempo: suggestion.tempo })}>
            {follows ? 'Using it ✓' : 'Use this'}
          </button>
        </div>
        <div className="small">
          {suggestion.reasons.join(' ')}
          {seen.length > 0 && <span className="brk-seen"> In this game: {seen.map((t) => t.text).join(' ')}</span>}
        </div>
      </div>
      {m.phase === 'break' && m.breakQuarter === 2 && <TeamTalk m={m} side={side} />}
      <div className="brk-choices">
        <Choice label="Attack" options={OFFENSIVE_FOCI} info={OFFENCE_INFO} value={plan.offence} onPick={(offence) => set({ offence })} />
        <Choice label="Defence" options={DEFENCE_SCHEMES} info={DEFENCE_INFO} value={plan.defence} onPick={(defence) => set({ defence })} />
        <Choice label="Tempo" options={TEMPOS} info={TEMPO_INFO} value={plan.tempo} onPick={(tempo) => set({ tempo })} />
        <div className="brk-choice">
          <span className="brk-choice-label">Matchup</span>
          <select
            value={km.kind}
            onChange={(e) => {
              const kind = e.target.value as KeyMatchup['kind'];
              if (kind === 'none') setKm({ kind: 'none' });
              else if (kind === 'double') setKm({ kind: 'double', targetId: oppSorted[0].id });
              else setKm({ kind: 'assign', targetId: oppSorted[0].id, defenderId: plan.starters[0] ?? team.players[0].id });
            }}
          >
            <option value="none">Normal matchups</option>
            <option value="double">Double-team their…</option>
            <option value="assign">Put our best stopper on…</option>
          </select>
          {km.kind !== 'none' && (
            <select value={km.targetId} onChange={(e) => setKm({ ...km, targetId: e.target.value })}>
              {oppSorted.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.number} {p.name}
                </option>
              ))}
            </select>
          )}
          {km.kind === 'assign' && (
            <select value={km.defenderId} onChange={(e) => setKm({ ...km, defenderId: e.target.value })}>
              {team.players.map((p) => (
                <option key={p.id} value={p.id}>
                  with #{p.number} {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
}

/** One row of choices; the chosen one's strengths and weaknesses in a line underneath. */
function Choice<K extends string>({ label, options, info, value, onPick }: { label: string; options: readonly K[]; info: Record<K, OptionInfo>; value: K; onPick: (k: K) => void }) {
  const sel = info[value];
  return (
    <div className="brk-choice">
      <span className="brk-choice-label">{label}</span>
      <div className="brk-chips">
        {options.map((o) => (
          <button key={o} className={`chip ${value === o ? 'active' : ''}`} onClick={() => onPick(o)} title={`${info[o].blurb}\nGood when: ${info[o].good}\nWeak against: ${info[o].weak}`}>
            {info[o].icon} {info[o].label}
          </button>
        ))}
      </div>
      <span className="brk-choice-why small">
        <span className="good">✔</span> {sel.good} <span className="bad">✘</span> {sel.weak}
      </span>
    </div>
  );
}

/** Halftime: what the coach tells his players. */
function TeamTalk({ m, side }: { m: LiveMatch; side: Side }) {
  const given = m.talks[side];
  const margin = m.s.teams[side].score - m.s.teams[other(side)].score;
  return (
    <div className="brk-talk">
      <b>Team talk {margin > 0 ? `(up ${margin})` : margin < 0 ? `(down ${-margin})` : '(tied)'}:</b>
      {given ? (
        <span>
          {TALKS.find((t) => t.talk === given.talk)?.icon} {TALKS.find((t) => t.talk === given.talk)?.label}: {given.reaction}
        </span>
      ) : (
        <span className="brk-chips">
          {TALKS.map((t) => (
            <button key={t.talk} className="chip" title={t.line} onClick={() => m.teamTalk(side, t.talk)}>
              {t.icon} {t.label}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
