// Pre-match: each human sets a game plan while studying the scouting report.
// In hot-seat mode the screen hands over between players so plans stay secret.

import { useMemo, useState } from 'react';
import { makePlan } from '../../engine/match';
import { createRng } from '../../engine/rng';
import type { GamePlan, Side, Team } from '../../engine/types';
import { aiGamePlan } from '../../game/ai';
import type { Setup } from '../App';
import { PlanEditor } from '../components/PlanEditor';
import { ScoutingReport } from '../components/ScoutingReport';

export function PrepScreen({ setup, teams, onReady, onMenu }: { setup: Setup; teams: [Team, Team]; onReady: (plans: [GamePlan, GamePlan]) => void; onMenu: () => void }) {
  const humans: Side[] = setup.mode === 'ai' ? [0] : [0, 1];
  const initial = useMemo<[GamePlan, GamePlan]>(() => {
    const rng = createRng(Date.now() >>> 0);
    return [
      makePlan(teams[0]),
      setup.mode === 'ai' ? aiGamePlan(teams[1], teams[0], rng) : makePlan(teams[1]),
    ];
  }, [teams, setup.mode]);
  const [plans, setPlans] = useState<[GamePlan, GamePlan]>(initial);
  const [step, setStep] = useState(0);
  const [handover, setHandover] = useState(setup.mode === 'pvp');

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

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <button onClick={onMenu}>☰ Menu</button>
        <h1 className={side === 0 ? 'home' : 'away'} style={{ margin: 0 }}>
          {team.name}: game plan
        </h1>
        <span className="muted">vs {opponent.name}</span>
        <div className="spacer" />
        <button className="primary" disabled={plans[side].starters.length !== 5} onClick={confirm}>
          {step + 1 < humans.length ? `Lock in & pass to ${teams[humans[step + 1]].name} ▶` : 'Tip-off! ▶'}
        </button>
      </div>
      <div className="prep">
        <div className="panel">
          <PlanEditor
            team={team}
            opponent={opponent}
            plan={plans[side]}
            side={side}
            onChange={(p) => setPlans((prev) => (side === 0 ? [p, prev[1]] : [prev[0], p]))}
          />
        </div>
        <div className="panel">
          <ScoutingReport opponent={opponent} us={team} side={side === 0 ? 1 : 0} />
        </div>
      </div>
    </div>
  );
}
