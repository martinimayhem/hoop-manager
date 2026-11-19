// The main menu: carry on where you left off, or start a new game by choosing the league to start in
// (then, on the next screen, the club). Saved games and a friendly match are a click away; the court
// view and match speed below hold for every match.

import { useEffect, useState } from 'react';
import { listWorlds, type WorldSlot } from '../../game/world/saves';
import type { World } from '../../game/world/types';
import { careerStore } from './career/store';
import { useNav } from '../nav';
import type { Speed } from '../match/controller';
import type { Setup } from '../App';
import { LEAGUES, REGIONS, REGION_NAME, type LeagueId, type Region } from '../../game/league/leagues';
import type { QuickLeague } from '../../game/league/quickLeague';
import { listSlots, summarise } from '../../game/league/saves';
import { browserStorage } from './league/storage';
import { NextIcon } from '../icons';

/** Where the court view choice is remembered in this browser (shared with the match screen's toggle). */
export const VIEW_3D_KEY = 'hm.view3d';
/** And the match speed. */
export const SPEED_KEY = 'hm.speed';

/** Where the last Quick League was started: America or Europe (their clubs never share a league). */
export const REGION_KEY = 'hm.region';
function lastRegion(): Region {
  try {
    return localStorage.getItem(REGION_KEY) === 'europe' ? 'europe' : 'america';
  } catch {
    return 'america';
  }
}

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
  onLeague: (league: LeagueId, region: Region) => void;
  onLoad: () => void;
  onContinue: (league: QuickLeague, slot: number) => void;
  /** A new career: create the world, choose the club. */
  onCareerNew: () => void;
  onCareerOpen: (world: World, slot: number) => void;
}) {
  // The court view and match speed are chosen in the match itself; it remembers them for the next one.
  const [speed] = useState<Speed>(lastSpeed);
  const [view] = useState<Setup['view']>(startView);
  const [region, setRegionState] = useState<Region>(lastRegion);
  const setRegion = (r: Region) => {
    setRegionState(r);
    remember(REGION_KEY, r);
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
  // A one-off message from the screen before ("Your career is saved"), shown for a few seconds.
  const nav = useNav();
  const [flash] = useState(nav.flash);
  useEffect(() => {
    if (nav.flash) nav.setFlash(null);
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="menu mm">
      {flash && (
        <div className="mm-flash" role="status">
          {flash}
        </div>
      )}
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
            <div className="muted">318 clubs in America and 11 European countries. Pick any club and play its season: your games live or simulated, the rest of the world around you.</div>
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
        <div className="mm-new-head">
          <h3>New game · choose where to start</h3>
          <span className="hub-seg" role="group" aria-label="Region">
            {REGIONS.map((r) => (
              <button key={r} className={region === r ? 'on' : ''} onClick={() => setRegion(r)} title={`Clubs from ${REGION_NAME[r]} only`}>
                {REGION_NAME[r]}
              </button>
            ))}
          </span>
        </div>
        <div className="mm-leagues">
          {LEAGUE_IDS.slice()
            .reverse()
            .map((id) => (
              <button key={id} className="mm-league" onClick={() => onLeague(id, region)}>
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

      <section className="panel mm-more">
        <button className="mm-career-slot" onClick={onLoad}>
          <span>
            <b>Saved games</b>
            <small className="muted">Your Quick League games ({saves.length})</small>
          </span>
          <span className="mm-go">
            Open <NextIcon />
          </span>
        </button>
        <button className="mm-career-slot" onClick={() => onFriendly({ names: ['Harbor Hammers', 'Skyline Sparks'], speed, view })}>
          <span>
            <b>Friendly match</b>
            <small className="muted">One match, no league: Harbor Hammers against Skyline Sparks</small>
          </span>
          <span className="mm-go">
            Play <NextIcon />
          </span>
        </button>
      </section>
      </div>
      </div>
    </div>
  );
}
