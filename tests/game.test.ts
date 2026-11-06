import { describe, expect, it } from 'vitest';
import { callTimeout, createMatch, setGamePlan, stepPossession, validatePlan } from '../src/engine/match';
import { positionGroup } from '../src/engine/ratings';
import { createRng } from '../src/engine/rng';
import { aiAdjustPlan, aiDraftAll, aiGamePlan, aiShouldTimeout, aiSnakeTurns, planTendencies } from '../src/game/ai';
import { assistantTips, createTipMemory } from '../src/game/assistant';
import { canPick, createDraft, currentTurn, findPool, isComplete, pick, release, ROSTER_SIZE, toTeam, type DraftState } from '../src/game/draft';
import { playerPool } from '../src/game/pool';
import { BUDGET } from '../src/game/pricing';
import { ATTRIBUTE_GROUPS, scoutAttr } from '../src/game/scouting';

const teams = (c0: 'human' | 'ai', c1: 'human' | 'ai') =>
  [
    { name: 'Home', abbr: 'HOM', controller: c0 },
    { name: 'Away', abbr: 'AWY', controller: c1 },
  ] as const;

function assertLegal(state: DraftState, team: 0 | 1) {
  const t = state.teams[team];
  expect(t.picks.length).toBe(ROSTER_SIZE);
  expect(t.budgetLeft).toBeGreaterThanOrEqual(0);
  const spent = t.picks.reduce((s, id) => s + findPool(state, id).price, 0);
  expect(spent + t.budgetLeft).toBe(BUDGET);
  const groups = { guard: 0, wing: 0, big: 0 };
  for (const id of t.picks) groups[positionGroup(findPool(state, id).player.position)]++;
  expect(Math.min(groups.guard, groups.wing, groups.big)).toBeGreaterThanOrEqual(2);
}

describe('pool and pricing', () => {
  it('has ~160 unique players with prices inside the budget range', () => {
    const pool = playerPool();
    expect(pool.length).toBeGreaterThan(150);
    expect(new Set(pool.map((p) => p.player.id)).size).toBe(pool.length);
    for (const p of pool) {
      expect(p.price).toBeGreaterThanOrEqual(1);
      expect(p.price).toBeLessThanOrEqual(40);
    }
  });

  it('a full roster of the cheapest players fits the budget several times over', () => {
    const cheapest = playerPool().map((p) => p.price).sort((a, b) => a - b).slice(0, ROSTER_SIZE);
    expect(cheapest.reduce((s, x) => s + x, 0)).toBeLessThan(BUDGET / 3);
  });
});

describe('scouting', () => {
  it('ranges always contain the true value, and famous players are easier to read', () => {
    for (const p of playerPool()) {
      for (const g of ATTRIBUTE_GROUPS) {
        for (const a of g.attrs) {
          const r = scoutAttr(p.player, a.key, p.hype, 0.55);
          expect(r.lo).toBeLessThanOrEqual(p.player.attrs[a.key]);
          expect(r.hi).toBeGreaterThanOrEqual(p.player.attrs[a.key]);
        }
      }
    }
    const pool = playerPool();
    const famous = pool.find((p) => p.hype >= 95)!;
    const unknown = pool.find((p) => p.hype <= 10)!;
    const width = (x: typeof famous) => {
      const r = scoutAttr(x.player, 'three', x.hype, 0.55);
      return r.hi - r.lo;
    };
    expect(width(famous)).toBeLessThan(width(unknown));
    const exact = scoutAttr(unknown.player, 'three', unknown.hype, 1);
    expect(exact.lo).toBe(exact.hi);
  });
});

describe('draft', () => {
  it('blocks picks that break the budget or position rules', () => {
    let s = createDraft('free', playerPool(), teams('human', 'human'));
    const stars = playerPool().filter((p) => p.price >= 35).slice(0, 3);
    s = pick(s, 0, stars[0].player.id);
    s = pick(s, 0, stars[1].player.id);
    expect(canPick(s, 0, stars[2].player.id).ok).toBe(false);
    expect(canPick(s, 1, stars[0].player.id).reason).toBe('Already signed');
  });

  it('release gives the money back (free draft)', () => {
    let s = createDraft('free', playerPool(), teams('human', 'human'));
    const id = playerPool()[0].player.id;
    s = pick(s, 0, id);
    s = release(s, 0, id);
    expect(s.teams[0].budgetLeft).toBe(BUDGET);
    expect(id in s.owner).toBe(false);
  });

  it('snake order alternates 0,1,1,0,0,1', () => {
    let s = createDraft('snake', playerPool(), teams('human', 'human'));
    const order: number[] = [];
    const cheap = playerPool().filter((p) => p.price <= 3);
    for (let i = 0; i < 6; i++) {
      const turn = currentTurn(s)!;
      order.push(turn);
      const choice = cheap.find((p) => canPick(s, turn, p.player.id).ok)!;
      s = pick(s, turn, choice.player.id);
    }
    expect(order).toEqual([0, 1, 1, 0, 0, 1]);
  });

  it('the AI builds legal squads in free and snake drafts', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const rng = createRng(seed);
      let free = createDraft('free', playerPool(), teams('ai', 'ai'));
      free = aiDraftAll(free, 0, rng);
      free = aiDraftAll(free, 1, rng);
      assertLegal(free, 0);
      assertLegal(free, 1);

      let snake = createDraft('snake', playerPool(), teams('ai', 'ai'));
      snake = aiSnakeTurns(snake, rng);
      expect(isComplete(snake)).toBe(true);
      assertLegal(snake, 0);
      assertLegal(snake, 1);
    }
  });

  it('toTeam gives unique jersey numbers', () => {
    const rng = createRng(3);
    let s = createDraft('free', playerPool(), teams('ai', 'ai'));
    s = aiDraftAll(s, 0, rng);
    const team = toTeam(s, 0, 'home');
    expect(new Set(team.players.map((p) => p.number)).size).toBe(ROSTER_SIZE);
  });
});

describe('AI coach in a full match', () => {
  it('plays AI vs AI drafted squads with timeouts, adjustments and tips', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rng = createRng(seed);
      let d = createDraft('snake', playerPool(), teams('ai', 'ai'));
      d = aiSnakeTurns(d, rng);
      const home = toTeam(d, 0, 'home');
      const away = toTeam(d, 1, 'away');
      const t = planTendencies(home, away);
      expect(Object.values(t.offence).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);

      const s = createMatch(home, away, aiGamePlan(home, away, rng), aiGamePlan(away, home, rng), seed);
      const sinceTimeout = [99, 99];
      const memory = createTipMemory();
      let tips = 0;
      while (!s.finished) {
        stepPossession(s);
        tips += assistantTips(s, memory).length;
        for (const side of [0, 1] as const) {
          sinceTimeout[side]++;
          if (aiShouldTimeout(s, side, sinceTimeout[side]) && callTimeout(s, side)) {
            sinceTimeout[side] = 0;
            const plan = aiAdjustPlan(s, side);
            validatePlan(s.teams[side].team, plan);
            setGamePlan(s, side, plan);
          }
        }
      }
      expect(s.teams[0].timeoutsLeft).toBeGreaterThanOrEqual(0);
      expect(tips).toBeGreaterThan(0);
    }
  });
});
