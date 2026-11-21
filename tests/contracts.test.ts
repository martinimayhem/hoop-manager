// Contracts running out (WORLD_SPEC §7.0) and what players ask (§7.1), slice brief W2b §9: the wage
// market, each demand factor, the answers, interest, the money rules, AI re-signing, every club at 13,
// and the new season blocked below 13.

import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld, fitMarket } from '../src/game/world/generate';
import { CAP, HARD_CEILING, MAX_CONTRACT, MIN_CONTRACT } from '../src/game/world/money';
import { clubById, takeOver } from '../src/game/world/query';
import { encode, memoryStore, readWorld, WORLD_FORMAT } from '../src/game/world/saves';
import type { World, WorldClub, WorldPlayer } from '../src/game/world/types';
import { advance, beginSeason, playOf, simulateInputs, startSeason } from '../src/game/season/play';
import { BL_AMERICA, BL_EUROPE } from '../src/game/season/post';
import {
  ageAt,
  answerTo,
  autoFill,
  autoOffseason,
  belowFloor,
  canPay,
  clubLevel,
  closeContracts,
  closeFreeAgency,
  committed,
  countDown,
  demand,
  expiring,
  interest,
  judge,
  Market,
  minimumDeal,
  offer,
  openOffseason,
  ovr,
  shortOf,
  SQUAD,
  standing,
  TUNING,
} from '../src/game/season/contracts';
import type { SeasonArchive } from '../src/game/season/types';

let base: World;
/** The offseason of a fresh world: contracts counted down once, you at a Big League America club. */
let off: World;
let m: Market;
const club = (w: World, id: string) => clubById(w, id)!;
const leagueClubs = (w: World, pred: (c: World['competitions'][number]) => boolean) => w.competitions.filter(pred).flatMap((c) => c.clubs);

beforeAll(() => {
  base = createWorld(5);
  const me = base.competitions.find((c) => c.id === BL_AMERICA)!.clubs[3];
  off = openOffseason(countDown(startSeason(takeOver(base, me))));
  m = new Market(off);
});

/** A club's league prestige (WORLD_SPEC §7.1 table). */
const prestigeOfClub = (id: string) => m.club(id).prestige;

/** A copy of a player with changes (a new engine player, so his overall is measured again). */
function variant(wp: WorldPlayer, changes: { age?: number; potential?: number; reputation?: number; nationality?: string; ambition?: number; club?: string; status?: WorldPlayer['status'] }, w: World): WorldPlayer {
  return {
    ...wp,
    p: { ...wp.p, attrs: { ...wp.p.attrs, ...(changes.potential !== undefined ? { potential: changes.potential } : {}) } },
    born: changes.age !== undefined ? w.season - changes.age : wp.born,
    reputation: changes.reputation ?? wp.reputation,
    nationality: changes.nationality ?? wp.nationality,
    personality: { ...wp.personality, ...(changes.ambition !== undefined ? { ambition: changes.ambition } : {}) },
    status: changes.status ?? 'free',
    club: changes.club,
  };
}

/** An ordinary first-team player: overall near the world's middle, so demands stay inside the limits. */
function middling(w: World): WorldPlayer {
  const pool = Object.values(w.players).filter((wp) => wp.status === 'club');
  return pool.sort((a, b) => Math.abs(ovr(a) - 66) - Math.abs(ovr(b) - 66))[0];
}

describe('the wage market (WORLD_SPEC §7.1)', () => {
  it('WHEN a world is made THEN a and b are fitted over the first teams and stored, with a pay level per league', () => {
    const k = base.market!;
    expect(k.a).toBeGreaterThan(1.7);
    expect(k.a).toBeLessThan(2.2);
    expect(k.b).toBeGreaterThan(0.16);
    expect(k.b).toBeLessThan(0.19);
    expect(k.pay[BL_AMERICA]).toBeGreaterThan(k.pay[BL_EUROPE]);
    for (const c of base.competitions.filter((x) => x.kind !== 'cup')) expect(k.pay[c.id]).toBeGreaterThan(0);
  });

  it('WHEN an older save (format 3, no market) is loaded THEN the market is fitted from its contracts and stored', async () => {
    const store = memoryStore();
    const old = { ...startSeason(base) };
    delete old.market;
    await store.put(0, await encode({ format: 3, kind: 'world', savedAt: 'x', summary: {}, data: old }));
    const r = await readWorld(store, 0);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(WORLD_FORMAT).toBe(4);
    expect(r.data.market).toEqual(fitMarket(old));
  });
});

