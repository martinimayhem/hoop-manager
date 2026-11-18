# Hoop Manager: World and Career Spec

> The career mode: a living basketball world of 128 clubs in the US and Europe, with
> promotion and relegation, scouting, a draft, free agents, trades, youth development, staff,
> facilities and money. You manage one club for as many seasons as you like, Football Manager
> style. For career mode this document replaces SEASON_SPEC.md Parts 3–12 (the 48-club Career)
> and SPEC.md §8. The **Quick League** (SEASON_SPEC.md Part 2, built) and the friendly match stay as
> they are. One player against the computer (SPEC.md §1).

Status: approved design, being built slice by slice (§15). W1 is built.

---

## 0. Principles

1. **Close to the real world, but fictional.** Real cities, fictional clubs, fictional people.
   Retirements, drafts, free agency, scouting, playoffs and relegation work the way a fan expects.
2. **Relatable.** A player can find a club in or near their own city, and a college near them.
3. **Deep but readable.** Every system is understandable by a 13-year-old basketball fan. Depth
   comes from systems interacting, not from rules to memorise. **No salary cap, luxury tax,
   aprons or debt.** Money is a club budget plus yearly wages.
4. **Fair play** (SPEC.md §1): no paid random packs, no energy timers, no pay-to-win, no
   guilt-driven streaks.
5. **The engine decides, the screens explain.** Every number the player sees (a scout range, a
   wage demand, a trade refusal) has a reason they can read.
6. **A healthy world over many seasons.** No rating inflation, no permanent dynasties, no club
   going broke by accident. Checked by the world lab (§13), not by hoping.
7. **Built in slices** (§15). Each slice is playable and merged before the next one starts.

---

## 1. World structure

### 1.1 Competitions

| Tier | US | Europe | Teams | Season |
|---|---|---|---|---|
| 1 | **Big League**, America Conference (16) | **Big League**, Europe Conference (16) | 16 + 16 | 40 games (default) + playoffs |
| 2 | US Division 2 | Euro Division 2 | 16 + 16 | 30 games + promotion playoffs |
| 3 | US Division 3 | Euro Division 3 | 16 + 16 | 30 games + promotion playoffs |
| 4 | US Division 4 | Euro Division 4 | 16 + 16 | 30 games + promotion playoffs |
| | | **Total** | **128 clubs** | |

- **The world is US against Europe** (decided 2026-11-18). Each region has the same pyramid: a
  16-club conference of the Big League and three divisions of 16 below it, 64 clubs a region; every
  league in the world has 16 clubs. The
  Big League is one competition with two equal conferences, **America** and **Europe**, and its
  Finals are always **America v Europe**.
- **Every club plays the same number of games, US or Europe** (decided 2026-11-18):

  | Setting | Conference games | Against the other conference | Total |
  |---|---|---|---|
  | Short | 30 (each conference rival twice) | 0 | 30 |
  | **Standard (default)** | 30 (each rival twice) | 10 (10 of the 16 once, a different 6 left out each season) | **40** |
  | Full | 60 (each rival 4 times) | 22 (6 of the 16 twice, 10 once) | 82 |

  Divisions 2–4: double round-robin, 30 games, in both regions.
- **Big League playoffs: each conference its own, then the Finals.** The top 8 of each conference:
  quarter-finals best-of-3, semi-finals best-of-5, conference final best-of-5. The two conference
  champions meet in the **Finals, America v Europe, best-of-7**; home court to the better
  regular-season record. (Kept short so a season fits in a few evenings.)
- **Rules follow the place:** a game in Europe uses FIBA rules, a game in America NBA rules (§14);
  the Finals use NBA rules.
- **Divisions 2–4:** the champion is promoted, places 2–5 play a single-game knockout for the
  second promotion spot.

### 1.2 Promotion and relegation

Promotion and relegation stay **within a region**, so the US/Europe split of the Big League
never changes.

