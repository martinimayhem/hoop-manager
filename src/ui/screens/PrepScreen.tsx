// Pre-match: you set your game plan while studying the scouting report on the computer's team.

import { useEffect, useMemo, useState } from 'react';
import { makePlan } from '../../engine/match';
import { createRng } from '../../engine/rng';
import type { GamePlan, Side, Team } from '../../engine/types';
import { aiGamePlan } from '../../game/ai';
import { PlanEditor } from '../components/PlanEditor';
import { ScoutingReport, type ScoutView } from '../components/ScoutingReport';
import { NextIcon, MenuIcon } from '../icons';

export function PrepScreen({
  teams,
  onReady,
  onMenu,
  scout,
}: {
  teams: [Team, Team];
  onReady: (plans: [GamePlan, GamePlan]) => void;
  onMenu: () => void;
  /** In a league: how well each side knows the other (by side). */
  scout?: [ScoutView, ScoutView];
}) {
  const humans: Side[] = [0];
  const initial = useMemo<[GamePlan, GamePlan]>(() => {
    const rng = createRng(Date.now() >>> 0);
    return [
      makePlan(teams[0]),
      aiGamePlan(teams[1], teams[0], rng),
    ];
  }, [teams]);
  const [plans, setPlans] = useState<[GamePlan, GamePlan]>(initial);
  const [step, setStep] = useState(0);
  const [handover, setHandover] = useState(false);
  const [left, setLeft] = useState<PrepTab>('tactics');
  const [right, setRight] = useState<PrepTab>('players');
  const narrow = useNarrow(1100);

  const side = humans[step];
  const team = teams[side];
  const opponent = teams[side === 0 ? 1 : 0];

  if (handover) {
    return (
      <div className="handover panel">
        <h1 className={side === 0 ? 'home' : 'away'}>{team.name}</h1>
        <p>
          Your turn to set the game plan. {humans.length > 1 && <b>{teams[side === 0 ? 1 : 0].name}: no peeking!</b>}
        </p>
        <button className="primary" onClick={() => setHandover(false)}>
          I'm ready
        </button>
      </div>
    );
  }

  const confirm = () => {
    if (step + 1 < humans.length) {
      setStep(step + 1);
      setHandover(true);
    } else {
      onReady(plans);
    }
  };

  const editor = (section: 'tactics' | 'rotation' | 'matchup') => (
    <PlanEditor team={team} opponent={opponent} plan={plans[side]} side={side} section={section} onChange={(p) => setPlans((prev) => (side === 0 ? [p, prev[1]] : [prev[0], p]))} />
  );
  const report = (section: 'players' | 'tendencies') => <ScoutingReport opponent={opponent} us={team} side={side === 0 ? 1 : 0} scout={scout?.[side]} section={section} />;
  const content: Record<PrepTab, React.ReactNode> = {
    tactics: editor('tactics'),
    rotation: editor('rotation'),
    matchup: editor('matchup'),
    players: report('players'),
    tendencies: report('tendencies'),
  };

  // Nothing scrolls (GAME_FLOW §6.1a): your plan and the scouting report side by side, each in tabs; on a
  // narrow screen one panel with all four tabs.
  return (
    <div className="prep-screen">
      <div className="row">
        <button onClick={onMenu}>
          <MenuIcon /> Menu
        </button>
        <h1 className={side === 0 ? 'home' : 'away'} style={{ margin: 0 }}>
          {team.name}: game plan
        </h1>
        <span className="muted">vs {opponent.name}</span>
        <div className="spacer" />
        <button className="primary" disabled={plans[side].starters.length !== 5} onClick={confirm}>
          {step + 1 < humans.length ? `Lock in & pass to ${teams[humans[step + 1]].name}` : 'Tip-off!'} <NextIcon />
        </button>
      </div>
      {narrow ? (
        <div className="prep">
          <TabPanel tabs={['tactics', 'rotation', 'matchup', 'players', 'tendencies']} tab={left} onTab={setLeft} content={content} opponent={opponent.name} />
        </div>
      ) : (
        <div className="prep">
          <TabPanel tabs={['tactics', 'rotation', 'matchup']} tab={left === 'players' || left === 'tendencies' ? 'tactics' : left} onTab={setLeft} content={content} opponent={opponent.name} />
          <TabPanel tabs={['players', 'tendencies']} tab={right} onTab={setRight} content={content} opponent={opponent.name} />
        </div>
      )}
    </div>
  );
}

type PrepTab = 'tactics' | 'rotation' | 'matchup' | 'players' | 'tendencies';
const TAB_LABEL: Record<PrepTab, (opponent: string) => string> = {
  tactics: () => 'Tactics',
  rotation: () => 'Starting five & bench',
  matchup: () => 'Key matchup',
  players: (o) => `Scouting: ${o}`,
  tendencies: () => 'Their likely plan',
};

function TabPanel({ tabs, tab, onTab, content, opponent }: { tabs: PrepTab[]; tab: PrepTab; onTab: (t: PrepTab) => void; content: Record<PrepTab, React.ReactNode>; opponent: string }) {
  return (
    <div className="panel prep-panel">
      <div className="prep-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => onTab(t)}>
            {TAB_LABEL[t](opponent)}
          </button>
        ))}
      </div>
      {content[tab]}
    </div>
  );
}

/** Whether the window is narrower than `px` (kept up to date). */
function useNarrow(px: number): boolean {
  const query = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}
