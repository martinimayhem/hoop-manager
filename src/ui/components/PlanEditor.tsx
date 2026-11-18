// Edits a game plan: who's on court, sub order, offence, defence, tempo and (advanced) the key matchup.
// Used before the match (starting five) and during timeouts/breaks (the five on court now).

import { useState } from 'react';
import { composite } from '../../engine/ratings';
import { DEFENCE_SCHEMES, OFFENSIVE_FOCI, TEMPOS, AGGRESSIONS, type GamePlan, type KeyMatchup, type Side, type Team } from '../../engine/types';
import { suggestPlan } from '../../game/ai';
import type { TeamView } from '../match/controller';
import { AGGRESSION_INFO, DEFENCE_INFO, OFFENCE_INFO, TEMPO_INFO, type OptionInfo } from '../labels';
import { EnergyBar, Rating } from './common';
import { Portrait, ShirtNumber } from './Portrait';
import { useSort } from './sortable';
import { CheckIcon, CrossIcon, Icon } from '../icons';

interface Props {
  team: Team;
  opponent: Team;
  plan: GamePlan;
  onChange: (plan: GamePlan) => void;
  /** Which kit the portraits wear. */
  side?: Side;
  /** Live numbers during a match. */
  live?: TeamView;
}

const COLUMNS = [
  { key: 'overall', label: 'OVR', tip: 'Overall rating (what the market thinks)' },
  { key: 'three', label: '3PT', tip: 'Three-point shooting' },
  { key: 'insideScoring', label: 'Inside', tip: 'Scoring near the basket (size + finishing)' },
  { key: 'playmaking', label: 'Pass', tip: 'Passing and ball handling' },
  { key: 'perimeterD', label: 'Guard', tip: 'Perimeter defence: staying in front of guards and wings' },
  { key: 'rimProtection', label: 'Rim D', tip: 'Protecting the basket: blocks and contesting inside shots' },
  { key: 'rebounding', label: 'Boards', tip: 'Rebounding' },
] as const;