| Between | Down | Up |
|---|---|---|
| Big League ↔ Division 2 | Bottom 2 US clubs, bottom 2 European clubs | Each Division 2 champion + playoff winner |
| Division 2 ↔ 3, 3 ↔ 4 | Bottom 2 | Champion + playoff winner |
| Division 4 | No relegation | — |

**Parachute payments:** a relegated club keeps 50% of the tier gap in TV money the first season
and 25% the second, so relegation hurts but doesn't destroy a club.

### 1.3 Places, clubs and colleges

- **Cities:** 128 real cities: big US metros plus European basketball cities (for example Madrid,
  Barcelona, Istanbul, Athens, Belgrade, Kaunas, Vilnius, Milan, Bologna, Paris, Berlin, Munich,
  London, Amsterdam, Lisbon). Bigger cities start in higher tiers, with exceptions so famous
  basketball cities can start lower and climb.
- **Clubs:** city name + **fictional nickname** (for example *Lisbon Navigators*). A blocklist
  rejects any real NBA, WNBA, G League, EuroLeague, EuroCup or national-league club name.
- **Colleges:** about 40 fictional US colleges tied to real cities and regions, so players can find
  one near them (for example *Sacramento Valley University*). Real college names are trademarks, so
  a blocklist rejects real NCAA Division I names.
- **Every club** has: city, nickname, colours, arena (name, capacity), reputation, budget, fan base
  size, facilities, staff, a youth set-up (§5) and history.

### 1.4 People

| Group | Count at start | Notes |
|---|---|---|
| Club rosters (13 each) | 1,664 | 128 × 13 |
| Free agents | about 200 | Old, cheap, or between clubs |
| College players | about 600 | 40 colleges × 15; seniors enter the draft |
| European academy players | about 385 | 64 European clubs × 6, aged 15–18 |
| **Total** | **about 2,850** | |

New people each season: about 150 college freshmen, about 180 academy intake and about 80
international prospects. That is about 410 new names a season, so **about 7,000 unique names over
10 seasons**. Every club drafts (§5.3), so about 250 players a season are drafted (two regional drafts), plus the academy
graduates clubs keep, against about 180 retirements: clubs cut to 13, and a released player who
stays unsigned for a whole season leaves the world (he retires or goes to play elsewhere, in the
news). The world lab's population check keeps this within ±5% (§13); class sizes are tuned in W4.

- **The 102 parody stars** (players.json) are the Big League's established stars at the start.
- **Everyone else is generated** with a **nationality**: names from per-country first-name and
  surname lists (US, Spain, Serbia, France, Lithuania, Greece, Türkiye, Italy, Germany, Portugal,
  the Netherlands and more). A blocklist of well-known real players rejects exact matches. This
  replaces the pun-surname generator for career mode (still fine for the Quick League).
- **The generator must guarantee uniqueness and can never loop forever** (today's `journeymen()`
  can, see SPEC.md §3.3).

---

## 2. Players

Everything in SPEC.md §3 stays: the 15 attributes (1–99), position, archetype, height and weight.
Career mode adds:

| Field | Purpose |
|---|---|
| Age, birth year | Development, aging, retirement |
| Nationality, hometown | Names, relatability, hometown-club preference in free agency |
| Origin | College, academy or "international"; shown on the player page |
| Potential | Already exists (hidden; scout estimate only) |
| Personality: professionalism, ambition, loyalty, temperament (1–20) | Development speed, free-agency choices, contract talks, technicals |
| Morale (very low → superb) | Playing time, results, role, contract |
| Form | Last 5 games; small effect on the engine |
| Reputation (local → global) | Wage demands, transfer value, interest from clubs |
| Contract | Yearly wage, years left, rookie contract yes/no |
| Injury | Status (available / day-to-day / out), expected return |
| Career record | Per-season totals, awards, clubs |

**Overall rating** (one number) is shown alongside the attribute groups for quick reading; it is
a weighted sum by position and never used by the engine.

---

## 3. Season calendar

