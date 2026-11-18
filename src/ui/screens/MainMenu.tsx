// The main menu: carry on where you left off, or start a new game by choosing the league to start in
// (then, on the next screen, the club). Saved games and a friendly match are a click away; the court
// view and match speed below hold for every match.

import { useEffect, useState } from 'react';
import { listWorlds, type WorldSlot } from '../../game/world/saves';
import type { World } from '../../game/world/types';
import { careerStore } from './career/store';
import type { Speed } from '../match/controller';
import type { Setup } from '../App';
import { LEAGUES, type LeagueId } from '../../game/league/leagues';
import type { QuickLeague } from '../../game/league/quickLeague';
import { listSlots, summarise } from '../../game/league/saves';
import { browserStorage } from './league/storage';
import { NextIcon } from '../icons';

/** Where the court view choice is remembered in this browser (shared with the match screen's toggle). */
export const VIEW_3D_KEY = 'hm.view3d';
/** And the match speed. */
export const SPEED_KEY = 'hm.speed';

/** The view to start with: ?view=3d or ?view=2d in the address, else the last one used, else 2D. */
function startView(): Setup['view'] {
  const asked = new URLSearchParams(window.location.search).get('view');
  if (asked === '3d' || asked === '2d') return asked;
  try {
    return localStorage.getItem(VIEW_3D_KEY) === '1' ? '3d' : '2d';
  } catch {
    return '2d';
  }
}

/** The match speed last chosen, else Normal. */
export function lastSpeed(): Speed {
  try {
    return localStorage.getItem(SPEED_KEY) === 'fast' ? 'fast' : 'normal';
  } catch {
    return 'normal';
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice holds for this visit only.
  }
}

const LEAGUE_IDS = Object.keys(LEAGUES) as LeagueId[];
const LEVEL: Record<LeagueId, string> = { street: 'Level 3 · start at the bottom', pro: 'Level 2 · the middle', legends: 'Level 1 · the top' };

