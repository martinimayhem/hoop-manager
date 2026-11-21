# Hoop Manager: World and Career Spec

> The career mode: a living basketball world of about 320 clubs in America and eleven European
> countries, with promotion and relegation, national leagues and cups, scouting, a draft, free
> agents, trades, youth development, staff, facilities and money. You manage one club for as many seasons as you like, Football Manager
> style. For career mode this document replaces SEASON_SPEC.md Parts 3–12 (the 48-club Career)
> and SPEC.md §8. The **Quick League** (SEASON_SPEC.md Part 2, built) stays until Career is playable
> and is then removed (decided 18 Nov 2026); the friendly match stays. One player against the computer (SPEC.md §1).

Status: design for approval. Nothing here is built yet. **Revised 18 Nov 2026** to match the scope
decisions in [SCOPE.md](SCOPE.md) (European national leagues, dual competition, cups, contract
clauses, training, promises, club levers, tablet) and the owner's answers on the conflicts
(Portugal, licences, sacking default, NBA/EuroLeague-style playoffs, Final Four cups, money).

---

## 0. Principles

1. **Close to the real world, but fictional.** Real cities, fictional clubs, fictional people.
   Retirements, drafts, free agency, scouting, playoffs and relegation work the way a fan expects.
2. **Relatable.** A player can find a club in or near their own city, and a college near them.
3. **Deep but readable.** Every system is understandable by a 13-year-old basketball fan. Depth
   comes from systems interacting, not from rules to memorise. **Money follows the real world in
   a simplified form** (changed 18 Nov 2026): a salary cap ("NBA-lite") for the America Big League
   clubs, a club budget with buyouts everywhere else, and a payroll threshold for the European Big
   League clubs ([GAME_FLOW.md](GAME_FLOW.md) §4). No debt. Every refused move explains itself.
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
| Below the top | US Division 2, 3, 4 (16 clubs each) | **National leagues in 11 countries**: 10 with 2 tiers of 12, Portugal with 1 tier of 12 | 48 + 252 |
| Cups | **America Cup** (all 66 American clubs) | **One national cup per country** (its 24 clubs; Portugal 12) | |
| | | **Total** | **about 318 clubs** (66 + 252) |

**Countries:** Spain, Italy, France, Germany, Greece, Türkiye, Israel, Lithuania, Serbia, the
Netherlands (2 tiers each) and **Portugal** (1 tier, added 18 Nov 2026 so a player in Portugal has
a club near home).

- **Big League** is one competition with two conferences: **America** (18) and **Europe** (12).
  Europe is part of the top league, not a tier below it.
- **Big League schedule (40 games):** every team plays every other team once (29 games), plus 11
  extra games against teams in its own conference. Settings: **Short (30)** or **Standard (40)**.
  *(The Full 82-game option is dropped: it breaks the 2–4 hour season and the European double
  schedule.)*
