# Hoop Manager: scope against Football Manager (SCOPE.md)

> Hoop Manager is a **simplified Football Manager for basketball**. This page says which parts of
> FM (2024–2026) are in, which are out, and which come later. Decided with the owner on
> **18 November 2026**. If another document disagrees with this page, this page wins until that
> document is fixed. Anything marked **Out** or **Later** needs the owner's OK before it is built.

---

## 1. The test for every feature

FM is addictive because of three loops, not because of its hundreds of screens:

1. **Match day:** set the plan, watch, adjust, win or lose.
2. **The squad:** minutes, morale, injuries and fatigue decide who is ready.
3. **Building over years:** draft, academies, contracts and trades turn a club into a contender.

A feature is in only if it feeds one of these loops **and** a 13-year-old basketball fan can read
it without a manual.

---

## 2. The frame

| Question | Decision |
|---|---|
| Who are you? | **Head coach and general manager in one** (FM model): tactics *and* draft, trades, contracts. |
| How long is a season? | A full season, playoffs included, takes **2–4 hours**: watch the key games live, simulate the rest. |
| Your career | **Full manager career:** reputation, job offers, move to other clubs and levels. **Sacking is optional** (a setting; default: you can be sacked). |
| Players | **One player against the computer. No multiplayer of any kind:** no hot-seat, no online play, no team codes. |
| Platform | **Desktop and tablet browser.** Phone is out. |
| Language | **English** at launch. Text kept in one place so translations can follow. |
| Fair play | Unchanged (SPEC.md §1): no paid random packs, energy timers, guilt-driven streaks or pay-to-win. |

---

## 3. FM feature map

Status: **Built** = in the game today and stays · **In** = part of the design, to build ·
**Later** = wanted, not now · **Out** = not in Hoop Manager.

### 3.1 Match day

| FM feature | Hoop Manager | Status | Where |
|---|---|---|---|
| Tactics, starting five, rotation, key matchup | Offence, defence, tempo, intensity, key matchup | Built | SPEC.md §7.2 |
| Timeouts and substitutions | FIBA-style timeouts, subs at breaks | Built | SPEC.md §7.3 |
| Late-game decisions | Clutch play-calls | Built | `src/game/clutch.ts` |
| Halftime team talk | Four options, effect depends on the score | Built | `src/game/teamTalk.ts` |
| Arguing with the referee | Argue a close foul call | Built | `src/ui/match/controller.ts` |
| Opposition report | Scouting report with ranges | Built | SPEC.md §6 |
| Pre-game and post-game team talks | — | Out | |
| Touchline shouts | — | Out | |
| Data hub (shot maps, lineup +/-) | — | Out | |
| Set-piece creator | **Play designer**: draw your own plays | **Later** | |

### 3.2 The squad

| FM feature | Hoop Manager | Status | Where |
|---|---|---|---|
| Training schedules | **Weekly team focus + one development focus per player.** No session-by-session planner. | In | WORLD_SPEC.md §4.1 |
| Morale | Morale per player, moved by minutes, results, role and contract | In | WORLD_SPEC.md §2.1 |
| Promises and player conversations | Playing-time and role promises; short one-to-one chats; unhappy players ask for a trade | In | WORLD_SPEC.md §2.1 |
| Team hierarchy, social groups, cohesion | — | Out | |
| Injuries and fitness | Injuries with an expected return, fatigue, a "rest him this game" choice; medical staff lower the risk | In | WORLD_SPEC.md §2.2 |
| Detailed medical centre (risk %, rehab plans) | — | Out | |

### 3.3 Recruitment

| FM feature | Hoop Manager | Status | Where |
|---|---|---|---|
| Scouting with uncertain ratings | Ranges that narrow with scouting, never to zero; scouts by region; shortlist | In | WORLD_SPEC.md §6 |
| Youth intake | European club academies, US colleges, a two-round draft with lottery | In | WORLD_SPEC.md §5 |
| Contracts and free agency | Yearly wage, 1–4 years, free agency days | In | WORLD_SPEC.md §7 |
| Contract clauses | **Release clause, team or player option on the last year, simple bonuses** | In | WORLD_SPEC.md §7.3 |
| Transfers | One market for trades and transfers; AI clubs with plans; readable refusals | In | WORLD_SPEC.md §8 |
| Loans | — | Out | |
| Agents | — | Out | |

### 3.4 The club

| FM feature | Hoop Manager | Status | Where |
|---|---|---|---|
| Board, budgets, objectives | Board sets wage and transfer budgets and a season objective; you don't run the books | In | WORLD_SPEC.md §10–11 |
| Manager influence on the club | **Sponsor choice, shoe/kit deal (fictional brands), facility and arena requests, hiring and firing staff** | In | WORLD_SPEC.md §9, §10.3 |
| Staff | Assistant, development coach, fitness/medical, scouts | In | WORLD_SPEC.md §9 |
| Ticket prices, owner-level finance, building an arena yourself | — | Out | |