describe('demand (WORLD_SPEC §7.1 step 2)', () => {
  const at = (wp: WorldPlayer, clubId: string, band: 'keen' | 'interested' | 'reluctant' = 'interested') => demand(m, wp, clubId, band);
  let mid: WorldPlayer;
  let blA: string;
  beforeAll(() => {
    mid = variant(middling(off), { age: 27, reputation: 50 }, off);
    blA = off.competitions.find((c) => c.id === BL_AMERICA)!.clubs[0];
  });

  it('WHEN nothing else applies THEN he asks market wage × league pay level × reputation, rounded down', () => {
    const k = off.market!;
    const want = Math.exp(k.a + k.b * ovr(mid)) * k.pay[BL_AMERICA] * (0.85 + (0.3 * 50) / 99);
    const d = at(mid, blA);
    expect(d).toBeLessThanOrEqual(want);
    expect(d).toBeGreaterThan(want * 0.99);
  });

  it('WHEN he would join a league that pays more THEN he asks that much more', () => {
    const k = off.market!;
    const es = off.competitions.find((c) => c.id === 'es-league-2')!.clubs[0];
    const ratio = at(mid, es) / at(mid, blA);
    expect(ratio).toBeCloseTo(k.pay['es-league-2'] / k.pay[BL_AMERICA], 1);
  });

  it('WHEN he is under 25 with potential above his overall THEN × (1 + 0.02 × the gap), at most × 1.2', () => {
    const o = Math.round(ovr(mid));
    const young = (gap: number) => at(variant(mid, { age: 22, potential: o + gap }, off), blA);
    const ref = at(variant(mid, { age: 22, potential: Math.floor(ovr(mid)) }, off), blA);
    expect(young(5) / ref).toBeGreaterThan(1.08);
    expect(young(5) / ref).toBeLessThan(1.13);
    expect(young(30) / ref).toBeGreaterThan(1.18);
    expect(young(30) / ref).toBeLessThan(1.22);
  });

  it('WHEN he is over 30 THEN × (1 − 0.05 per year over 30), at least × 0.6', () => {
    const ref = at(mid, blA);
    expect(at(variant(mid, { age: 34 }, off), blA) / ref).toBeCloseTo(0.8, 1);
    expect(at(variant(mid, { age: 40 }, off), blA) / ref).toBeCloseTo(0.6, 1);
  });

  it('WHEN his reputation is higher THEN × (0.85 + 0.3 × reputation ÷ 99)', () => {
    const lo = at(variant(mid, { age: 27, reputation: 1 }, off), blA);
    const hi = at(variant(mid, { age: 27, reputation: 99 }, off), blA);
    expect(hi / lo).toBeCloseTo((0.85 + 0.3) / (0.85 + 0.3 / 99), 1);
  });

  it('WHEN he is keen, interested or reluctant THEN the demand is × 0.9, × 1, × 1.25', () => {
    const one = at(mid, blA, 'interested');
    expect(at(mid, blA, 'keen') / one).toBeCloseTo(0.9, 2);
    expect(at(mid, blA, 'reluctant') / one).toBeCloseTo(1.25, 2);
  });

  it('WHEN any player asks any club THEN the demand stays between the minimum deal and 30% of C', () => {
    const players = Object.values(off.players).filter((wp) => wp.status === 'club').slice(0, 400);
    const clubs = off.clubs.filter((_, i) => i % 9 === 0);
    for (const c of clubs)
      for (const wp of players) {
        const d = demand(m, wp, c.id, 'reluctant');
        expect(d).toBeGreaterThanOrEqual(minimumDeal(c));
        expect(d).toBeLessThanOrEqual(MAX_CONTRACT);
      }
  });
});