export function PlanEditor({ team, opponent, plan, onChange, live, side, section = 'all' }: Props & { /** Which part to show: the tactics, the rotation (starting five, bench, key matchup), or both. */ section?: 'tactics' | 'rotation' | 'matchup' | 'all' }) {
  // Which choice the explanation box describes: the one picked last.
  const [focus, setFocus] = useState<Focus>('offence');
  const byId = new Map(team.players.map((p) => [p.id, p]));
  const bench = [...plan.bench, ...team.players.map((p) => p.id).filter((id) => !plan.starters.includes(id) && !plan.bench.includes(id))];
  const set = (patch: Partial<GamePlan>) => onChange({ ...plan, ...patch });
  const suggestion = suggestPlan(team, opponent);
  // Sorting reorders the starters and the bench each among themselves; the sub order stays.
  const sorter = useSort<string>((id, key) => {
    const p = byId.get(id)!;
    const lv = live?.players[id];
    if (key === 'name') return p.name;
    if (key === 'pos') return -['PG', 'SG', 'SF', 'PF', 'C'].indexOf(p.position);
    if (key === 'speed') return p.attrs.speed;
    if (key === 'energy') return lv?.energy;
    if (key === 'min') return lv?.seconds;
    if (key === 'fouls') return lv ? (lv.fouledOut ? 99 : lv.fouls) : null;
    if (key === 'pts') return lv?.pts;
    const col = COLUMNS.find((c) => c.key === key);
    return col ? composite(p)[col.key] : null;
  });
  const followsSuggestion = plan.offence === suggestion.offence && plan.defence === suggestion.defence && plan.tempo === suggestion.tempo && (plan.aggression ?? 'normal') === suggestion.aggression;
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
          <span className="player-cell">
            <Portrait player={p} side={side} size={24} />
            <ShirtNumber player={p} side={side} />
            <span className="brk-name" title={p.archetype}>
              {p.name}
            </span>
          </span>
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
              <button className="small" onClick={() => moveBench(id, -1)} title="Comes in earlier" aria-label="Comes in earlier">
                <Icon name="up" />
              </button>
              <button className="small" onClick={() => moveBench(id, 1)} title="Comes in later" aria-label="Comes in later">
                <Icon name="down" />
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

  const focusInfo =
    focus === 'offence' ? OFFENCE_INFO[plan.offence] : focus === 'defence' ? DEFENCE_INFO[plan.defence] : focus === 'tempo' ? TEMPO_INFO[plan.tempo] : AGGRESSION_INFO[plan.aggression ?? 'normal'];
  const tactics = section === 'tactics' || section === 'all';
  const rotation = section === 'rotation' || section === 'all';
  const matchup = section === 'matchup' || section === 'all';
  return (
    <div className="plan-editor">
      {tactics && (<>
      <div className="suggest">
        <div className="row">
          <b>
            <Icon name="lightbulb" /> Assistant suggests:
          </b>
          <span>
            <Icon name={OFFENCE_INFO[suggestion.offence].icon} /> {OFFENCE_INFO[suggestion.offence].label} · <Icon name={DEFENCE_INFO[suggestion.defence].icon} />{' '}
            {DEFENCE_INFO[suggestion.defence].label} · <Icon name={TEMPO_INFO[suggestion.tempo].icon} /> {TEMPO_INFO[suggestion.tempo].label} · <Icon name={AGGRESSION_INFO[suggestion.aggression].icon} /> {AGGRESSION_INFO[suggestion.aggression].label} intensity
          </span>
          <div className="spacer" />
          <button
            className="small"
            disabled={followsSuggestion}
            onClick={() => set({ offence: suggestion.offence, defence: suggestion.defence, tempo: suggestion.tempo, aggression: suggestion.aggression })}
          >
            {followsSuggestion ? (
              <>
                Using it <CheckIcon />
              </>
            ) : (
              'Use this'
            )}
          </button>
        </div>
        <div className="muted small">{suggestion.reasons.join(' · ')}</div>
      </div>

      <OptionPicker title="Attack: how do we score?" options={OFFENSIVE_FOCI} info={OFFENCE_INFO} value={plan.offence} onPick={(offence) => (set({ offence }), setFocus('offence'))} />
      <OptionPicker title="Defence: how do we stop them?" options={DEFENCE_SCHEMES} info={DEFENCE_INFO} value={plan.defence} onPick={(defence) => (set({ defence }), setFocus('defence'))} />
      <OptionPicker title="Tempo: how fast do we play?" options={TEMPOS} info={TEMPO_INFO} value={plan.tempo} onPick={(tempo) => (set({ tempo }), setFocus('tempo'))} />
      <OptionPicker
        title="Defensive intensity: how hard do we play them?"
        options={AGGRESSIONS}
        info={AGGRESSION_INFO}
        value={plan.aggression ?? 'normal'}
        onPick={(aggression) => (set({ aggression }), setFocus('aggression'))}
      />
      <Explain info={focusInfo} title={FOCUS_TITLE[focus]} />
      </>)}

      {rotation && (<>
      <div>
        <h3 className="rot-title">{live ? 'Players on court' : 'Starting five'} &amp; bench</h3>
        <div className={`swap-hint ${picked ? 'active' : ''}`}>
          {picked
            ? `${pickedName} selected: now click a ${pickedOnCourt ? 'bench player to bring in' : 'player on court to take off'}.`
            : 'To swap: pick a player on court, then a bench player. Tired players and players in foul trouble are swapped automatically, in sub order.'}
        </div>
        <div>
          <table className="brk-table eq">
            <thead>
              <tr>
                {sorter.th('name', 'Player', { left: true, wide: true })}
                {sorter.th('pos', 'Pos', { tip: 'Position' })}
                {COLUMNS.map((c) => sorter.th(c.key, c.label, { tip: c.tip }))}
                {sorter.th('speed', 'Speed', { tip: 'Speed' })}
                {live && sorter.th('energy', 'Energy', { tip: 'Energy: tired players play worse' })}
                {live && sorter.th('min', 'Min', { tip: 'Minutes played' })}
                {live && sorter.th('fouls', 'Fouls', { tip: 'Personal fouls (6 = out)' })}
                {live && sorter.th('pts', 'Pts', { tip: 'Points' })}
                {sorter.th('sub', 'Sub', { tip: 'Sub order: who comes off the bench first', plain: true, width: 84 })}
              </tr>
            </thead>
            <tbody>
              <tr className="group-row">
                <td colSpan={COLUMNS.length + (live ? 8 : 4)}>{live ? 'ON COURT' : 'STARTERS'}</td>
              </tr>
              {sorter.sorted(plan.starters).map((id) => row(id, true))}
              <tr className="group-row">
                <td colSpan={COLUMNS.length + (live ? 8 : 4)}>BENCH</td>
              </tr>
              {sorter.sorted(bench).map((id) => row(id, false, bench.indexOf(id)))}
            </tbody>
          </table>
        </div>
      </div>
      </>)}

      {matchup && (<>

      <div className="key-matchup">
        <h3>Key matchup (optional)</h3>
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
      </div>
      </>)}
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
  return (
    <div>
      <h3>{title}</h3>
      <div className="cards">
        {options.map((o) => (
          <button key={o} className={`card ${value === o ? 'active' : ''}`} onClick={() => onPick(o)} title={info[o].blurb}>
            <span className="icon"><Icon name={info[o].icon} /></span>
            {info[o].label}
          </button>
        ))}
      </div>
    </div>
  );
}

type Focus = 'offence' | 'defence' | 'tempo' | 'aggression';
const FOCUS_TITLE: Record<Focus, string> = { offence: 'Attack', defence: 'Defence', tempo: 'Tempo', aggression: 'Intensity' };

/** What the option last picked does: one box for all four choices, so the plan fits one screen. */
function Explain({ info, title }: { info: OptionInfo; title: string }) {
  return (
    <div className="explain">
      <div>
        <b>
          {title}: {info.label}.
        </b>{' '}
        {info.blurb}
      </div>
      <div>
        <span className="good">
          <CheckIcon /> Good when:
        </span>{' '}
        {info.good}
      </div>
      <div>
        <span className="bad">
          <CrossIcon /> Weak against:
        </span>{' '}
        {info.weak}
      </div>
    </div>
  );
}