- **Big League playoffs, per conference, then a Final** (decided 18 Nov 2026: follow the real NBA
  and EuroLeague):
  - **America conference, NBA style:** places 1–6 qualify; places 7–10 play the **play-in** (7 v 8:
    the winner is seed 7; the loser plays the winner of 9 v 10 for seed 8). Then three rounds of
    **best-of-7**: first round, conference semi-finals, conference final.
  - **Europe conference, EuroLeague style:** places 1–6 qualify; places 7–10 play the same play-in.
    Then **best-of-5** quarter-finals and a **Final Four** weekend at one venue (single-game
    semi-finals and final).
  - **Both conferences use the real rules unchanged**, including EuroLeague's play-in for places
    7–10 with only 12 clubs (10 of 12 go on; decided 18 Nov 2026).
  - **Big League Final: one single game**, America champion v Europe champion. **The hosts
    alternate** (decided 19 Nov 2026): Europe hosts in even seasons under FIBA rules, America in odd
    seasons under NBA rules, in a big arena of the host region. This is the only addition to the real
    NBA and EuroLeague formats.
  - *Watch-out:* an American champion can play up to 28 playoff games plus the Final; a European club
    that goes deep in everything about 85–90 games a season, as real EuroLeague clubs do.
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
- **Cups:** single-game knockouts, drawn at random, the lower-tier club at home *(tune)*, until four
  clubs are left; then a **Final Four weekend** at one venue (semi-finals and final). They are the
  giant-killing stories of the season. Formats (decided 19 Nov 2026):
  - **America Cup (66 clubs): everyone enters in round 1.** A preliminary game between the 4
    lowest-placed Division 4 clubs of last season makes it 64; then rounds of 64, 32 and 16,
    quarter-finals and the Final Four. A Big League club can lose to a Division 4 side in round 1.
  - **National cups (24 clubs):** round 1 for the 16 lowest-placed clubs (8 winners); the last 16
    adds the 8 best tier-1 clubs of last season (Big League clubs among them); then quarter-finals
    and the Final Four. **Portugal (12):** round 1 for the 8 lowest (4 winners) with the top 4 in the
    quarter-finals, then the Final Four.
- **Key games** (decided 19 Nov 2026): **every play-in, playoff and Final game**, **cup ties from the
  quarter-finals on** (Final Four included), and **season deciders**: the last 5 regular-season games
  when your club is within 2 wins of a playoff, play-in, promotion or relegation line. Only your own
  games. "Simulate to the next key game" stops on them; it is how a season stays inside 2–4 hours.

### 1.2 Promotion, relegation, licences and wildcards

Movement stays **within a region**: America ↔ America, and inside each European country.

| Between | Down | Up |
|---|---|---|
| Big League (America) ↔ US Division 2 | Bottom 2 America clubs | Division 2 champion + playoff winner |
| US Division 2 ↔ 3, 3 ↔ 4 | Bottom 2 | Champion + playoff winner |
| US Division 4 | No relegation | — |
| Big League (Europe) | **No relegation for the 10 licence clubs**, but a licence is **lost after a club's third bottom-2 finish** in the Europe conference *(counted over the last 5 seasons, tune)*. The 2 wildcards are earned again every season | The 2 best national-league seasons among clubs without a licence, Portugal included (national champions first, then national-league record) *(tune)*. A lost licence goes to that season's best wildcard club |
| National tier 1 ↔ tier 2 (each country) | Bottom 2 (licence clubs are exempt; the next club drops instead) | Tier 2 champion + playoff winner |
| Portugal | One tier: no promotion or relegation | — |

**Licences (agreed 18 Nov 2026):** Spain 2, Türkiye 2, Greece 1, Italy 1, France 1, Germany 1,
Israel 1, Lithuania 1. Serbia, the Netherlands and Portugal reach the Big League through wildcards
(and can win a licence when one is lost).

**Parachute payments:** a club relegated from a tier, or a wildcard club that drops out of the Big
League, keeps 50% of the gap in TV money the first season and 25% the second, so dropping hurts but
doesn't destroy a club.

### 1.3 Places, clubs and colleges

- **Cities:** real cities: big American metros, and basketball cities in the eleven European countries
  (for example Madrid, Barcelona, Málaga, Istanbul, Athens, Belgrade, Kaunas, Vilnius, Tel Aviv,
  Milan, Bologna, Paris, Berlin, Munich, Amsterdam, Groningen, Lisbon, Porto). Bigger and more famous basketball
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
| Club rosters (13 each) | about 4,130 | 318 × 13 |
| Free agents | about 400 | Old, cheap, or between clubs |
| College players | about 600 | 40 colleges × 15; seniors enter the draft |
| European academy players | about 1,510 | 252 European clubs × 6, aged 15–18 |
| **Total** | **about 6,650** | |

