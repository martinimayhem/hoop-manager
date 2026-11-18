// A new career (WORLD_SPEC §11, slice brief W1 §6): the world is created (in the background worker),
// then you choose any club: filter by region and country, then competition; each club shows its
// strength, budget or payroll and its best players. Your name as manager, and the world is saved.

import { useEffect, useMemo, useState } from 'react';
import { buildWorld } from '../../../game/world/build';
import { money } from '../../../game/world/money';
import { EUROPE_COUNTRIES } from '../../../game/world/places';
import { competitionsOf, moneySummary, ordinal, squad, strength, takeOver } from '../../../game/world/query';
import { listWorlds, writeWorld, type WorldSlot } from '../../../game/world/saves';
import { REGION_NAME, REGIONS, type Competition, type Region, type World, type WorldClub } from '../../../game/world/types';
import { useConfirm } from '../../components/Confirm';
import { careerStore } from './store';
import { Badge, country, mid, overallRange, Pager, ratingTone, showRange, useFitRows } from './parts';
import './career.css';
import { BackIcon } from '../../icons';

function clubMoney(w: World, c: WorldClub): string {
  const s = moneySummary(w, c);
  return s.system === 'cap' ? `Payroll ${money(s.payroll)}` : `Budget ${money(s.budget)}`;
}

