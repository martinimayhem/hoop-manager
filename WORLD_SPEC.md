# Hoop Manager: World and Career Spec

> The career mode: a living basketball world of about 300 clubs in America and ten European
> countries, with promotion and relegation, national leagues and cups, scouting, a draft, free
> agents, trades, youth development, staff, facilities and money. You manage one club for as many seasons as you like, Football Manager
> style. For career mode this document replaces SEASON_SPEC.md Parts 3–12 (the 48-club Career)
> and SPEC.md §8. The **Quick League** (SEASON_SPEC.md Part 2, built) and the friendly match stay as
> they are. One player against the computer (SPEC.md §1).

Status: design for approval. Nothing here is built yet. **Revised 18 Nov 2026** to match the scope
decisions in [SCOPE.md](SCOPE.md) (European national leagues, dual competition, cups, contract
clauses, training, promises, club levers, tablet).

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
8. **You are coach and general manager in one**, as in Football Manager (SCOPE.md §2).
9. **A season takes 2–4 hours.** You watch the key games live and simulate the rest; every system
   is designed so that it still works when most games are simulated.

---

## 1. World structure

### 1.1 Competitions

| Level | America | Europe | Clubs |
|---|---|---|---|
| Top | **Big League, America conference** (18) | **Big League, Europe conference** (12): 10 licence clubs + 2 wildcards, all of which **also play their national league** | 30 |
| Below the top | US Division 2, 3, 4 (16 clubs each) | **National leagues in 10 countries**, 2 tiers each, 12 clubs per tier | 48 + 240 |
| Cups | **America Cup** (all 66 American clubs) | **One national cup per country** (its 24 clubs) | |
| | | **Total** | **about 306 clubs** (66 + 240) |

**Countries:** Spain, Italy, France, Germany, Greece, Türkiye, Israel, Lithuania, Serbia and the
Netherlands.

- **Big League** is one competition with two conferences: **America** (18) and **Europe** (12).
  Europe is part of the top league, not a tier below it.
- **Big League schedule (40 games):** every team plays every other team once (29 games), plus 11
  extra games against teams in its own conference. Settings: **Short (30)** or **Standard (40)**.
  *(The Full 82-game option is dropped: it breaks the 2–4 hour season and the European double
  schedule.)*
- **Big League playoffs:** 16 clubs: the top 16 by record, with at least 4 from each conference.
  Round 1 best-of-3, quarter-finals and semi-finals best-of-5, final best-of-7. (Kept short so a
  season fits in a few evenings.)
- **US Divisions 2–4:** double round-robin (30 games); the champion is promoted, places 2–5 play a
  single-game knockout for the second promotion spot.
- **European national leagues:** tier 1 and tier 2 in each country, 12 clubs each, double
  round-robin (22 games). Tier 1 ends with a **national playoff** (top 8; quarter-finals and
  semi-finals best-of-3, final best-of-5 *(tune)*) for the national title. Tier 2: the champion is
  promoted and places 2–5 play off for the second spot.
- **Dual competition:** the 12 European Big League clubs play both. **Big League games are
  midweek, national-league and cup games at the weekend**, so they play about 70 games a season
  against about 45 for an American Big League club. Rotation, fatigue and injuries (§2.2) are what
  make this a real choice: rest players in one competition to win the other.
- **Cups:** single-game knockouts, drawn at random, lower-tier club at home *(tune)*. Big League
  clubs enter in the last 16. They are the giant-killing stories of the season.
- **Key games:** derbies, top-of-the-table games, cup ties and playoffs are marked as key games.
  "Simulate to the next key game" is how a season stays inside 2–4 hours (§3).

### 1.2 Promotion, relegation, licences and wildcards

Movement stays **within a region**: America ↔ America, and inside each European country.