New people each season: about 150 college freshmen and an academy intake of **1–3 per European
club** (more with a better academy) *(tune)*, about 550 new names a season, so **about 12,000 unique
names over 10 seasons**. About 280 players a season must move up into club basketball (draft picks,
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

Everything in SPEC.md §3 stays: the **21 attributes** (1–99, five groups; decided 20 Nov 2026, built in
slice E1), position, archetype, height and weight. Every attribute has an engine job and a season's
stats must show it (SPEC.md §3.1b).
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
Offseason, in this order (screens and decisions per step: GAME_FLOW.md §3.7):                                                 ▼
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
- **America only** (decided 18 Nov 2026, as in the real world): **the 18 America Big League clubs,
  2 rounds, 36 picks.** European clubs build through academies; all other clubs sign undrafted
  players as free agents. Entrants: US college players and international free agents aged 19–22.
- **Relegated clubs keep their picks** (decided 18 Nov 2026): a pick belongs to the season it was
  earned in, so a club relegated to Division 2 still drafts. A relegated club with the #1 pick is a
  rebuild story.
- **Lottery:** the 10 America clubs that miss the playoffs, weighted towards the worst records (the
  top 4 picks are drawn, then the rest go in reverse order of record).
- **Live draft room** with an auto-pick option (GAME_FLOW.md §3.7).
- **Picks can be traded** (up to 3 seasons ahead).
- **Rookie contracts:** fixed wage by pick number, 3 years (first round) or 2 years (second round).
- **Draft classes vary:** some years are deep, some weak; generational talents are rare.

---

## 6. Scouting

- Every player outside your club is shown with **ranges**, as today: well-known players with
  narrow ranges, unknowns with wide ones. Until scouts arrive (W8) a range is never wider than ±2 for
  your own league, ±4 for your own region, ±6 otherwise (GAME_FLOW §6.4, decided 21 Nov 2026).
  Stats are public and never ranges.
- **Scouts** (staff, §9) are assigned to a **region**: US colleges, Europe, free agents, or a
  specific opponent.
- Each scouting look **narrows the range** around the true value, but never below a minimum width,
  because a young player's future is genuinely uncertain.
- **Draft and academy prospects** carry the most uncertainty; established Big League players the
  least.
- A **shortlist** lets you follow players; your scouts prioritise them.

---

## 7. Contracts and free agency

### 7.0 Contract expiry first version (decided 20 Nov 2026, built in W2b)

Contracts run out from W2b on, before full free agency (W5). This is the simple version; W5 builds
on it and does not replace it.

- **Every contract has an end season** and counts down at each new season. A contract with no years
  left expires at the rollover. Development-squad players' contracts roll on unchanged for now.
- **Your players:** when the regular season ends, an inbox message lists your players whose contract
  is expiring. Before the new season a **contract screen** (a Continue stop) asks, per player:
  **offer a new deal** (years within §7.1's limits, yearly wage) or **let him go**. The player
  answers yes, no, or asks for a higher wage you can accept, always with a one-line reason. He
  decides on wage compared with his demand (§7.1) and on last season's playing time.
  **The screen shows each player's interest and demand before you offer** (decided 21 Nov 2026, as
  in Football Manager): per player his interest in staying (keen / interested / reluctant / won't
  consider, with its reason; §7.1) and his yearly wage demand, his current wage, age,
  overall and last season's minutes, and what the new deal leaves of your cap room or budget. The
  offer starts at his demand; while you lower it, the screen says what he will answer (yes / asks
  for his demand from 85% / no below 85%) before you send it. He accepts any length within §7.1's
  limits; wishes about contract length come in W5.
- **Contract talks at any time, as in Football Manager** (moved into W2b on 21 Nov 2026; the
  owner: "similar dynamics to FM"):
  - **Offer a new contract** to any of your players at any time, from the player page's contract
    panel and the squad table. Same screen as re-signing: his interest in staying, his demand, and
    what he will answer while you set the offer. The new deal replaces the current one from that
    day. While under contract he never accepts less than his current wage, and in the first 12
    months after signing he won't talk unless he asked for it ("only just signed").
  - **He asks for a new contract** when his demand to stay is at least 1.3 × his wage and he has
    2+ seasons left (checked at the rollover and at mid-season): an inbox decision ("wants a new
    contract": **open talks** or **refuse**). Refusing is remembered: −10 on his interest in
    staying until he gets a new deal (W3 adds the morale effect).
  - **Release a player** at any time: he becomes a free agent, and his remaining wages keep
    counting against your cap or wage budget until his contract would have ended (otherwise a
    club could sign long contracts and drop them for free).
  - **Last-year reminder:** at the start of a season an inbox message (news, not a decision) lists
    your players in the last year of their contract.
  - **AI clubs** extend their 8 best players in their last year at mid-season, when the player
    would consider staying and the money rules allow it.
  - **Still later:** other clubs approaching your players (buyout offers, pre-contracts in the
    last year) and transfer listing (W6); clauses and wishes about length (W5).
- **Money when re-signing your own players:**
  - **Cap system (America Big League):** you may go over the cap to re-sign **your own** player (a
    simple form of Bird rights), up to the hard ceiling (1.34 C). Without this, a club over the cap
    could never keep its stars. Other signings need cap room or are minimum contracts. Full Bird
    rules, the mid-level and buyouts stay in W5.
  - **Budget system (everyone else):** the new payroll must fit the club's wage budget; a club already
    over it (after promotion or relegation) can only offer minimum deals (1% of
    its budget, §7.1).
- **AI clubs decide automatically:** an AI club re-signs an expiring player if he is among its 10 best
  players and his demand fits its money rules above; otherwise he leaves.
- **Free-agent list:** players nobody re-signs join the existing free agents (§1.4). The list shows
  each player's interest in your club and his demand; players who won't consider your club can be
  shown (filter) but not offered a deal, and the screen says why. After the
  re-signing step, **you sign first** (free-agent screen, a Continue stop), then every AI club below
  13 players fills up with the best free agent it can afford, worst-placed club first. A free agent
  accepts an offer at or above his demand.
  **Fallback** (decided 21 Nov 2026): a club still below 13 that can't afford any free agent at his
  demand signs, at its minimum deal, the free agent **with the lowest demand** among those who would
  consider the club, never the best one. A good player never takes a minimum deal: he stays a free
  agent (in-season signings come in W5).
- **You can't start a season below 13 players.** The new-season step stays blocked with "sign *n* more
  players" and an **Auto-fill** button that signs the best affordable free agents for you.
- **Not in this version (W5):** offers from several clubs, free-agency days, clauses, extensions
  during the season, in-season free-agent signings.

### 7.1 Contracts
- A contract is a **yearly wage**: **1–5 years** in the cap system (America Big League), **1–3
  years** in the budget system, where every contract also has a **buyout fee**. The limits come
  from the cap or the club budget (GAME_FLOW.md §4).
- **Wage demand** comes from the player's value (ability, potential, age), reputation and the
  tier of the club he'd join. Better clubs can pay less to stars who want to win. The formula
  (decided 21 Nov 2026, first built in W2b for §7.0; W5 builds on it):

  **Two steps: first, will he consider the club at all (interest); then, what does he ask
  (demand).** A Division 4 club can't sign a superstar however much it offers: he won't talk to
  it. Interest was added on 21 Nov 2026 (owner: "more sophisticated").

  **Step 1: interest.** First a hard **league floor** (added 21 Nov 2026): a player won't consider
  a club whose league prestige (table below) is under **standing − 55 − 3 × (years over 30)**,
  whatever else the club offers ("won't play below a first-tier league", "won't play in Division
  4"). A superstar in his prime (standing 95+) therefore never plays in a second tier or US
  Divisions 3–4, even at home; an ageing star can still step down. Personality and home soften how
  he rates a club, never the level he plays at.

  Then every player rates a club he could join (or stay at) from 0 to 100:

  | Factor | Weight | 0 … 100 |
  |---|---|---|
  | **League prestige** | 30 | Big League America 100, Big League Europe 90, US Division 2 45, 3 25, 4 10; a European first tier 0.7 × the country's fame (about 42–63), second tier 0.35 × fame |
  | **Club reputation** | 20 | The club's reputation (1–99) |
  | **Success** | 15 | Last season's finish in its league (champion 100, last 0), titles count as first; during a season, half last season and half the current table |
  | **Role** | 15 | Where he'd rank in that squad by overall: starter (top 5) 100, rotation (6–8) 60, bench 20. **At his own club, last season's minutes instead:** 28+ a game 100, 20–28 70, 12–20 40, under 12 10 |
  | **Facilities** | 10 | Training and medical facilities (1–20), × 5 |
  | **Home** | 5 | 100 if the club is in his own country |
  | *His own club only* | + | **Happiness:** morale very low −10, low −5, okay 0, good +5, superb +10. **Loyalty:** + 0.5 × loyalty (1–20) |

  The weights shift with the player and are then scaled back to 100: **under 24** the role counts
  double ("wants minutes"); **30 or older** success counts double ("wants to win"); **ambition
  15+** league prestige × 1.5, **ambition 6 or less** × 0.5.

  **What he requires:** R = 15 + 0.65 × standing − 3 × (years over 30) + 0.5 × (ambition − 10),
  where **standing** (0–100) is half his overall's percentile among all players in the world and
  half his reputation. A club rated:

  | Rating | Interest | Effect |
  |---|---|---|
  | below R − 20 | **Won't consider** | No offer possible, at any wage: "won't consider a Division 4 club", "wants to play in the Big League" |
  | R − 20 to R | **Reluctant** | Demand × 1.25: "you'll have to convince him" |
  | R to R + 10 | **Interested** | Demand × 1 |
  | R + 10 and up | **Keen** | Demand × 0.9: "wants to join a contender", "would love to come home" |

  The reason shown is the factor that helped or hurt most. Checked on 21 Nov 2026 with typical
  players: a 30-year-old superstar is interested in top Big League clubs on both continents,
  reluctant at the worst Big League club, and won't consider a European league or US Division 4;
  a 34-year-old Lithuanian veteran is keen to come home; a 21-year-old prospect prefers a starting
  role in a national league to the bench of a top club; a journeyman is keen everywhere. All
  numbers *(tune)*.

  **Step 2: demand = market wage × league pay level × age and potential × reputation × interest**,
  then limited and rounded:

  1. **Market wage** = e^(a + b × overall). At world creation, `a` and `b` are fitted (least squares
     on ln(wage) against overall) over every first-team contract the generator made, and stored in
     the world; they are never refitted, so wages don't drift. (Measured 21 Nov 2026 on three
     seeds: a ≈ 1.94, b ≈ 0.177, i.e. about ×2.4 for every 5 overall points; it explains 87% of
     the generator's wages.)
  2. **League pay level** of the club he'd join: also measured at world creation and stored, one
     number per league, the average of wage ÷ market wage over that league's first teams (Big
     League America ≈ 1.9, Big League Europe ≈ 1.1, US Divisions 2–4 ≈ 1.3–1.6, European tier 1
     ≈ 1.15, tier 2 ≈ 0.7). A Big League Europe club's league is the Big League.
  3. **Age and potential:** under 25: × (1 + 0.02 × (potential − overall)), at most × 1.2; over 30:
     × (1 − 0.05 × (age − 30)), at least × 0.6. The player knows his own potential (the true value,
     not a scout estimate).
  4. **Reputation** (1–99): × (0.85 + 0.3 × reputation ÷ 99).
  5. **Interest** (step 1): keen × 0.9, interested × 1, reluctant × 1.25.
  6. **Limits:** cap system between the minimum contract (1% of C) and the maximum (30% of C);
     budget system between the club's **minimum deal** (1% of its budget, like a dev-squad wage)
     and 30% of C. Rounded down to a tidy figure.

  Examples before interest (21 Nov 2026 world): a 27-year-old 86 star in Big League America asks the
  maximum ($30M); a 26-year-old 76 starter there about $9.6M; a 22-year-old 74 with potential 84
  at a Big League Europe club about $4.5M; a 33-year-old 72 centre in a European first tier about
  $2.5M; a 24-year-old 62 starter in US Division 4 about $0.5M. All *(tune)*.

- **The same rules for everyone:** AI clubs only offer to players who would consider them, and a
  club that is relegated or has a bad season can lose players who no longer want to stay.
- **Free agents nobody signs** lower R by 10 before the AI clubs' second round of signings (W2b:
  one extra round; W5: step by step over the free-agency days).
- **Answering an offer:** at or above his demand he says yes; from 85% of it he asks for his
  demand; below 85% he says no. Always with a one-line reason from the factor that weighs most
  ("wants a bigger role", "wants to win", "wants more money", "the club can't afford him").
- **New contracts and extensions** at any time, and **releasing** a player: §7.0 (changed 21 Nov
  2026: extensions were only in the last year, and releasing cost only the current season).

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

**Two ways to get a player under contract, as in the real world** (changed 18 Nov 2026; rules in
GAME_FLOW.md §4):
- **Trades** (players, picks, a little cash) **only between America Big League clubs**, with
  salary matching when over the cap.
- **Buyouts** everywhere else: pay the player's buyout fee to his club; he still has to accept your
  offer. America Big League clubs can buy out players from budget-system clubs; budget-system clubs
  can't take players under contract from America Big League clubs.

The rest of this section (AI plans, valuation, refusals) applies to both.

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
them** within the staff budget (outside the cap in America; part of the club budget elsewhere); firing costs the rest of the contract. Better staff
cost more, which competes with player wages for the same budget.

---

## 10. Money and facilities

### 10.1 Budget and wages
Money is in fictional **dollars**, in America and in Europe (decided 18 Nov 2026: one currency,
no exchange rates). Quick League credits disappear with the Quick League. Each season the board
sets your money from the club's income: a **payroll limit** under the cap for America Big League
clubs, **one club budget** (wages, staff, buyouts) for everyone else (GAME_FLOW.md §4).

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
  changed later. **Default: you can be sacked** (decided 18 Nov 2026), as in FM.
- **Job offers and moving:** clubs that fit your reputation approach you; you can also apply for an
  open job, in America or in any of the eleven countries.
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
| Cap and budgets | No America Big League club above the hard ceiling; at most 1/3 pay luxury tax in a season; European clubs over the threshold pay the tax; no budget-system club below zero |
| Attributes show in stats | SPEC.md §3.1b, over every league of a season |
| Interest works | No US Division 4 or European second-tier club ever signs a player of standing 80+; at least 90% of the top-100 free agents still sign somewhere |
| Prices stay stable | Per league, wage ÷ market wage (§7.1) after 20 seasons within ±10% of season 1 *(tune)*; every club keeps 13 players. (Average wage is not the measure: it also moves when better or worse players move between leagues.) |
| League strength stays stable | Average first-team overall per league after 20 seasons within ±2 of season 1 *(tune)*: talent must not drain down or up the pyramid |
| Speed | One matchday under 1 second in the browser; a whole season fast-forwarded in under 90 seconds in the browser |

Every slice must keep these checks green, or explain why a target needs to change.

**Until W3** (decided 21 Nov 2026): nobody retires and no new players arrive, but everyone gets a
year older each season (ages stay real; they are not frozen). The checks that need a living
population (wages stay stable, interest works, average age, population, rating inflation) are
therefore judged **from W3 on**. In W2b the twenty-season run and the three-season run must stay
error-free with squads at 13 and **report**, per league and season, the average wage, the price
(wage ÷ market wage) and the average overall, without failing on them (changed 21 Nov 2026: the
first three-season run showed prices steady but talent flowing down the pyramid, which only youth
and retirements can balance). W3's brief must deal with that flow, including the strength of the
starting free-agent pool.

---

## 14. Technical design

- **Engine unchanged:** career matches use the same match engine. AI games use `simulateMatch`.
  **Measured 2026-11-18:** `npm run lab` plays 1,000 games in 6.2 s, about **160 games a second**
  in Node (the earlier figure of 400 a second was too optimistic). A world season is about **4,700
  games** (Big League about 670 with play-ins and playoffs, US Divisions 2–4 about 720, 21 national
  leagues about 3,000 with playoffs, cups about 310): about 30 s in Node and about a minute in the browser when
  fast-forwarded, about 100 games (under 1 s) per matchday. If that is too slow, the first lever is
  a faster engine path for AI games, not a shortcut formula (SEASON_SPEC.md: every AI game uses the
  full engine).
- **Regional rules (built):** Europe's games use FIBA rules, a player out on his 5th foul; America's
  NBA rules, out on his 6th (`MatchRules`, tests/rules.test.ts). National leagues and national cups:
  FIBA. Big League: America conference NBA, Europe conference FIBA; a game between the conferences
  uses the **home club's** rules; the Final the host's (§1.1).
- **Tablet:** every screen works by touch at tablet size (from about 768 px wide); every keyboard
  shortcut (timeout, pause) has an on-screen button. The 3D view must keep a usable frame rate on a
  mid-range tablet, or fall back to 2D. Phone layouts are out (SCOPE.md).
- **English only**, but all screen text kept in one place so translations can be added later.
- **Background worker:** all world simulation runs in a Web Worker so the screen never freezes.
- **Saves in IndexedDB**, not localStorage: after 10 seasons a world holds about 12,000 players with
  career records, roughly 20–25 MB, far beyond localStorage's typical limit. Several save slots.
- **Saves are compressed** (decided 20 Nov 2026): every save is gzip-compressed with the browser's
  built-in CompressionStream before it is stored. At each rollover, past seasons are cut back to what
  the "What is stored" line below and the W2b brief §7 keep. The target is a save that stays small after 20 seasons;
  `scripts/seasons-check.ts` reports the size per season.
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
| **W1 Foundation** | World generator (11 countries + America, cities, clubs, licences, colleges, players with nationalities, names with blocklists), data model, IndexedDB saves, background worker, browse screens (competitions, clubs, players), tablet-ready layout | You can create a world, save it, load it and look around, on desktop and tablet |
| **W2 One season** (built as W2a: the regular season, `briefs/W2a.md`; W2b: postseason, cups, next season, `briefs/W2b.md`) | Midweek/weekend calendar, schedules for the Big League, US divisions, national leagues and cups (Final Four weekends), standings, key games, play-ins, NBA/EuroLeague-style playoffs and the one-game Final, your matches live or simulated, everything else simulated, playoffs, promotion/relegation, wildcards, season summary; added to W2b on 20 Nov 2026: contract expiry, re-signing and a simple free-agent list (§7.0), compressed saves (§14) | You can play a full season with any club in 2–4 hours |
| **E1 Attributes that matter** (`briefs/E1.md`, added 20 Nov 2026) | The 21 attributes of SPEC.md §3.1, the engine reworked so each one decides real events, the 102 stars and the generator re-rated, saves converted, the stats-show-attributes checks (SPEC.md §3.1b), lopsided blowouts fixed. Comes before W3, because development and aging work per attribute | Players differ the way real players do, and the box score proves it |
| **W3 Years go by** | Aging, development, training focus, retirement (contract expiry moved to W2b, §7.0); squad life: morale, promises, player chats, injuries, fatigue and rest; world lab over 20 seasons | You can play season after season, and rotation matters |
| **W4 Talent pipeline** | Colleges, academies, draft lottery and draft, rookie contracts | You can draft and grow your own players |
| **W5 Free agency** | Both money systems (cap and budget, GAME_FLOW.md §4), contract clauses, buyouts, free agency days, built on §7.0's first version | You can build through free agency |
| **W6 Trades** | AI club plans, valuation, trade screen with salary matching (America), buyout offers (everywhere), "what would you want?", deadline day, AI-to-AI deals | You can trade, and the AI is hard to exploit |
| **W7 The club** | Staff (phase 4) with hiring and firing, facilities and board requests, money, sponsor and shoe/kit deals, board objectives, sacking and job offers | Money and staff are real decisions |
| **W8 Scouting 2.0** | Scouts by region, narrowing ranges, shortlist | Finding hidden talent is a skill |
| **W9 Living world** | News, press moments, awards, records, history, Hall of Fame, career pages | The world tells stories |

The engagement features in SPEC.md's roadmap (Daily Clutch, match feel, achievements) can be
slotted in between slices.

---

## 16. Out of scope (for now)

The full list, against Football Manager, is in [SCOPE.md](SCOPE.md). In short:

- The full NBA rulebook: cap holds, sign-and-trade, aprons other than a hard ceiling, repeater tax,
  two-way contracts, stretch provision, trade kickers (GAME_FLOW.md §4.1). Country tax rates.
- Trades in Europe and a European draft (as in the real world).
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

1. **Playoff length vs the 2–4 hour season.** With real NBA rules an American champion plays up to
   28 playoff games. Accepted as realistic for now; check in play-testing whether "simulate to the
   next key game" keeps a season inside 2–4 hours, and add a shorter-series setting only if it
   doesn't.
2. *(Decided 19 Nov 2026: the licence-loss window is the last 5 seasons; the Final's hosts and rules
   alternate, §1.1.)*

### Decided on 18 Nov 2026

- Default Big League length **40 games for all**; "simulate to next key game" handles the rest.
  Short (30) stays a setting; Full (82) is dropped.
- **Tier sizes:** US divisions 16 clubs (30 games), national tiers 12 clubs (22 games).
- **Draft:** Big League clubs only; **relegated clubs keep their picks**.
- **Women's basketball:** not planned.
- **"Can't be sacked":** off by default (you can be sacked).
- **Playoffs:** the real NBA format in the America conference and the real EuroLeague format in the
  Europe conference (play-in 7–10 even with 12 clubs), then **one single Final game** between the
  two champions. No third-place game.
- **Licences:** Spain 2, Türkiye 2, Greece, Italy, France, Germany, Israel, Lithuania 1 each; lost
  after a third bottom-2 finish.
- **Portugal** added as an eleventh country, one tier of 12; its clubs can earn wildcards.
- **Cups:** single games, then a Final Four weekend.
- **Money:** dollars everywhere. Credits go with the Quick League, which is removed once Career is
  playable.
- Earlier: Full (82) schedule dropped; national cups in, intercontinental cup out; no hot-seat.

## 18. References (inspiration and licences)

| Source | Licence | Used for | How |
|---|---|---|---|
| [open-football](https://github.com/ZOXEXIVO/open-football) | Apache 2.0 | League schedule, table, standings, season flow, awards, news, academy, development, happiness, finance, transfers | Read the specs under `openspec/specs/core/`; ideas and wording may be adapted with credit in a NOTICE file |
| [nba-sim](https://github.com/OorjitSethi/nba-sim) | No licence | Club plans with slow-changing direction, valuation by club plan, scouting ranges that narrow with a floor, draft classes of varying strength, free-agent decision factors, offseason order | **Ideas only.** No code or text copied |
| [ZenGM / Basketball GM](https://basketball-gm.com) | Source-available, not open source | Facilities effect from a multi-season average, draft lottery feel | **Ideas only**, as a player of the game. No code opened or copied |
| Football Manager 2024 | Commercial | Overall feel of the career mode, board, staff, news; the scope map in SCOPE.md | Played reference only |
| Hoop Land | Commercial | Depth and readability ceiling for a basketball career | Played reference only |