```
Preseason ── Regular season ──┬── Trade deadline (≈ 60% of the season) ──┬── Playoffs
                              │                                           │
                         Transfer window                           End of season:
                         (closes at deadline)                      awards, promotion/relegation
                                                                          │
Offseason, in this order:                                                 ▼
  1. Retirements   2. Draft lottery and draft   3. Contract expiries and extensions
  4. Free agency (two weeks of game days)       5. Academy intake and college freshmen
  6. Development jump (season-end growth/decline)   7. Board objectives   8. New season
```

- **Matchdays** are simulated in a background worker: your game is played live (or simulated, your
  choice); all other games in the world are simulated instantly.
- **"Continue" buttons:** next matchday, next game of your team, to the trade deadline, to the end
  of the regular season, to the end of the season.
- **Saves** happen automatically after every matchday and every offseason step (§14).

---

## 4. Development, aging and retirement

- **Growth happens in two places:** small steps after every matchday (driven by minutes played,
  training focus and the development coach) and a bigger **season-end jump** in the offseason.
- **Age curves per attribute group:** athletic attributes (speed, dunking, stamina) peak around
  25–27 and decline from about 29; skill and brain attributes (shooting, passing, IQ) peak around
  28–31 and decline later and slower.
- **Potential is a ceiling, minutes are the key.** A young player gets most of the way to his
  potential through training; the last part only comes with real minutes.
- **Variance:** some players boom, some bust. Two players with the same numbers at 19 can end up
  very differently. The scout's potential estimate stays an estimate.
- **Personality:** professionalism speeds growth and slows decline; ambition helps a young player
  push for minutes.
- **Retirement:** from age 33, likelier with low ability, low minutes or a serious injury; very few
  play past 40. Legends get a retirement news item and their career page stays.

---

## 5. Youth: colleges, academies, the draft

### 5.1 US colleges (draft pipeline)
- 40 colleges, each with about 15 players (freshman to senior, 18–22).
- College seasons are simulated as **stats only** (no full matches): points, rebounds, assists per
  game, influenced by ability and the college's level.
- Seniors (and early entrants with high potential) enter the draft.

### 5.2 European academies (club pipeline)
- Every European club has an academy of about 6 players aged 15–18.
- **Yearly intake:** 2–4 new 15-year-olds per club, better with a better academy facility.
- At 18 a player graduates to the first team, or his club lets him go and he enters the draft; an
  under-18 can be called up early if he's ready.
- US clubs have no academy; they build through the draft and free agency. European clubs draft too,
  and also have their own academy. That's the real-world difference between the regions, and it
  gives both a distinct way to build.

### 5.3 The draft
*(Decided 2026-11-18: US draft rules, and every club in every division of both regions drafts.)*
- **One draft per region, two rounds, all 64 clubs of that region** (128 picks each). The US
  class: college seniors and early entrants. The European class: academy graduates whose club let
  them go, and international prospects. About 145 a class, so the last pick still has a choice.
  Undrafted prospects become free agents.
- **Order, US style: the weakest pick first.** Tiers go from the bottom up: Division 4 first, then
  3, then 2, then the region's Big League conference, worst record first. Round 2
  repeats the order. A club picks by the tier it **played in** this season, so a relegated club picks
  among the Big League clubs and a promoted one among its old division.
- **A lottery in each tier** (US style), for its top 4 picks: among that tier's clubs that missed
  its playoffs (promoted clubs never), the worst three with equal odds, nobody dropping more than 4
  places. It takes the reward out of losing on purpose, which matters most in Division 4, where
  nobody can be relegated. Every draw is shown, with each club's chances.
- **Picks can be traded** (up to 3 seasons ahead).
- **Rookie contracts:** fixed wage by pick number, in the club's currency (§10). First round: 3
  years. Second round: 2 years, not guaranteed until the season starts (the club can release him
  before then at no cost).
- **Draft classes vary:** some years are deep, some weak; generational talents are rare.

---

## 6. Scouting

- Every player outside your club is shown with **ranges**, as today: well-known players with
  narrow ranges, unknowns with wide ones.
- **Scouts** (staff, §9) are assigned to a **region**: US colleges, Europe, free agents, or a
  specific opponent.