| Between | Down | Up |
|---|---|---|
| Big League (America) ↔ US Division 2 | Bottom 2 America clubs | Division 2 champion + playoff winner |
| US Division 2 ↔ 3, 3 ↔ 4 | Bottom 2 | Champion + playoff winner |
| US Division 4 | No relegation | — |
| Big League (Europe) | **No relegation for the 10 licence clubs.** The 2 wildcards are earned again every season | The 2 best national-league seasons among clubs without a licence (national champions first, then national-league record) *(tune)* |
| National tier 1 ↔ tier 2 (each country) | Bottom 2 (licence clubs are exempt; the next club drops instead) | Tier 2 champion + playoff winner |

**Licences (proposal, tune):** Spain 2, Türkiye 2, Greece 1, Italy 1, France 1, Germany 1,
Israel 1, Lithuania 1. Serbia and the Netherlands reach the Big League through wildcards.

**Parachute payments:** a club relegated from a tier, or a wildcard club that drops out of the Big
League, keeps 50% of the gap in TV money the first season and 25% the second, so dropping hurts but
doesn't destroy a club.

### 1.3 Places, clubs and colleges

- **Cities:** real cities: big American metros, and basketball cities in the ten European countries
  (for example Madrid, Barcelona, Málaga, Istanbul, Athens, Belgrade, Kaunas, Vilnius, Tel Aviv,
  Milan, Bologna, Paris, Berlin, Munich, Amsterdam, Groningen). Bigger and more famous basketball
  cities start higher, with exceptions so some can start lower and climb. **A big city may host two
  clubs** (different nicknames); the smaller countries need it to fill 24 places.
- **Clubs:** city name + **fictional nickname** (for example *Groningen Northmen*). A blocklist
  rejects any real NBA, WNBA, G League, EuroLeague, EuroCup or national-league club name.
- **Colleges:** about 40 fictional US colleges tied to real cities and regions, so players can find
  one near them (for example *Sacramento Valley University*). Real college names are trademarks, so
  a blocklist rejects real NCAA Division I names.
- **Every club** has: city, country, nickname, colours, arena (name, capacity), reputation, budget,
  fan base size, facilities, staff, a sponsor and a shoe/kit deal (§10.3), a youth set-up (§5) and
  history.

### 1.4 People

| Group | Count at start | Notes |
|---|---|---|
| Club rosters (13 each) | about 3,980 | 306 × 13 |
| Free agents | about 400 | Old, cheap, or between clubs |
| College players | about 600 | 40 colleges × 15; seniors enter the draft |
| European academy players | about 1,440 | 240 European clubs × 6, aged 15–18 |
| **Total** | **about 6,400** | |

New people each season: about 150 college freshmen and an academy intake of **1–3 per European
club** (more with a better academy) *(tune)*, about 550 new names a season, so **about 12,000 unique
names over 10 seasons**. About 270 players a season must move up into club basketball (draft picks,
undrafted signings, academy graduates) to match retirements; most academy players never make a
first team, as in real life. The world lab checks that the population stays stable (§13).

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

### 2.1 Morale, promises and player chats

- **Morale** moves with minutes against what the player expects, results, his role and his contract,
  and has a small, measured effect on court (SEASON_SPEC.md R12.4).
- **Promises:** when signing, extending or calming a player you can promise **playing time**
  (starter / rotation / bench) or a **role** (for example "first option on offence"). A kept promise
  lifts morale; a broken one drops it hard and is remembered at contract time.
- **Player chats:** short one-to-one conversations (2–3 choices) when something happens: unhappy
  about minutes, wants a new contract, wants to leave. Every answer shows its likely effect.
- **Unhappy players ask for a trade.** Nothing deeper: no team hierarchy, social groups or cohesion
  meter (SCOPE.md §3.2).

### 2.2 Injuries, fatigue and rest

- **Injuries** happen between games, never inside one (the engine is not changed), with an expected
  return (SEASON_SPEC.md R8.1–R8.2). Risk grows with minutes, fatigue and injury proneness; the
  fitness and medical coach and the medical centre lower it.
- **Fatigue carries over** between games. Clubs with more games (European Big League clubs, cup runs)
  get tired.
