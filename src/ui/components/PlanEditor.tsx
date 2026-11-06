// Edits a game plan: who's on court, sub order, offence, defence, tempo and (advanced) the key matchup.
// Used before the match (starting five) and during timeouts/breaks (the five on court now).

import { useState } from 'react';
import { composite } from '../../engine/ratings';
import { DEFENCE_SCHEMES, OFFENSIVE_FOCI, TEMPOS, type GamePlan, type KeyMatchup, type Team } from '../../engine/types';
import { suggestPlan } from '../../game/ai';
import type { TeamView } from '../match/controller';
import { DEFENCE_INFO, OFFENCE_INFO, TEMPO_INFO, type OptionInfo } from '../labels';
import { EnergyBar, Rating } from './common';

interface Props {
  team: Team;
  opponent: Team;
  plan: GamePlan;
  onChange: (plan: GamePlan) => void;
  /** Live numbers during a match. */
  live?: TeamView;
}

const COLUMNS = [
  { key: 'overall', label: 'Overall', tip: 'Overall rating (what the market thinks)' },
  { key: 'three', label: '3-pt', tip: 'Three-point shooting' },
  { key: 'insideScoring', label: 'Inside', tip: 'Scoring near the basket (size + finishing)' },
  { key: 'playmaking', label: 'Passing', tip: 'Passing and ball handling' },
  { key: 'perimeterD', label: 'Guarding', tip: 'Perimeter defence: staying in front of guards and wings' },
  { key: 'rimProtection', label: 'Rim D', tip: 'Protecting the basket: blocks and contesting inside shots' },
  { key: 'rebounding', label: 'Boards', tip: 'Rebounding' },
] as const;