describe('answering an offer (WORLD_SPEC §7.1)', () => {
  it('WHEN the offer is at or above his demand THEN yes; from 85% he asks for his demand; below 85% no', () => {
    expect(answerTo(1_000_000, 1_000_000)).toBe('yes');
    expect(answerTo(1_200_000, 1_000_000)).toBe('yes');
    expect(answerTo(850_000, 1_000_000)).toBe('ask');
    expect(answerTo(849_999, 1_000_000)).toBe('no');
  });

  it('WHEN you offer one of your expiring players a deal THEN he says yes at his demand (and signs), asks for it at 90%, says no at 50%, always with a reason', () => {
    const me = off.human!.club;
    const ex = expiring(off, me).map((wp) => ({ wp, j: judge(m, wp, me, 0) })).find((x) => interest(m, x.wp, me).band !== 'wont');
    expect(ex).toBeTruthy();
    const wp = ex!.wp;
    const d = ex!.j.demand;
    const no = offer(off, wp.p.id, Math.floor(d * 0.5), 2);
    expect(no.talk.answer).toBe('no');
    expect(no.talk.reason.length).toBeGreaterThan(3);
    expect(no.w.players[wp.p.id].contract!.years).toBe(0);
    const ask = offer(off, wp.p.id, Math.ceil(d * 0.9), 2);
    expect(ask.talk.answer).toBe('ask');
    expect(ask.talk.reason).toBe('wants more money');
    const yes = offer(off, wp.p.id, d, 2);
    expect(yes.talk.answer).toBe('yes');
    expect(yes.w.players[wp.p.id].contract).toMatchObject({ wage: d, years: 2 });
  });
});