- **Rest:** you can mark a player **"rest this game"**. He recovers fatigue and lowers his injury
  risk, at the cost of that game. AI clubs rest players too, mostly in the competition that matters
  less to them.

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
  6. Development jump (season-end growth/decline)   7. Board objectives, sponsor and kit offers
  8. Wildcards and licences confirmed   9. New season
```

- **Matchdays** are simulated in a background worker: your game is played live (or simulated, your
  choice); all other games in the world are simulated instantly.
- **Two kinds of matchday:** Big League games midweek, national-league and cup games at the
  weekend (§1.1). American lower divisions play at the weekend.
- **"Continue" buttons:** next matchday, next game of your team, **next key game** (§1.1), to the
  trade deadline, to the end of the regular season, to the end of the season.
- **Season time:** a season of 45–70 games for your club, watching about a third of them live, takes
  2–4 hours.
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

### 4.1 Training

- **Team focus** each week: one of *shooting*, *defence*, *conditioning*, *playmaking*, *rest*.
  It gives a small boost to that area's growth and to readiness for the next games; *rest* lowers
  fatigue.
- **Individual focus** per player: one attribute group to develop (for example *3-point shooting*
  or *post defence*), or a **new position** to learn.
- That's all. No session-by-session planner (SCOPE.md §3.2). The development coach and the
  training centre decide how strong the effect is.

---

## 5. Youth: colleges, academies, the draft

### 5.1 US colleges (draft pipeline)
- 40 colleges, each with about 15 players (freshman to senior, 18–22).
- College seasons are simulated as **stats only** (no full matches): points, rebounds, assists per
  game, influenced by ability and the college's level.
- Seniors (and early entrants with high potential) enter the draft.

### 5.2 European academies (club pipeline)
- Every European club has an academy of about 6 players aged 15–18.
- **Yearly intake:** 1–3 new 15-year-olds per club *(tune, see §1.4)*, more and better with a
  better academy facility.
- At 18 a player graduates to the first team or is released; an under-18 can be called up early if
  he's ready.
- US clubs have no academy; they rely on the draft and free agency. That's the real-world
  difference between the regions, and it gives both a distinct way to build.

### 5.3 The draft
- **Two rounds, 30 picks each,** Big League clubs only (the 12 European ones of that season
  included). All other clubs sign undrafted players as free agents.
- **Lottery:** the 14 non-playoff Big League clubs, weighted towards the worst records (the top 4
  picks are drawn, then the rest go in reverse order of record).
- **Picks can be traded** (up to 3 seasons ahead).
- **Rookie contracts:** fixed wage by pick number, 3 years (first round) or 2 years (second round).
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

### 7.3 Contract clauses

Three clauses only, each explained in one line on the contract screen:

| Clause | What it does |
|---|---|
| **Release clause** | Another club can sign the player by paying this fee; his club can't refuse. Players ask for one at smaller clubs. |
| **Team option / player option** | On the last year only: the club (or the player) decides before the offseason whether that year happens. |
| **Bonuses** | A one-off payment for a goal: playoffs, an award, a number of games played. Paid from the wage budget. |

No buyouts, no trade kickers, no salary-matching rules (§16).

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

Staff have ratings (1–20), wages and contracts, and come from a staff market. **You hire and fire
them** within the staff part of the wage budget; firing costs the rest of the contract. Better staff
cost more, which competes with player wages for the same budget.

---

## 10. Money and facilities

### 10.1 Budget and wages
Money is in fictional **dollars**. Each season the board sets a **wage budget** and a **transfer
budget** from the club's income.

| Income | Depends on |
|---|---|
| TV money | Tier (equal share within a tier) |
| Ticket sales | Arena capacity × attendance × ticket price |
| Sponsorship and shoe/kit deal | Reputation, success, and the deal you picked (§10.3) |
| Prize money | Final position and playoffs |
| Sales | Players sold |

| Spending | |
|---|---|
| Player and staff wages | The biggest cost |
| Facilities | Upkeep and upgrades |
| Transfers | Fees paid |

**Rough scale per tier** (to be tuned by the world lab): Big League wage budgets $60–140M
(European Big League clubs add their national-league income), US Division 2 $12–30M, Division 3
$3–10M, Division 4 $0.8–3M; European national tier 1 (no licence) $6–25M, tier 2 $1–5M. Promotion raises income a lot, so the
first season up is a real challenge, as in real life.

### 10.2 Facilities

| Facility | Effect |
|---|---|
| Training centre | Development speed |
| Youth academy (Europe) / college scouting network (US) | Better intake / better draft information |
| Medical centre | Injury risk and recovery |
| Arena | Capacity, so ticket income |

Upgrades are **requested from the board** (§10.3), cost money and take a season to complete. Their effect follows the **average of the last
three seasons**, so a club can't buy excellence overnight. (Idea from ZenGM's budget system.)

---

### 10.3 What you decide about the club

You don't run the books: the board does. You influence the club through four choices:

| Lever | How it works |
|---|---|
| **Sponsor** | Each summer pick one of 2–3 offers: more money with tougher targets, or less money with easy ones. Missing a target lowers next year's offers. |
| **Shoe and kit deal** | Pick a fictional brand (a blocklist rejects real ones). Bigger brands pay more and make the club more attractive to young players and free agents. |
| **Facilities and arena** | Ask the board for a training-centre, academy, medical-centre or arena upgrade. It says yes, not yet, or no, with the reason (money, results, its trust in you). |
| **Staff** | Hire and fire within the staff budget (§9). |

## 11. The board and your career

- Each season the board sets an **objective**: win the title, make the playoffs, avoid relegation,
  get promoted, or develop young players, based on the club's size and squad.
- **Job security** rises and falls with results against that objective.
- **If you're sacked**, you get offers from other clubs (often a tier lower) and your career goes on.
  Sacking is **optional**: a **"Can't be sacked"** switch is shown when you start a career and can be
  changed later.
- **Job offers and moving:** clubs that fit your reputation approach you; you can also apply for an
  open job, in America or in any of the ten countries.
- **Manager reputation** grows with success and decides which clubs want you.
- **Starting a career:** pick any club. A "climb from Division 4" start is the classic challenge.

---

## 12. Living world: news, awards, history

- **News feed** after every matchday: results, injuries, transfers, milestones (first
  triple-double, career highs), streaks, rumours, board comments.
- **Press moments:** at big events only (playoffs, the trade deadline, a rivalry game, a sacking
  rumour) a journalist asks 2–3 questions. Your answer moves player morale or board trust a little,
  and the effect is shown. No regular press conferences, no social media feed.
- **Awards:** player of the matchday, monthly awards, season awards (MVP, Rookie of the Year,
  Defensive Player, Most Improved, Coach of the Year), All-League teams. Per tier.
- **Cups and national titles** count in history and in board objectives.
- **History:** champions and promotions per season, records (single game, season, career),
  club history pages, player career pages, a **Hall of Fame**.

---

## 13. The world lab (health checks)

`npm run world-lab -- --seasons 20` simulates a whole world headlessly, without humans, and reports:

| Check | Target |
|---|---|
| Different Big League champions in 20 seasons | At least 6; no club wins more than 5 |
| National champions | In each country, at least 4 different champions in 20 seasons |
| Wildcards | At least 6 different clubs hold a Big League wildcard in 20 seasons |
| Dual competition | European Big League clubs finish a season with fatigue and injuries within the target band *(tune)*; resting is used by the AI |
| Rating inflation | League-average overall within ±2 points of season 1 after 20 seasons |
| Population | Active players within ±5% of the start; retirements ≈ new players |
| Average age per tier | 25–28 |
| Finances | No club below zero money for 2 seasons running; no Division 4 club with a Big League wage bill |
| Promotion | Promoted clubs survive their first season at least 40% of the time |
| Free agency | At least 90% of the top-100 free agents sign somewhere |
| AI-to-AI trades | Value difference within 10% on average |
| Exploit bot | A bot sends 1,000 lopsided trade offers; the AI accepts fewer than 2% |
| Speed | One matchday under 1 second in the browser; a whole season fast-forwarded in under 90 seconds in the browser |

Every slice must keep these checks green, or explain why a target needs to change.

---

## 14. Technical design

- **Engine unchanged:** career matches use the same match engine. AI games use `simulateMatch`.
  **Measured 2026-11-18:** `npm run lab` plays 1,000 games in 6.2 s, about **160 games a second**
  in Node (the earlier figure of 400 a second was too optimistic). A world season is about **4,500
  games** (Big League about 650, US Divisions 2–4 about 720, 20 national leagues about 2,850 with
  playoffs, cups about 300): about 30 s in Node and about a minute in the browser when
  fast-forwarded, about 100 games (under 1 s) per matchday. If that is too slow, the first lever is
  a faster engine path for AI games, not a shortcut formula (SEASON_SPEC.md: every AI game uses the
  full engine).
- **Regional rules (built):** Europe's games use FIBA rules, a player out on his 5th foul; America's
  NBA rules, out on his 6th (`MatchRules`, tests/rules.test.ts). National leagues and national cups:
  FIBA. Big League playoffs: NBA rules.
- **Tablet:** every screen works by touch at tablet size (from about 768 px wide); every keyboard
  shortcut (timeout, pause) has an on-screen button. The 3D view must keep a usable frame rate on a
  mid-range tablet, or fall back to 2D. Phone layouts are out (SCOPE.md).
- **English only**, but all screen text kept in one place so translations can be added later.
- **Background worker:** all world simulation runs in a Web Worker so the screen never freezes.
- **Saves in IndexedDB**, not localStorage: after 10 seasons a world holds about 12,000 players with
  career records, roughly 20–25 MB, far beyond localStorage's typical limit. Several save slots.
- **Save versioning:** every save has a format version and migrations, so updates never break an
  old career.
- **Deterministic:** a world seed generates the world; every match stores its seed.
- **What is stored:** full box scores for your club's games and the playoffs; for other games, the
  result plus per-player season totals. That keeps saves small.
- **Data model (main entities):** World, Season, Country, Competition (league, cup, Big League),
  Licence, Club, Player, Contract (with clauses), Promise, Staff, Sponsor, College, DraftPick, Deal,
  NewsItem, Award, Record.

---

## 15. Build slices

Each slice is designed in detail, built on its own branch, tested (unit tests + world lab),
**played**, and merged before the next one.

| Slice | What | Playable when done |
|---|---|---|
| **W1 Foundation** | World generator (10 countries + America, cities, clubs, licences, colleges, players with nationalities, names with blocklists), data model, IndexedDB saves, background worker, browse screens (competitions, clubs, players), tablet-ready layout | You can create a world, save it, load it and look around, on desktop and tablet |
| **W2 One season** | Midweek/weekend calendar, schedules for the Big League, US divisions, national leagues and cups, standings, key games, your matches live or simulated, everything else simulated, playoffs, promotion/relegation, wildcards, season summary | You can play a full season with any club in 2–4 hours |
| **W3 Years go by** | Aging, development, training focus, retirement, contract expiry and AI re-signing, rollover to the next season; squad life: morale, promises, player chats, injuries, fatigue and rest; world lab over 20 seasons | You can play season after season, and rotation matters |
| **W4 Talent pipeline** | Colleges, academies, draft lottery and draft, rookie contracts | You can draft and grow your own players |
| **W5 Free agency** | Contracts, wage demands, extensions, contract clauses, free agency days | You can build through free agency |
| **W6 Trades** | AI club plans, valuation, trade screen, "what would you want?", trade deadline, AI-to-AI deals | You can trade, and the AI is hard to exploit |
| **W7 The club** | Staff (phase 4) with hiring and firing, facilities and board requests, money, sponsor and shoe/kit deals, board objectives, sacking and job offers | Money and staff are real decisions |
| **W8 Scouting 2.0** | Scouts by region, narrowing ranges, shortlist | Finding hidden talent is a skill |
| **W9 Living world** | News, press moments, awards, records, history, Hall of Fame, career pages | The world tells stories |

The engagement features in SPEC.md's roadmap (Daily Clutch, match feel, achievements) can be
slotted in between slices.

---

## 16. Out of scope (for now)

The full list, against Football Manager, is in [SCOPE.md](SCOPE.md). In short:

- Salary cap, luxury tax, aprons, salary matching in trades; buyouts and trade kickers.
- Loans and player agents.
- Intercontinental cup, All-Star weekend, international tournaments and national teams.
- Multiplayer of any kind: online, hot-seat, team codes. One player against the computer.
- Pre-game and post-game team talks, touchline shouts, a data hub; regular press conferences and a
  social media feed.
- Team hierarchy, social groups, cohesion; a detailed medical centre.
- Ticket prices and owner-level finance.
- Phone layouts; languages other than English (translations later).
- Real people, real club names, real college names, real brands, real logos.
- **Later:** a play designer (draw your own plays).

## 17. Open questions

1. **Season length default:** 40 Big League games plus, for European clubs, 22 national-league
   games. Keep Standard (40) as the default, or make Short (30) the default for European clubs?
2. **Tier sizes:** 16-team US divisions (30 games) and 12-team national tiers (22 games). Right?
3. **Draft for lower divisions:** Big League only (as above), or a combined draft where lower tiers
   pick after the Big League?
4. **Women's basketball:** a separate world later?
5. **"Can't be sacked": on or off by default** when a career starts? (Decided: sacking is optional.
   SEASON_SPEC.md left firing out so nothing feels like pressure on a young player.)
6. **The Big League Finals.** SEASON_SPEC.md had America v Europe Finals between the two conference
   champions; §1.1 here has one top-16 playoff. Which?
7. **Relegated clubs and the draft (§5.3).** Relegation is fixed before the draft, so the worst
   American Big League clubs go down. Do they keep their lottery picks? And a European club that
   loses its wildcard?
8. **Money.** Wages here are in millions of dollars; prices today are 1–40 credits. One conversion
   rule (or drop credits for career mode).
9. **Licences:** is the proposal in §1.2 right (Spain 2, Türkiye 2, one each for Greece, Italy,
   France, Germany, Israel, Lithuania)? Can a licence ever be lost (for example after three bottom
   finishes)?
10. **Portugal and the UK.** They are not among the ten countries, so Lisbon and London (in the
    earlier city list) are no longer in the world. Add Portugal as an eleventh country (one tier)?
11. **Cup format:** single games throughout, or a two-legged semi-final and a Final Four weekend?
12. **Currency in Europe:** keep dollars everywhere for simplicity, or euros in Europe?

Resolved on 18 Nov 2026 (SCOPE.md): the Full (82) schedule for Europe (dropped); cup competitions
(national cups in, intercontinental out); hot-seat (out).

## 18. References (inspiration and licences)

| Source | Licence | Used for | How |
|---|---|---|---|
| [open-football](https://github.com/ZOXEXIVO/open-football) | Apache 2.0 | League schedule, table, standings, season flow, awards, news, academy, development, happiness, finance, transfers | Read the specs under `openspec/specs/core/`; ideas and wording may be adapted with credit in a NOTICE file |
| [nba-sim](https://github.com/OorjitSethi/nba-sim) | No licence | Club plans with slow-changing direction, valuation by club plan, scouting ranges that narrow with a floor, draft classes of varying strength, free-agent decision factors, offseason order | **Ideas only.** No code or text copied |
| [ZenGM / Basketball GM](https://basketball-gm.com) | Source-available, not open source | Facilities effect from a multi-season average, draft lottery feel | **Ideas only**, as a player of the game. No code opened or copied |
| Football Manager 2024 | Commercial | Overall feel of the career mode, board, staff, news; the scope map in SCOPE.md | Played reference only |
| Hoop Land | Commercial | Depth and readability ceiling for a basketball career | Played reference only |