export function PlanEditor({ team, opponent, plan, onChange, live }: Props) {
  const byId = new Map(team.players.map((p) => [p.id, p]));
  const bench = [...plan.bench, ...team.players.map((p) => p.id).filter((id) => !plan.starters.includes(id) && !plan.bench.includes(id))];
  const set = (patch: Partial<GamePlan>) => onChange({ ...plan, ...patch });
  const suggestion = suggestPlan(team, opponent);
  const followsSuggestion = plan.offence === suggestion.offence && plan.defence === suggestion.defence && plan.tempo === suggestion.tempo;
  const [picked, setPicked] = useState<string | null>(null);

  /** Click one player on court and one on the bench: they swap places (rows never jump around). */
  const pickPlayer = (id: string) => {
    if (live?.players[id]?.fouledOut) return;
    if (!picked || picked === id) {
      setPicked(picked === id ? null : id);
      return;
    }
    const pickedOn = plan.starters.includes(picked);
    if (pickedOn === plan.starters.includes(id)) {
      setPicked(id);
      return;
    }
    const [onId, offId] = pickedOn ? [picked, id] : [id, picked];
    set({
      starters: plan.starters.map((x) => (x === onId ? offId : x)),
      bench: bench.map((x) => (x === offId ? onId : x)),
    });
    setPicked(null);
  };

  const moveBench = (id: string, delta: number) => {
    const order = [...bench];
    const i = order.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    set({ bench: order });
  };

  const pickedName = picked ? byId.get(picked)?.name : null;
  const pickedOnCourt = picked ? plan.starters.includes(picked) : false;

  const row = (id: string, onCourt: boolean, benchIndex = 0) => {
    const p = byId.get(id)!;
    const c = composite(p);
    const lv = live?.players[id];
    const out = lv?.fouledOut ?? false;
    return (
      <tr
        key={id}
        className={`clickable ${out ? 'taken' : ''} ${onCourt ? 'starter' : ''} ${picked === id ? 'selected picked-row' : ''}`}
        onClick={() => pickPlayer(id)}
        title={out ? 'Fouled out' : 'Click to swap'}
      >
        <td className="left">
          <b>#{p.number}</b> {p.name} <span className="tag">{p.archetype}</span>
        </td>
        <td className="left">{p.position}</td>
        {COLUMNS.map((col) => (
          <td key={col.key}>
            <Rating v={c[col.key]} />
          </td>
        ))}
        <td>
          <Rating v={p.attrs.speed} />
        </td>
        {lv && (
          <td>
            <EnergyBar energy={lv.energy} />
          </td>
        )}
        {lv && <td>{Math.round(lv.seconds / 60)}</td>}
        {lv && <td className={lv.fouls >= 5 ? 'bad' : ''}>{out ? 'OUT' : lv.fouls}</td>}
        {lv && <td>{lv.pts}</td>}
        <td onClick={(e) => e.stopPropagation()}>
          {!onCourt && (
            <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
              <span className="muted small">{benchIndex + 1}.</span>
              <button className="small" onClick={() => moveBench(id, -1)} title="Comes in earlier">
                ↑
              </button>
              <button className="small" onClick={() => moveBench(id, 1)} title="Comes in later">
                ↓
              </button>
            </span>
          )}
        </td>
      </tr>
    );
  };

  const km = plan.keyMatchup;
  const oppSorted = [...opponent.players].sort((a, b) => composite(b).overall - composite(a).overall);
  const setKm = (k: KeyMatchup) => set({ keyMatchup: k });

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="suggest">
        <div className="row">
          <b>🧑‍🏫 Assistant suggests:</b>
          <span>
            {OFFENCE_INFO[suggestion.offence].icon} {OFFENCE_INFO[suggestion.offence].label} · {DEFENCE_INFO[suggestion.defence].icon}{' '}
            {DEFENCE_INFO[suggestion.defence].label} · {TEMPO_INFO[suggestion.tempo].icon} {TEMPO_INFO[suggestion.tempo].label}
          </span>
          <div className="spacer" />
          <button
            className="small"
            disabled={followsSuggestion}
            onClick={() => set({ offence: suggestion.offence, defence: suggestion.defence, tempo: suggestion.tempo })}
          >
            {followsSuggestion ? 'Using it ✓' : 'Use this'}
          </button>
        </div>
        <ul>
          {suggestion.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>

      <OptionPicker title="Attack: how do we score?" options={OFFENSIVE_FOCI} info={OFFENCE_INFO} value={plan.offence} onPick={(offence) => set({ offence })} />
      <OptionPicker title="Defence: how do we stop them?" options={DEFENCE_SCHEMES} info={DEFENCE_INFO} value={plan.defence} onPick={(defence) => set({ defence })} />
      <OptionPicker title="Tempo: how fast do we play?" options={TEMPOS} info={TEMPO_INFO} value={plan.tempo} onPick={(tempo) => set({ tempo })} />

      <div>
        <h3>{live ? 'Players on court' : 'Starting five'} &amp; bench</h3>
        <div className={`swap-hint ${picked ? 'active' : ''}`}>
          {picked
            ? `${pickedName} selected: now click a ${pickedOnCourt ? 'bench player to bring in' : 'player on court to take off'}.`
            : 'To swap: click a player on court, then a bench player.'}
        </div>
        <div className="scroll" style={{ maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th className="left">Player</th>
                <th className="left">Pos</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} title={c.tip}>
                    {c.label}
                  </th>
                ))}
                <th title="Speed">Speed</th>
                {live && <th title="Energy: tired players play worse">Energy</th>}
                {live && <th title="Minutes played">Min</th>}
                {live && <th title="Personal fouls (6 = out)">Fouls</th>}
                {live && <th>Pts</th>}
                <th title="Who comes off the bench first">Sub order</th>
              </tr>
            </thead>
            <tbody>
              <tr className="group-row">
                <td colSpan={20}>{live ? 'ON COURT' : 'STARTERS'}</td>
              </tr>
              {plan.starters.map((id) => row(id, true))}
              <tr className="group-row">
                <td colSpan={20}>BENCH</td>
              </tr>
              {bench.map((id, i) => row(id, false, i))}
            </tbody>
          </table>
        </div>
        <div className="muted small">
          Ratings: green = strong, red = weak. Hover a column header for what it means. Tired players and players in foul trouble are swapped automatically, in
          sub order.
        </div>
      </div>

      <details>
        <summary>
          <b>Advanced: key matchup</b> <span className="muted small">(optional) {km.kind === 'double' ? '· doubling their star' : km.kind === 'assign' ? '· stopper assigned' : ''}</span>
        </summary>
        <div className="row wrap" style={{ marginTop: 8 }}>
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
                  #{p.number} {p.name} ({p.position})
                </option>
              ))}
            </select>
          )}
          {km.kind === 'assign' && (
            <>
              <span className="muted">with</span>
              <select value={km.defenderId} onChange={(e) => setKm({ ...km, defenderId: e.target.value })}>
                {team.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    #{p.number} {p.name} (Guarding {Math.round(composite(p).perimeterD)})
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="blurb">
          {km.kind === 'double'
            ? 'Two defenders swarm their star: the star scores less, but their open teammates get better shots and more rebounds.'
            : km.kind === 'assign'
              ? 'Your chosen defender follows their player everywhere (man-to-man only; a zone ignores it).'
              : 'Everyone guards the player in the same position.'}
        </div>
      </details>
    </div>
  );
}

function OptionPicker<K extends string>({
  title,
  options,
  info,
  value,
  onPick,
}: {
  title: string;
  options: readonly K[];
  info: Record<K, OptionInfo>;
  value: K;
  onPick: (k: K) => void;
}) {
  const sel = info[value];
  return (
    <div>
      <h3>{title}</h3>
      <div className="cards">
        {options.map((o) => (
          <button key={o} className={`card ${value === o ? 'active' : ''}`} onClick={() => onPick(o)} title={info[o].blurb}>
            <span className="icon">{info[o].icon}</span>
            {info[o].label}
          </button>
        ))}
      </div>
      <div className="explain">
        <div>{sel.blurb}</div>
        <div>
          <span className="good">✔ Good when:</span> {sel.good}
        </div>
        <div>
          <span className="bad">✘ Weak against:</span> {sel.weak}
        </div>
      </div>
    </div>
  );
}