- Each scouting look **narrows the range** around the true value, but never below a minimum width,
  because a young player's future is genuinely uncertain.
- **Draft and academy prospects** carry the most uncertainty; established Big League players the
  least.
- A **shortlist** lets you follow players; your scouts prioritise them.

---

## 7. Contracts and free agency

### 7.1 Contracts
- A contract is a **yearly wage** for **1–4 years**. There is no salary cap: the limit is your
  club's wage budget (§10).
- **Wage demand** comes from the player's value (ability, potential, age), reputation and the
  tier of the club he'd join. Better clubs can pay less to stars who want to win.
- **Extensions:** in the last year of a contract you can offer an extension. The player says yes,
  no, or asks for more, and always says why ("wants a bigger role", "wants a contender").
- **Releasing a player** costs his remaining wage for the current season.

### 7.2 Free agency
- Players with expiring contracts become free agents in the offseason (step 4 of §3).
- **Two weeks of game days:** clubs make offers; each day some players decide.
- **A player chooses** by: wage compared with his value, contract length, expected role and
  minutes, club quality and tier, hometown and nationality, and loyalty to his current club.
- Unsigned free agents can be signed during the season too, for cheaper.

---

## 8. Trades and transfers

One market for both regions: a deal moves **players, draft picks and/or money** between clubs.
European fans know it as a transfer, US fans as a trade.

- **Windows:** the offseason and the season until the **trade deadline**.
- **Every AI club has a plan:** *contend*, *compete*, *retool* or *rebuild*, based on its roster,
  record, age and money. The plan changes slowly, not after one bad week.
- **AI valuation:** each player (and pick) has a value from ability, potential, age, contract and
  injury, **weighted by the receiving club's plan** (a rebuilding club pays more for youth and
  picks, a contender for ready players).
- **The AI accepts** only if what it receives is worth at least what it gives, plus a margin, and
  the deal fits its needs and budget.
- **Readable refusals:** "We need a centre in return", "That doesn't help us win now", "Too
  expensive for our budget".
- **"What would you want for him?"** The AI proposes packages it would accept, so trading isn't
  guesswork.
- **AI-to-AI deals** happen a few times per season, so the world moves without you.
- **Anti-exploit:** no repeated small "value farming" trades; the AI remembers recent deals with
  you; the world lab tests it (§13).

---

## 9. Staff (SPEC.md phase 4)

| Role | Count | Effect |
|---|---|---|
| Head coach | You | Your tactics and decisions |
| Assistant coach | 1 | Small boost to in-game adjustments and tactic familiarity |
| Development coach | 1–2 | Faster growth of young players, slower decline of veterans |
| Fitness and medical | 1 | Fewer and shorter injuries, better stamina recovery |
| Scouts | 1–4 | More players scouted per week, narrower ranges |

Staff have ratings (1–20), wages and contracts, and come from a staff market. Better staff cost
more, which competes with player wages for the same budget.

---

## 10. Money and facilities

### 10.1 Budget and wages
*(Decided 2026-11-18.)* **US clubs count in dollars ($), European clubs in euros (€).** One fixed
exchange rate in the game data, **€1 = $1.10**, never changes during a career. Every amount is shown in
your club's own currency; where the two regions meet (a transfer between them, a free agent choosing
between continents, Finals prize money) both amounts are shown. The Quick League keeps its credits.

Each season the board sets a **wage budget** and a **transfer budget** from the club's income.

| Income | Depends on |
|---|---|
| TV money | Tier (equal share within a tier) |
| Ticket sales | Arena capacity × attendance × ticket price |
| Sponsorship | Reputation and success |
| Prize money | Final position and playoffs |
| Sales | Players sold |

| Spending | |
|---|---|
| Player and staff wages | The biggest cost |
| Facilities | Upkeep and upgrades |
| Transfers | Fees paid |

**Rough scale per tier** (to be tuned by the world lab), the same in value in both regions:

