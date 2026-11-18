// The career hub (WORLD_SPEC slice W1): your club, the whole world (both regions, all four
// divisions, every club), the colleges and the free agents, with any player's card beside the list.
// Matches and seasons come in the next slice (W2); the hub says so.

import { useState } from 'react';
import { clubById, leagueLabel, squad } from '../../../game/world/query';
import type { Region, Tier, World, WorldClub } from '../../../game/world/types';
import { LeagueTable, WhereSwitch } from './LeagueTable';
import { ClubFacts, PlayerCard, PlayerTable } from './parts';

type Tab = 'club' | 'world' | 'colleges' | 'free';
const PAGE = 20;

export function CareerHub({ world: w, onMenu }: { world: World; slot: number; onMenu: () => void }) {
  const mine = clubById(w, w.human!.club)!;
  const [tab, setTab] = useState<Tab>('club');
  const [region, setRegion] = useState<Region>(mine.region);
  const [tier, setTier] = useState<Tier>(mine.tier);
  const [openClub, setOpenClub] = useState<string | null>(null);
  const [openCollege, setOpenCollege] = useState<string | null>(null);
  const [player, setPlayer] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [academy, setAcademy] = useState(false);

  const go = (t: Tab) => {
    setTab(t);
    setPlayer(null);
    setOpenClub(null);
    setOpenCollege(null);
    setAcademy(false);
  };

  const clubView = (club: WorldClub, back?: () => void) => (
    <>
      <div className="cw-left-head">
        {back && (
          <button className="small" onClick={back}>
            ◀ {leagueLabel(club.region, club.tier)}
          </button>
        )}
        <span className="cw-dot big" style={{ background: club.colours[0], borderColor: club.colours[1] }} />
        <h3>{club.name}</h3>
        {club.region === 'europe' && (
          <span className="hub-seg">
            <button className={!academy ? 'on' : ''} onClick={() => setAcademy(false)}>
              First team
            </button>
            <button className={academy ? 'on' : ''} onClick={() => setAcademy(true)} title="Players aged 15 to 18 who may join the first team at 18">
              Academy ({club.academy.length})
            </button>
          </span>
        )}
      </div>
      <ClubFacts w={w} club={club} />
      <PlayerTable w={w} players={academy ? club.academy.map((id) => w.players[id]) : squad(w, club)} selected={player} onSelect={setPlayer} showWage={!academy} />
    </>
  );

  let left;
  if (tab === 'club') left = clubView(mine);
  else if (tab === 'world') {
    const open = openClub ? clubById(w, openClub) : undefined;
    left = open ? (
      clubView(open, () => {
        setOpenClub(null);
        setAcademy(false);
      })
    ) : (
      <>
        <div className="cw-left-head">
          <h3>{leagueLabel(region, tier)}</h3>
          <WhereSwitch region={region} tier={tier} onRegion={setRegion} onTier={setTier} />
        </div>
        <LeagueTable w={w} region={region} tier={tier} onOpen={(id) => setOpenClub(id)} />
      </>
    );
  } else if (tab === 'colleges') {
    const col = openCollege ? w.colleges.find((c) => c.id === openCollege) : undefined;
    left = col ? (
      <>
        <div className="cw-left-head">
          <button className="small" onClick={() => setOpenCollege(null)}>
            ◀ Colleges
          </button>
          <h3>{col.name}</h3>
          <span className="muted small">
            {col.city}, {col.state} · {'★'.repeat(6 - col.level)}
            <span style={{ opacity: 0.25 }}>{'★'.repeat(col.level - 1)}</span>
          </span>
        </div>
        <PlayerTable w={w} players={col.players.map((id) => w.players[id])} selected={player} onSelect={setPlayer} showWage={false} />
        <span className="muted small">Seniors (year 4) and the best younger players enter the draft at the end of the season.</span>
      </>
    ) : (
      <>
        <div className="cw-left-head">
          <h3>Colleges</h3>
          <span className="muted small">40 colleges across the United States: where America's young players come from, through the draft.</span>
        </div>
        <div className="cw-colleges">
          {[...w.colleges]
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
            .map((c) => (
              <button key={c.id} className="cw-college" onClick={() => setOpenCollege(c.id)}>
                <b>{c.name}</b>
                <span className="muted small">
                  {c.city}, {c.state}
                </span>
                <span className="stars">
                  {'★'.repeat(6 - c.level)}
                  <span style={{ opacity: 0.25 }}>{'★'.repeat(c.level - 1)}</span>
                </span>
              </button>
            ))}
        </div>
      </>
    );
  } else {
    const all = w.freeAgents.map((id) => w.players[id]);
    const pages = Math.ceil(all.length / PAGE);
    left = (
      <>
        <div className="cw-left-head">
          <h3>Free agents</h3>
          <span className="muted small">{all.length} players without a club. Signing them comes with free agency (a later step).</span>
          <span className="cw-pager">
            <button className="small" disabled={page === 0} onClick={() => setPage(page - 1)}>
              ◀
            </button>
            <span className="small">
              {page + 1} / {pages}
            </span>
            <button className="small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              ▶
            </button>
          </span>
        </div>
        <PlayerTable w={w} players={all.slice(page * PAGE, page * PAGE + PAGE)} selected={player} onSelect={setPlayer} showWage={false} />
      </>
    );
  }

  return (
    <div className="cw">
      <header className="cw-bar">
        <button onClick={onMenu}>☰ Menu</button>
        <span className="cw-dot big" style={{ background: mine.colours[0], borderColor: mine.colours[1] }} />
        <div className="cw-title">
          <h1>{mine.name}</h1>
          <span className="muted small">
            {leagueLabel(mine.region, mine.tier)} · season {w.season}–{String(w.season + 1).slice(2)}
            {w.human?.manager ? ` · manager ${w.human.manager}` : ''}
          </span>
        </div>
        <nav className="hub-seg cw-tabs">
          {(
            [
              ['club', 'My club'],
              ['world', 'World'],
              ['colleges', 'Colleges'],
              ['free', 'Free agents'],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => go(t)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="cw-note">The world is ready and saved. Look around: every club, player and college. Playing the season comes next.</div>

      <div className="cw-main">
        <section className="panel cw-left">{left}</section>
        <aside className="panel cw-side">
          <PlayerCard w={w} id={player} />
        </aside>
      </div>
    </div>
  );
}
