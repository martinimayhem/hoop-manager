// A new career (WORLD_SPEC §11): the world is built (in the background), then you choose your club:
// any club, in either region, in any division. Start at the top, or climb from Division 4.

import { useEffect, useMemo, useState } from 'react';
import { buildWorld } from '../../../game/world/build';
import { leagueLabel, leagueClubs, squad, strength, takeOver } from '../../../game/world/query';
import { browserWorldStore, listWorlds, writeWorld, type WorldSlot } from '../../../game/world/saves';
import type { Region, Tier, World } from '../../../game/world/types';
import { useConfirm } from '../../components/Confirm';
import { LeagueTable, WhereSwitch } from './LeagueTable';
import { ClubFacts, PlayerTable } from './parts';

export const store = browserWorldStore();
const REGION_KEY = 'hm.region';

function lastRegion(): Region {
  try {
    return localStorage.getItem(REGION_KEY) === 'europe' ? 'europe' : 'america';
  } catch {
    return 'america';
  }
}

export function CareerNew({ onBack, onStart }: { onBack: () => void; onStart: (w: World, slot: number) => void }) {
  const [world, setWorld] = useState<World | null>(null);
  const [failed, setFailed] = useState(false);
  const [region, setRegion] = useState<Region>(lastRegion);
  const [tier, setTier] = useState<Tier>(1);
  const [chosen, setChosen] = useState<string | null>(null);
  const [manager, setManager] = useState('');
  const [slots, setSlots] = useState<WorldSlot[] | null>(null);
  const [replace, setReplace] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    let live = true;
    buildWorld(Date.now() >>> 0).then(
      (w) => live && setWorld(w),
      () => live && setFailed(true),
    );
    listWorlds(store).then((s) => live && setSlots(s));
    return () => {
      live = false;
    };
  }, []);

  // The strongest club of the league shown, until the player picks one.
  const clubs = useMemo(() => (world ? leagueClubs(world, region, tier) : []), [world, region, tier]);
  const club = world ? (world.clubs.find((c) => c.id === chosen && c.region === region && c.tier === tier) ?? clubs[0]) : undefined;

  if (failed) return <div className="panel cw-wait">The world could not be built. Reload the page to try again.</div>;
  if (!world || !club)
    return (
      <div className="cw-wait">
        <h2>Building the world…</h2>
        <span className="muted">128 clubs, 2,800 players, 40 colleges</span>
      </div>
    );

  const empty = slots?.findIndex((s) => s.status === 'empty') ?? -1;
  const slot = empty >= 0 ? empty : replace;
  const rank = clubs.findIndex((c) => c.id === club.id) + 1;

  const start = () => {
    if (slot === null || saving) return;
    const go = async () => {
      setSaving(true);
      const mine = takeOver(world, club.id, manager.trim() || undefined);
      await writeWorld(store, slot, mine);
      onStart(mine, slot);
    };
    if (empty >= 0) return void go();
    const s = slots?.[slot];
    const what = s?.status === 'ok' ? `${s.summary.club} (season ${s.summary.season})` : 'the save';
    confirm.ask({ title: `Replace ${what}?`, body: `Your new career goes in career slot ${slot + 1}, and the career saved there is gone for good.`, confirm: 'Replace it', cancel: 'Keep it', danger: true }, () => void go());
  };

  const setR = (r: Region) => {
    setRegion(r);
    try {
      localStorage.setItem(REGION_KEY, r);
    } catch {
      /* this visit only */
    }
  };

  return (
    <div className="cw">
      {confirm.dialog}
      <header className="cw-bar">
        <button onClick={onBack}>◀ Menu</button>
        <div className="cw-title">
          <h1>New career</h1>
          <span className="muted small">Choose your club: any club, in America or Europe, in any division. Start at the top, or climb from Division 4.</span>
        </div>
        <WhereSwitch region={region} tier={tier} onRegion={setR} onTier={setTier} />
      </header>

      <div className="cw-main">
        <section className="panel cw-left">
          <h3>{leagueLabel(region, tier)}</h3>
          <LeagueTable w={world} region={region} tier={tier} selected={club.id} onOpen={setChosen} />
        </section>

        <aside className="panel cw-side cw-pick">
          <div className="cw-side-head">
            <span className="cw-dot big" style={{ background: club.colours[0], borderColor: club.colours[1] }} />
            <div>
              <h3>{club.name}</h3>
              <span className="muted small">
                {rank === 1 ? 'The strongest squad' : `${rank}${['th', 'st', 'nd', 'rd'][rank] ?? 'th'} strongest squad`} of 16 · {strength(world, club).toFixed(1)}
              </span>
            </div>
          </div>
          <ClubFacts w={world} club={club} compact />
          <PlayerTable w={world} players={squad(world, club)} onSelect={() => undefined} showWage={false} />
          <label className="cp-name">
            <span>Your name (manager)</span>
            <input value={manager} maxLength={24} placeholder="optional" onChange={(e) => setManager(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && start()} />
          </label>
          {slots && empty < 0 && (
            <div className="cp-replace">
              <span className="muted small">All three career slots are in use. Save over:</span>
              {slots.map((s) => (
                <button key={s.slot} className={`small ${replace === s.slot ? 'active' : ''}`} onClick={() => setReplace(s.slot)}>
                  Slot {s.slot + 1}
                  {s.status === 'ok' ? ` · ${s.summary.club}` : ''}
                </button>
              ))}
            </div>
          )}
          <button className="primary big" disabled={slot === null || saving || !slots} onClick={start}>
            Manage {club.name} ▶
          </button>
        </aside>
      </div>
    </div>
  );
}