| Tier | US wage budget | Europe wage budget |
|---|---|---|
| Big League | $60–140M | €55–127M |
| Division 2 | $12–30M | €11–27M |
| Division 3 | $3–10M | €2.7–9M |
| Division 4 | $0.8–3M | €0.7–2.7M |
 Promotion raises income a lot, so the
first season up is a real challenge, as in real life.

### 10.2 Facilities

| Facility | Effect |
|---|---|
| Training centre | Development speed |
| Youth academy (Europe) / college scouting network (US) | Better intake / better draft information |
| Medical centre | Injury risk and recovery |
| Arena | Capacity, so ticket income |

Upgrades cost money and take a season to complete. Their effect follows the **average of the last
three seasons**, so a club can't buy excellence overnight. (Idea from ZenGM's budget system.)

---

## 11. The board and your career

- Each season the board sets an **objective**: win the title, make the playoffs, avoid relegation,
  get promoted, or develop young players, based on the club's size and squad. At the end of the
  season it says in plain words how it went.
- **You can't be sacked** (decided 2026-11-18): no job-security meter, no dismissal, in any setting.
  A bad season is a disappointed board, never the end of your career at the club.
- **Manager reputation** grows with success. Other clubs may offer you their job; you choose,
  and can always say no.
- **Starting a career:** pick any club. A "climb from Division 4" start is the classic challenge.

---

## 12. Living world: news, awards, history

- **News feed** after every matchday: results, injuries, transfers, milestones (first
  triple-double, career highs), streaks, rumours, board comments.
- **Awards:** player of the matchday, monthly awards, season awards (MVP, Rookie of the Year,
  Defensive Player, Most Improved, Coach of the Year), All-League teams. Per tier.
- **History:** champions and promotions per season, records (single game, season, career),
  club history pages, player career pages, a **Hall of Fame**.

---

## 13. The world lab (health checks)

`npm run world-lab -- --seasons 20` simulates a whole world headlessly, without humans, and reports:

| Check | Target |
|---|---|
| Different Big League champions in 20 seasons | At least 6; no club wins more than 5 |
| America v Europe | Each region wins between 7 and 13 of 20 Finals (averaged over worlds) |
| Draft in every tier | A Division 4 club's first-round picks become regulars there as often in the US as in Europe |
| Rating inflation | League-average overall within ±2 points of season 1 after 20 seasons |
| Population | Active players within ±5% of the start; retirements ≈ new players |
| Average age per tier | 25–28 |
| Finances | No club below zero money for 2 seasons running; no Division 4 club with a Big League wage bill |
| Promotion | Promoted clubs survive their first season at least 40% of the time |
| Free agency | At least 90% of the top-100 free agents sign somewhere |
| AI-to-AI trades | Value difference within 10% on average |
| Exploit bot | A bot sends 1,000 lopsided trade offers; the AI accepts fewer than 2% |
| Speed | A full season of the whole world simulates in under 30 seconds in the browser |

Every slice must keep these checks green, or explain why a target needs to change.

---

## 14. Technical design

- **Engine unchanged:** career matches use the same match engine. AI games use `simulateMatch`
  (measured 2026-11-17: about 2.5 ms a game in Node, 400 games a second; a full season is about
  2,100 games, so about 5 seconds in Node and roughly 10 in the browser, spread across matchdays).
- **Regional rules (built):** Europe's games use FIBA rules, a player out on his 5th foul; America's
  NBA rules, out on his 6th (`MatchRules`, tests/rules.test.ts). Big League playoffs: NBA rules.
- **Background worker:** all world simulation runs in a Web Worker so the screen never freezes.
- **Saves in IndexedDB**, not localStorage: after 10 seasons a world holds about 6,000 players with
  career records, roughly 10 MB, beyond localStorage's typical limit. Several save slots.
- **Save versioning:** every save has a format version and migrations, so updates never break an
  old career.
- **Deterministic:** a world seed generates the world; every match stores its seed.
- **What is stored:** full box scores for your club's games and the playoffs; for other games, the
  result plus per-player season totals. That keeps saves small.