export function CareerNew({ onBack, onStart }: { onBack: () => void; onStart: (w: World, slot: number) => void }) {
  const [world, setWorld] = useState<World | null>(null);
  const [failed, setFailed] = useState(false);
  const [region, setRegion] = useState<Region>('america');
  const [nation, setNation] = useState<string>('all');
  const [compId, setCompId] = useState<string>('big-league-america');
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
    listWorlds(careerStore).then((s) => live && setSlots(s));
    return () => {
      live = false;
    };
  }, []);

  // The competitions to choose from: the region's, narrowed to one country in Europe.
  const comps = useMemo<Competition[]>(() => {
    if (!world) return [];
    const inRegion = world.competitions.filter((c) => c.region === region);
    if (region === 'america') return inRegion;
    if (nation === 'all') return inRegion.filter((c) => c.kind === 'bigLeague');
    return inRegion.filter((c) => c.country === nation);
  }, [world, region, nation]);
  const comp = comps.find((c) => c.id === compId) ?? comps[0];
  const clubs = useMemo(() => (world && comp ? comp.clubs.map((id) => world.clubs.find((c) => c.id === id)!).sort((a, b) => strength(world, b) - strength(world, a)) : []), [world, comp]);
  const club = clubs.find((c) => c.id === chosen) ?? clubs[0];
  // The list shows as many clubs as fit; more go on further pages (GAME_FLOW §6.1a).
  const fit = useFitRows(clubs.length, '.cr-club', comp?.id);

  if (failed) return <div className="cr-wait">The world could not be created. Reload the page to try again.</div>;
  if (!world || !club || !comp)
    return (
      <div className="cr-wait">
        <h1>Creating the world…</h1>
        <span className="cr-sub">318 clubs in America and 11 European countries, about 7,400 people</span>
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
      await writeWorld(careerStore, slot, mine);
      onStart(mine, slot);
    };
    if (empty >= 0) return void go();
    const s = slots?.[slot];
    const what = s?.status === 'ok' ? `${s.summary.club} (season ${s.summary.season})` : 'the save';
    confirm.ask({ title: `Replace ${what}?`, body: `Your new career goes in career slot ${slot + 1}, and the career saved there is gone for good.`, confirm: 'Replace it', cancel: 'Keep it', danger: true }, () => void go());
  };

  const pickRegion = (r: Region) => {
    setRegion(r);
    setNation('all');
    setCompId(r === 'america' ? 'big-league-america' : 'big-league-europe');
    setChosen(null);
  };
  const pickNation = (n: string) => {
    setNation(n);
    setCompId(n === 'all' ? 'big-league-europe' : `${n.toLowerCase()}-league-1`);
    setChosen(null);
  };

  return (
    <div className="cr cr-new">
      {confirm.dialog}
      <header className="cr-top">
        <button className="cr-back" onClick={onBack}>
          <BackIcon /> Menu
        </button>
        <div className="cr-new-title">
          <h1>New career</h1>
          <span className="cr-sub">Choose any club, at any level: start at the top, or climb from the bottom.</span>
        </div>
      </header>

      <div className="cr-new-body">
        <section className="cr-new-pick">
          <div className="cr-filters">
            <div className="cr-filter">
              <span className="cr-label">Region</span>
              <div className="cr-tabs">
                {REGIONS.map((r) => (
                  <button key={r} className={region === r ? 'on' : ''} aria-pressed={region === r} onClick={() => pickRegion(r)}>
                    {REGION_NAME[r]}
                  </button>
                ))}
              </div>
            </div>
            {region === 'europe' && (
              <div className="cr-filter">
                <span className="cr-label">Country</span>
                <div className="cr-pills">
                  {['all', ...EUROPE_COUNTRIES].map((n) => (
                    <button key={n} className={nation === n ? 'on' : ''} aria-pressed={nation === n} onClick={() => pickNation(n)}>
                      {n === 'all' ? 'All' : country(n)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="cr-filter">
              <span className="cr-label">Competition</span>
              <div className="cr-pills">
                {comps.map((c) => (
                  <button
                    key={c.id}
                    className={comp.id === c.id ? 'on' : ''}
                    aria-pressed={comp.id === c.id}
                    onClick={() => {
                      setCompId(c.id);
                      setChosen(null);
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="cr-clubs" role="list">
            {clubs.slice(fit.from, fit.to).map((c) => {
              const best = squad(world, c).slice(0, 3);
              return (
                <button key={c.id} role="listitem" className={`cr-club ${c.id === club.id ? 'on' : ''}`} aria-pressed={c.id === club.id} onClick={() => setChosen(c.id)}>
                  <Badge club={c} size={36} />
                  <span className="cr-club-main">
                    <b>{c.name}</b>
                    <small>{best.map((p) => p.p.name).join(' · ')}</small>
                  </span>
                  <span className="cr-club-num">
                    <b>{strength(world, c).toFixed(0)}</b>
                    <small>rating</small>
                  </span>
                  <span className="cr-club-num money">
                    <b>{clubMoney(world, c).split(' ')[1]}</b>
                    <small>{c.moneySystem === 'cap' ? 'payroll' : 'budget'}</small>
                  </span>
                </button>
              );
            })}
          </div>
          <Pager fit={fit} total={clubs.length} />
        </section>

        <aside className="cr-card cr-new-side" id="cr-new-side">
          <div className="cr-new-club">
            <Badge club={club} size={44} />
            <div>
              <h2>{club.name}</h2>
              <span className="cr-sub">
                {club.city}, {club.state ?? country(club.country)}
              </span>
            </div>
          </div>
          <div className="cr-chips">
            {competitionsOf(world, club.id).map((c) => (
              <span key={c.id} className="cr-chip">
                {c.name}
              </span>
            ))}
            {club.licence && <span className="cr-chip warn">{club.licence === 'licence' ? 'Licence' : 'Wildcard'}</span>}
          </div>
          <dl className="cr-facts">
            <dt>Squad</dt>
            <dd>
              {strength(world, club).toFixed(1)} · {rank === 1 ? 'the strongest' : `${ordinal(rank)} strongest`} of {clubs.length}
            </dd>
            <dt>Money</dt>
            <dd>{club.moneySystem === 'cap' ? `${clubMoney(world, club)} · salary cap ${money(100e6)}` : `${clubMoney(world, club)} a season`}</dd>
            <dt>Arena</dt>
            <dd>{club.arena.capacity.toLocaleString('en-US')} seats</dd>
          </dl>
          <div>
            <span className="cr-label">Best players (scout estimates)</span>
            <ul className="cr-best">
              {squad(world, club)
                .slice(0, 3)
                .map((p) => {
                  const r = overallRange(world, p);
                  return (
                    <li key={p.p.id}>
                      <span className="cr-pos">{p.p.position}</span>
                      <span>{p.p.name}</span>
                      <b style={{ color: ratingTone(mid(r)) }}>{showRange(r)}</b>
                    </li>
                  );
                })}
            </ul>
          </div>
          <label className="cr-field">
            <span className="cr-label">Your name (manager)</span>
            <input value={manager} maxLength={24} placeholder="optional" onChange={(e) => setManager(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && start()} />
          </label>
          {slots && empty < 0 && (
            <div className="cr-replace">
              <span className="cr-sub">All three career slots are in use. Save over:</span>
              <div className="cr-pills cr-slots">
                {slots.map((s) => (
                  <button key={s.slot} className={replace === s.slot ? 'on' : ''} aria-pressed={replace === s.slot} onClick={() => setReplace(s.slot)}>
                    <b>Slot {s.slot + 1}</b>
                    <small>{s.status === 'ok' ? s.summary.club : s.status === 'empty' ? 'empty' : s.status}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          <button className="cr-start" disabled={slot === null || saving || !slots} onClick={start}>
            {saving ? 'Saving…' : `Manage ${club.name}`}
          </button>
        </aside>
      </div>

    </div>
  );
}