### 3.5 World and competitions

| FM feature | Hoop Manager | Status | Where |
|---|---|---|---|
| Top league | **Big League**: America conference (18) + Europe conference (12) | In | WORLD_SPEC.md §1 |
| Leagues with promotion and relegation | America: Divisions 2–4. Europe: **national leagues in 11 countries** (2 tiers each; Portugal 1 tier) | In | WORLD_SPEC.md §1 |
| Countries | Spain, Italy, France, Germany, Greece, Türkiye, Israel, Lithuania, Serbia, the Netherlands, **Portugal** | In | WORLD_SPEC.md §1 |
| Playoffs | **America conference NBA style** (play-in, best-of-7), **Europe conference EuroLeague style** (play-in, best-of-5, Final Four), both unchanged from the real leagues, then **one Final game, America v Europe** | In | WORLD_SPEC.md §1.1 |
| Continental + domestic double schedule | **Dual competition:** the 12 European Big League clubs also play their national league | In | WORLD_SPEC.md §1 |
| Entry to the top European level | **10 licences + 2 wildcards** earned each season; a licence is lost after a third bottom-2 finish | In | WORLD_SPEC.md §1.2 |
| Domestic cups | **One national cup per European country + one America Cup**, ending in a Final Four weekend | In | WORLD_SPEC.md §1.1 |
| Club names | Real city + fictional nickname | In | WORLD_SPEC.md §1.3 |
| Intercontinental cup, All-Star weekend | — | Out | |
| National teams, international management | — | Out | |

### 3.6 Media and story

| FM feature | Hoop Manager | Status | Where |
|---|---|---|---|
| News inbox | News feed after every matchday | In | WORLD_SPEC.md §12 |
| Press conferences | **Rare press moments** (2–3 questions) only at big events: playoffs, trade deadline, rivalry games | In | WORLD_SPEC.md §12 |
| Regular press conferences, social media feed | — | Out | |
| Awards, history, Hall of Fame | | In | WORLD_SPEC.md §12 |

### 3.7 Modes and platform

| FM feature | Hoop Manager | Status |
|---|---|---|
| Career | Career mode (WORLD_SPEC.md) | In |
| Quick start | Friendly match stays. **Quick League is removed once Career is playable** | Built |
| Network / hot-seat multiplayer | — | Out |
| Pre-game database editor | — | Out *(not discussed; assumed)* |
| Touch (tablet) | Every screen works by touch; every keyboard shortcut has a button | In |
| Phone layout | — | Out |
| Translations | Dutch, Portuguese | Later |

---

## 4. Later list

1. **Play designer** (draw your own plays). Needs its own balance-lab check.
2. **Translations** (Dutch, Portuguese).

---

## 5. Assumptions (questions the owner skipped)

On training, squad dynamics and media the owner gave no answer. These are the recommended options
and stay until the owner says otherwise:

- **Training:** a weekly team focus plus one development focus per player.
- **Squad dynamics:** morale, promises and short player chats. No hierarchy or social groups.
- **Media:** news feed plus rare press moments at big events.

---

## 6. What these choices cost (sanity check, 18 Nov 2026)

| | Before (WORLD_SPEC 17 Nov) | After this scope |
|---|---|---|
| Clubs | 126 | **about 318** (66 America + 252 Europe) |
| People at the start | about 2,800 | **about 6,650** |
| Games per season, whole world | about 2,100 | **about 4,700** |
| Engine speed (Node, measured) | "400 games/s" (assumed) | **about 160 games/s** (`npm run lab`, 1,000 games in 6.2 s) |
| Fast-forward a whole season | under 30 s | **about 30 s in Node, about 1 minute in the browser** |
| One matchday | — | about 100 games, **under 1 s** |

1. **Season time.** A European Big League club plays about 70 games (40 Big League, 22 national,
   playoffs, cup); an American one about 45. With real NBA best-of-7 playoffs a deep American run
   adds up to 28 games; a European club that goes deep plays 85–90, as real EuroLeague clubs do
   (WORLD_SPEC.md §17.1). At 5–8 minutes a watched game, watching everything takes
   6–9 hours. The 2–4 hour target only works if you watch about a third of the games live, so the
   game needs **"key game" flags** (rivals, top-of-table, cup ties, playoffs) and a
   **"simulate to the next key game"** button.
2. **Full (82-game) schedule** no longer fits the 2–4 hour target or the European double schedule.
   It is dropped.
3. **Cities.** Lithuania, Israel, Serbia and the Netherlands don't have 24 basketball cities each.
   Big cities may host two clubs (two different nicknames).
4. **Population.** With 252 academies, the youth intake per club must be lower than first planned or
   the world overfills; the world lab checks it.
5. **Portugal** was added as an eleventh country (one tier) so Lisbon and Porto have clubs. The UK
   is not in the world, so London drops out.