- **Data model (main entities):** World, Season, Competition, Club, Player, Contract, Staff,
  College, DraftPick, Deal, NewsItem, Award, Record.

---

## 15. Build slices

Each slice is designed in detail, built on its own branch, tested (unit tests + world lab),
**played**, and merged before the next one.

| Slice | What | Playable when done |
|---|---|---|
| **W1 Foundation** ✅ (2026-11-18, branch `world-w1`) | World generator (cities, clubs, colleges, players with nationalities, names with blocklists), data model, IndexedDB saves, background worker, browse screens (tiers, clubs, players) | You can create a world, save it, load it and look around |
| **W2 One season** | Calendar, schedules for all tiers, standings, your matches live or simulated, everything else simulated, playoffs, promotion/relegation, season summary | You can play a full season in any tier |
| **W3 Years go by** | Aging, development, retirement, contract expiry and AI re-signing, rollover to the next season; world lab over 20 seasons | You can play season after season |
| **W4 Talent pipeline** | Colleges, academies, draft lottery and draft, rookie contracts | You can draft and grow your own players |
| **W5 Free agency** | Contracts, wage demands, extensions, free agency days | You can build through free agency |
| **W6 Trades** | AI club plans, valuation, trade screen, "what would you want?", trade deadline, AI-to-AI deals | You can trade, and the AI is hard to exploit |
| **W7 The club** | Staff (phase 4), facilities, money ($ and €), board objectives, job offers | Money and staff are real decisions |
| **W8 Scouting 2.0** | Scouts by region, narrowing ranges, shortlist | Finding hidden talent is a skill |
| **W9 Living world** | News, awards, records, history, Hall of Fame, career pages | The world tells stories |

The engagement features in SPEC.md's roadmap (Daily Clutch, match feel, team codes,
achievements) can be slotted in between slices.

---

## 16. Out of scope (for now)

- Salary cap, luxury tax, aprons, salary matching in trades (a "realistic rules" option could come
  later).
- Loans, cup competitions, international tournaments and national teams.
- Online multiplayer and hot-seat: one player against the computer (SPEC.md §1).
- Real people, real club names, real college names, real logos.
- Player agents, press conferences, detailed medical diagnoses.

---

## 17. Open questions

1. **Season length default:** 40 games keeps a season to a few evenings if you play every game.
   Is that right, or should Full (82) be the default?
2. **Tier sizes:** 16-team lower divisions give 30-game seasons. Enough?
3. **Women's basketball:** a separate world later?

Decided 2026-11-18 (where this design differed from SEASON_SPEC.md):

- **The board:** you can't be sacked (§11).
- **US v Europe:** two equal 16-club conferences (16 clubs in every league), America v Europe Finals (§1.1).
- **The draft:** US rules (worst first, lotteries), every club in every division drafts, one draft per region (§5.3).
- **Games:** every club plays the same number, US or Europe (§1.1).
- **Money:** dollars for US clubs, euros for European clubs, at a fixed rate (§10.1).

---

## 18. References (inspiration and licences)

| Source | Licence | Used for | How |
|---|---|---|---|
| [open-football](https://github.com/ZOXEXIVO/open-football) | Apache 2.0 | League schedule, table, standings, season flow, awards, news, academy, development, happiness, finance, transfers | Read the specs under `openspec/specs/core/`; ideas and wording may be adapted with credit in a NOTICE file |
| [nba-sim](https://github.com/OorjitSethi/nba-sim) | No licence | Club plans with slow-changing direction, valuation by club plan, scouting ranges that narrow with a floor, draft classes of varying strength, free-agent decision factors, offseason order | **Ideas only.** No code or text copied |
| [ZenGM / Basketball GM](https://basketball-gm.com) | Source-available, not open source | Facilities effect from a multi-season average, draft lottery feel | **Ideas only**, as a player of the game. No code opened or copied |
| Football Manager 2024 | Commercial | Overall feel of the career mode, board, staff, news | Played reference only |
| Hoop Land | Commercial | Depth and readability ceiling for a basketball career | Played reference only |