export function MainMenu({
  onFriendly,
  onLeague,
  onLoad,
  onContinue,
  onCareerNew,
  onCareerOpen,
}: {
  /** A friendly: the ready-made squads, no league. */
  onFriendly: (setup: Setup) => void;
  /** A new game in this league: on to choosing the club. */
  onLeague: (league: LeagueId) => void;
  onLoad: () => void;
  onContinue: (league: QuickLeague, slot: number) => void;
  /** A new career: create the world, choose the club. */
  onCareerNew: () => void;
  onCareerOpen: (world: World, slot: number) => void;
}) {
  const [speed, setSpeedState] = useState<Speed>(lastSpeed);
  const [view, setViewState] = useState<Setup['view']>(startView);
  const setSpeed = (s: Speed) => {
    setSpeedState(s);
    remember(SPEED_KEY, s);
  };
  const setView = (v: Setup['view']) => {
    setViewState(v);
    remember(VIEW_3D_KEY, v === '3d' ? '1' : '0');
  };

  const [slots] = useState(() => listSlots(browserStorage));
  const saves = slots.flatMap((s) => (s.status === 'ok' ? [s] : []));
  // The most recently saved game, to carry on with.
  const latest = [...saves].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))[0];
  // Careers are saved in IndexedDB (they are big): read once the menu is up.
  const [careers, setCareers] = useState<WorldSlot[]>([]);
  useEffect(() => {
    let live = true;
    listWorlds(careerStore).then((s) => live && setCareers(s));
    return () => {
      live = false;
    };
  }, []);
  const used = careers.filter((s) => s.status !== 'empty');

  return (
    <div className="menu mm">
      <div>
        <div className="title">
          Hoop <span>Manager</span>
        </div>
        <div className="muted">Take over a club, scout the opponent, set your tactics, and out-coach the other bench.</div>
      </div>

      <div className="mm-cols">
      <div className="mm-col">
      {latest &&
        (() => {
          const x = summarise(latest.data);
          return (
            <section className="panel mm-continue">
              <div>
                <div className="mm-kicker">Continue</div>
                <div className="mm-club">{x.club}</div>
                <div className="muted">
                  {x.league}
                  {x.manager ? ` · manager ${x.manager}` : ''} · {x.progress}
                </div>
              </div>
              <button className="primary big" onClick={() => onContinue(latest.data, latest.slot)}>
                Continue <NextIcon />
              </button>
            </section>
          );
        })()}

      <section className="panel mm-career">
        <div className="mm-career-head">
          <div>
            <div className="mm-kicker">Career · new</div>
            <b className="mm-club">Manage a club, season after season</b>
            <div className="muted">318 clubs in America and 11 European countries. Pick any club and look around: squads, players, competitions, money. Playing the season comes next.</div>
          </div>
          <button className="primary big" onClick={onCareerNew}>
            New career <NextIcon />
          </button>
        </div>
        {used.length > 0 && (
          <div className="mm-career-slots">
            {used.map((s) =>
              s.status === 'ok' ? (
                <button key={s.slot} className="mm-career-slot" onClick={() => onCareerOpen(s.data, s.slot)}>
                  <span>
                    <b>{s.summary.club}</b>
                    <small className="muted">
                      Slot {s.slot + 1} · {s.summary.league}
                      {s.summary.manager ? ` · ${s.summary.manager}` : ''} · season {s.summary.season}–{String(s.summary.season + 1).slice(2)}
                    </small>
                  </span>
                  <span className="mm-go">
                    Continue <NextIcon />
                  </span>
                </button>
              ) : s.status === 'newer' || s.status === 'broken' ? (
                <div key={s.slot} className="mm-career-slot bad-save" role="note">
                  <span>
                    <b>Career slot {s.slot + 1} can't be opened</b>
                    <small className="muted">{s.message}</small>
                  </span>
                </div>
              ) : null,
            )}
          </div>
        )}
      </section>

      </div>
      <div className="mm-col">
      <section className="panel mm-new">
        <h3>New game · choose where to start</h3>
        <div className="mm-leagues">
          {LEAGUE_IDS.slice()
            .reverse()
            .map((id) => (
              <button key={id} className="mm-league" onClick={() => onLeague(id)}>
                <span className="mm-level">{LEVEL[id]}</span>
                <b>{LEAGUES[id].name}</b>
                <small>{LEAGUES[id].blurb}</small>
                <span className="mm-go">
                  Choose a club <NextIcon />
                </span>
              </button>
            ))}
        </div>
      </section>

      <div className="mm-links">
        <button className="mm-link" onClick={onLoad}>
          Saved games ({saves.length}) <NextIcon />
        </button>
        <button className="mm-link" onClick={() => onFriendly({ names: ['Harbor Hammers', 'Skyline Sparks'], speed, view })} title="One match, no league: Harbor Hammers (big and slow) against Skyline Sparks (small and fast).">
          Friendly match <NextIcon />
        </button>
      </div>

      <section className="panel mm-settings">
        <span className="mm-label">Court view</span>
        <span className="hub-seg">
          <button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')} title="The classic court, seen from above the corner.">
            2D
          </button>
          <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')} title="A 3D court: drag to turn it, scroll to zoom. You can switch during the match.">
            3D (beta)
          </button>
        </span>
        <span className="mm-label">Match speed</span>
        <span className="hub-seg">
          <button className={speed === 'normal' ? 'on' : ''} onClick={() => setSpeed('normal')} title="About 7.5 minutes a quarter with every possession shown">
            Normal
          </button>
          <button className={speed === 'fast' ? 'on' : ''} onClick={() => setSpeed('fast')} title="About 4 minutes a quarter with every possession shown">
            Fast
          </button>
        </span>
        <span className="muted small">Both can be changed during a match too.</span>
      </section>
      </div>
      </div>
    </div>
  );
}