describe('interest (WORLD_SPEC §7.1 step 1)', () => {
  it('WHEN a superstar in his prime (standing 95+, 30 or younger) is offered a deal by a US Division 4 or European second-tier club THEN he won’t consider it, at any wage', () => {
    // On seeds 1, 2 and 5 (scripts/seasons-check.ts reports the same over 20 seasons); an ageing star can step down (§7.1).
    const stars = Object.values(off.players).filter((wp) => standing(off, wp) >= 95 && ageAt(off, wp) <= 30);
    expect(stars.length).toBeGreaterThan(0);
    const small = [...leagueClubs(off, (c) => c.id === 'us-division-4'), ...leagueClubs(off, (c) => c.kind === 'nationalLeague' && c.tier === 2)];
    for (const wp of stars) {
      const free = variant(wp, {}, off);
      for (const id of small) {
        expect(interest(m, free, id).band).toBe('wont');
        expect(judge(m, free, id, MAX_CONTRACT).answer).toBe('no');
      }
    }
  });

  it('WHEN Nikola Jokester (standing 98, ambition 5, age 31) is asked THEN he won’t consider a Serbian second-tier club, but can consider a Serbian first-tier club', () => {
    const jok = Object.values(off.players).find((wp) => wp.p.name === 'Nikola Jokester')!;
    const j = variant(jok, { age: 31, ambition: 5 }, off);
    expect(standing(off, j)).toBeCloseTo(98, 0);
    const rs = (tier: number) => off.competitions.find((c) => c.kind === 'nationalLeague' && c.country === 'RS' && c.tier === tier)!.clubs.find((id) => !club(off, id).licence)!;
    const second = interest(m, j, rs(2));
    expect(second.band).toBe('wont');
    expect(second.reason).toBe("won't play below a first-tier league");
    const first = club(off, rs(1));
    expect(belowFloor(off, j, prestigeOfClub(first.id))).toBe(false);
    expect(interest(m, j, first.id).reason).not.toMatch(/won't play/);
  });

  it('WHEN a standing-80 player is asked THEN he won’t consider US Division 4, but can consider a European second tier', () => {
    const p80 = Object.values(off.players)
      .filter((wp) => ageAt(off, wp) <= 30)
      .sort((a, b) => Math.abs(standing(off, a) - 80) - Math.abs(standing(off, b) - 80))[0];
    expect(Math.abs(standing(off, p80) - 80)).toBeLessThan(0.5);
    const free = variant(p80, {}, off);
    const d4 = off.competitions.find((c) => c.id === 'us-division-4')!.clubs[0];
    expect(interest(m, free, d4)).toMatchObject({ band: 'wont', reason: "won't play in Division 4" });
    const es2 = off.competitions.find((c) => c.kind === 'nationalLeague' && c.country === 'ES' && c.tier === 2)!.clubs[0];
    expect(belowFloor(off, free, prestigeOfClub(es2))).toBe(false);
    expect(interest(m, free, es2).reason).not.toMatch(/won't play/);
  });

  it('WHEN a 34-year-old of standing 70 is asked THEN no league is below his floor', () => {
    const p70 = variant(
      Object.values(off.players).sort((a, b) => Math.abs(standing(off, a) - 70) - Math.abs(standing(off, b) - 70))[0],
      { age: 34 },
      off,
    );
    expect(Math.abs(standing(off, p70) - 70)).toBeLessThan(0.5);
    for (const c of off.clubs) expect(belowFloor(off, p70, prestigeOfClub(c.id))).toBe(false);
  });

  it('WHEN a veteran rates a first-tier club in his own country THEN he is keen ("would love to come home")', () => {
    const lt = off.competitions.find((c) => c.kind === 'nationalLeague' && c.country === 'LT' && c.tier === 1)!;
    // His country's best club outside the Big League.
    const home = [...lt.clubs].filter((id) => !club(off, id).licence).sort((a, b) => club(off, b).reputation - club(off, a).reputation)[0];
    const vet = variant(middling(off), { age: 34, nationality: 'LT', reputation: 45, ambition: 10 }, off);
    const i = interest(m, vet, home);
    expect(i.band).toBe('keen');
    expect(i.reason).toBe('would love to come home');
    // The same club is less attractive to him without the home factor.
    expect(interest(m, { ...vet, nationality: 'US' }, home).score).toBeLessThan(i.score);
  });

  it('WHEN a prospect under 24 compares a starting role in a national league with the bench of a top club THEN he prefers to start', () => {
    const top = [...off.competitions.find((c) => c.id === BL_AMERICA)!.clubs].sort((a, b) => club(off, b).reputation - club(off, a).reputation)[0];
    const n1 = off.competitions.find((c) => c.kind === 'nationalLeague' && c.country === 'ES' && c.tier === 1)!.clubs.find((id) => !club(off, id).licence)!;
    // A 21-year-old as good as a national-league starter: on the bench at a top Big League club.
    const sq = (id: string) => club(off, id).roster.map((x) => ovr(off.players[x])).sort((a, b) => b - a);
    const pool = Object.values(off.players).filter((wp) => wp.status === 'club' && ovr(wp) > sq(n1)[4] && ovr(wp) < sq(top)[8]);
    expect(pool.length).toBeGreaterThan(0);
    const kid = variant(pool[0], { age: 21, reputation: 40, ambition: 10, nationality: 'FR' }, off);
    const start = interest(m, kid, n1);
    const bench = interest(m, kid, top);
    expect(start.score).toBeGreaterThan(bench.score);
    expect(start.reason).toBe('would start here');
  });

  it('WHEN a club is relegated after finishing last THEN its star can refuse to stay', () => {
    // A first-tier club finished last and went down; its best player played big minutes, is unhappy and not loyal.
    const t1 = off.competitions.find((c) => c.kind === 'nationalLeague' && c.country === 'ES' && c.tier === 1)!;
    const t2 = off.competitions.find((c) => c.kind === 'nationalLeague' && c.country === 'ES' && c.tier === 2)!;
    const down = t1.clubs.find((id) => !club(off, id).licence)!;
    const star = [...club(off, down).roster].sort((a, b) => ovr(off.players[b]) - ovr(off.players[a]))[0];
    const arch: SeasonArchive = {
      season: off.season - 1,
      tables: { [t1.id]: [...t1.clubs.filter((c) => c !== down), down].map((c) => [c, 10, 10, 0, 0]) },
      champions: {},
      promoted: [],
      relegated: [down],
      licenceLost: [],
      wildcards: [],
      results: [],
      boxes: {},
    };
    const w: World = {
      ...off,
      history: [arch],
      competitions: off.competitions.map((c) => (c.id === t1.id ? { ...c, clubs: c.clubs.filter((x) => x !== down) } : c.id === t2.id ? { ...c, clubs: [...c.clubs, down] } : c)),
      players: { ...off.players, [star]: { ...off.players[star], morale: 'low', reputation: 80, personality: { ...off.players[star].personality, loyalty: 2, ambition: 16 }, career: [{ season: off.season - 1, club: down, t: [30, 30 * 32 * 60] }] } },
    };
    const mm = new Market(w);
    const wp = w.players[star];
    expect(clubLevel(w, down)).toBe('n2');
    const i = interest(mm, wp, down);
    expect(['wont', 'reluctant']).toContain(i.band);
    // An offer at what an interested player would ask is refused.
    expect(judge(mm, wp, down, demand(mm, wp, down, 'interested')).answer).toBe('no');
  });
});

describe('money when re-signing and signing (WORLD_SPEC §7.0)', () => {
  /** A world where this club's committed wages are set to `pay` (by its first player's wage). */
  function withPayroll(w: World, c: WorldClub, pay: number, expiringId: string): World {
    const filler = c.roster.find((x) => x !== expiringId && (w.players[x].contract?.years ?? 0) > 0)!;
    const fw = w.players[filler];
    const rest = committed(w, c) - fw.contract!.wage;
    return { ...w, players: { ...w.players, [filler]: { ...fw, contract: { ...fw.contract!, wage: pay - rest } } } };
  }

  it('WHEN a cap club re-signs its own player THEN it may go over the cap, up to 1.34 C and never above', () => {
    const me = club(off, off.human!.club);
    const own = expiring(off, me.id)[0];
    expect(own).toBeTruthy();
    const w = withPayroll(off, me, CAP * 1.2, own.p.id);
    const c = club(w, me.id);
    expect(canPay(w, c, w.players[own.p.id], CAP * 0.1)).toBe(true);
    expect(canPay(w, c, w.players[own.p.id], HARD_CEILING - CAP * 1.2 + 1)).toBe(false);
  });

  it('WHEN a cap club over the cap signs someone else THEN only a minimum contract is allowed', () => {
    const me = club(off, off.human!.club);
    const w = withPayroll(off, me, CAP * 1.05, '');
    const fa = w.players[w.freeAgents[0]];
    expect(canPay(w, club(w, me.id), fa, 2_000_000)).toBe(false);
    expect(canPay(w, club(w, me.id), fa, MIN_CONTRACT)).toBe(true);
    const under = withPayroll(off, me, CAP * 0.9, '');
    expect(canPay(under, club(under, me.id), fa, CAP * 0.09)).toBe(true);
    expect(canPay(under, club(under, me.id), fa, CAP * 0.11)).toBe(false);
  });

  it('WHEN a budget club signs or re-signs THEN the new payroll fits the budget; over budget, only minimum deals', () => {
    const c0 = off.clubs.find((c) => c.moneySystem === 'budget' && expiring(off, c.id).length)!;
    const own = expiring(off, c0.id)[0];
    const w = withPayroll(off, c0, c0.budget * 0.9, own.p.id);
    const c = club(w, c0.id);
    expect(canPay(w, c, w.players[own.p.id], c0.budget * 0.09)).toBe(true);
    expect(canPay(w, c, w.players[own.p.id], c0.budget * 0.11)).toBe(false);
    const over = withPayroll(off, c0, c0.budget * 1.1, own.p.id);
    expect(canPay(over, club(over, c0.id), over.players[own.p.id], minimumDeal(c0) * 2)).toBe(false);
    expect(canPay(over, club(over, c0.id), over.players[own.p.id], minimumDeal(c0))).toBe(true);
  });
});

describe('the offseason (WORLD_SPEC §7.0)', () => {
  let after: World;
  beforeAll(() => {
    after = closeContracts(off);
  });

  it('WHEN AI clubs decide THEN they re-sign only expiring players among their 10 best who would stay, within their money rules', () => {
    let resigned = 0;
    for (const c0 of off.clubs) {
      if (c0.id === off.human!.club) continue;
      const best = [...c0.roster].sort((a, b) => ovr(off.players[b]) - ovr(off.players[a]) || (a < b ? -1 : 1)).slice(0, TUNING.aiKeepBest);
      for (const wp of expiring(off, c0.id)) {
        const now = after.players[wp.p.id];
        if (now.status === 'club') {
          resigned++;
          expect(now.club).toBe(c0.id);
          expect(best).toContain(wp.p.id);
          expect(interest(m, wp, c0.id).band).not.toBe('wont');
        } else expect(now.status).toBe('free');
      }
      const c = club(after, c0.id);
      if (c.moneySystem === 'cap') expect(committed(after, c)).toBeLessThanOrEqual(HARD_CEILING);
    }
    expect(resigned).toBeGreaterThan(100);
  });

  it('WHEN the contract screen is done THEN your players without a new deal leave as free agents', () => {
    for (const wp of expiring(off, off.human!.club)) {
      expect(after.players[wp.p.id].status).toBe('free');
      expect(after.freeAgents).toContain(wp.p.id);
    }
    expect(playOf(after).offseason?.step).toBe('free');
  });

  it('WHEN you have fewer than 13 THEN the new season is blocked ("sign n more"), Auto-fill signs the best affordable free agents', async () => {
    const me = off.human!.club;
    expect(shortOf(after, me)).toBeGreaterThan(0);
    expect(() => closeFreeAgency(after)).toThrow(/Sign \d+ more/);
    // Continue stops for the offseason; the season can't begin.
    expect((await advance(after, simulateInputs)).stop).toBe('offseason');
    expect(playOf(beginSeason(after)).phase).toBe('before');
    const filled = autoFill(after);
    expect(club(filled, me).roster).toHaveLength(SQUAD);
    expect(shortOf(filled, me)).toBe(0);
  });

  it('WHEN free agency closes THEN every club has 13, no small club signed a player of standing 80+, and the season can start', () => {
    const r = autoOffseason(off);
    for (const c of r.w.clubs) expect(c.roster).toHaveLength(SQUAD);
    expect(r.report.forced).toBe(0);
    expect(r.report.signings.filter((s) => s.standing >= 80 && (s.level === 'us4' || s.level === 'n2'))).toEqual([]);
    expect(playOf(r.w).offseason).toBeUndefined();
    expect(playOf(beginSeason(r.w)).phase).toBe('regular');
    // Every player belongs once: a club's first team, or the free agents.
    const seen = new Set<string>();
    for (const c of r.w.clubs) for (const id of c.roster) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      expect(r.w.players[id]).toMatchObject({ status: 'club', club: c.id });
    }
    for (const id of r.w.freeAgents) expect(seen.has(id)).toBe(false);
  });

  it('WHEN a club below 13 can afford nobody at his demand THEN it signs the free agent who asks least, at its minimum deal', () => {
    const full = autoOffseason(off).w;
    const x0 = full.clubs.find((c) => c.moneySystem === 'budget' && c.id !== full.human!.club && clubLevel(full, c.id) === 'n1')!;
    const gone = x0.roster[0];
    // Over its budget (only minimum deals), one player short.
    const w: World = {
      ...full,
      clubs: full.clubs.map((c) => (c.id === x0.id ? { ...c, budget: 100_000, roster: c.roster.slice(1) } : c)),
      players: { ...full.players, [gone]: { ...full.players[gone], status: 'free', club: undefined, contract: undefined } },
      freeAgents: [...full.freeAgents, gone],
      play: { ...playOf(full), offseason: { step: 'free', letGo: [], talks: {} } },
    };
    const mm = new Market(w);
    const x = club(w, x0.id);
    const asks = w.freeAgents
      .map((id) => w.players[id])
      .filter((wp) => interest(mm, wp, x.id, TUNING.unsignedRelief).band !== 'wont')
      .map((wp) => ({ id: wp.p.id, d: demand(mm, wp, x.id, interest(mm, wp, x.id, TUNING.unsignedRelief).band), o: ovr(wp) }))
      .sort((a, b) => a.d - b.d || b.o - a.o);
    expect(asks[0].d).toBeGreaterThan(minimumDeal(x));
    const report = { resigned: 0, left: 0, signings: [] as { player: string; club: string; standing: number; level: string; wage: number; round: number }[], forced: 0, top100Signed: 0 };
    const after = closeFreeAgency(w, report as never);
    expect(club(after, x.id).roster).toHaveLength(SQUAD);
    const s = report.signings.find((y) => y.club === x.id)!;
    expect(s).toMatchObject({ round: 3, wage: minimumDeal(x), player: asks[0].id });
  });

  it('WHEN players are under contract THEN ages are real: a player is a year older each season', () => {
    const wp = Object.values(off.players)[0];
    expect(ageAt({ ...off, season: off.season + 1 }, wp)).toBe(ageAt(off, wp) + 1);
  });
});
