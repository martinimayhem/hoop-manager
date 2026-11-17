# Season and Career — Phase 5 spec (SEASON_SPEC.md)

> Status: **approved** (revision 3, with the decisions of the approval folded in).
> Two modes: **Quick League** (one 8-team season, the first design) and **Career** (a fictional
> 48-club world with tiers, promotion and relegation, a world draft, contracts and seasons that
> follow on). Coaches (phase 4) come after this; every place a coach will matter has a factor that is
> 1.0 until then.
>
> This revision moves contracts, salaries, ageing and season 2 into phase 5 (they were phase 6 in
> SPEC.md §1 and §10). After approval, SPEC.md is updated to match.

## How to read this

Each part has numbered requirements. A requirement says what the game **SHALL** do; each has one or
two **WHEN … THEN …** scenarios written so they can become tests (most are pure logic and can be
unit tests; the few about screens say so). Numbers marked *(tune)* are starting values, checked in
play and in the balance lab, not promises.

**Fixed rules for everything here**
- **The match engine is not changed.** A season only changes what goes *into* a match (who plays,
  ratings after development, a small morale effect). Same teams, plans and seed: same result, as now.
- **Deterministic.** Everything random (draft order lottery, AI decisions, simulated games, injuries,
  development, retirements) comes from the save's seed, so the same save and the same choices give
  the same outcome.
- **Every AI game uses the full engine** (`simulateMatch`), never a shortcut formula.
- **For young fans (13+), no manipulative mechanics** (SPEC.md §1): no timers, no streak rewards that
  punish stopping, no paid or random boosts, no loot-box lottery for the player's own team, no hidden
  penalties. Every effect on a player is shown, with the reason, in plain words. The draft lottery is
  shown in full: who had how many balls, and the draw.

## Where the ideas come from

| Source | What we took | How |
|---|---|---|
| **open-football** (Apache 2.0) | Spec format (requirement + WHEN/THEN); double round-robin, deterministic placement (schedule spec); total order for the table, ending in team id (table spec); form and streaks after each match (standings spec); season end in a fixed order: champion, awards snapshot, frozen table, reset (simulation spec); award ties by best single game, then id, never recorded twice (league awards spec); a bounded news list (news specs); growth needs minutes and is capped by potential (development spec); playing time against expectation drives mood, with a grace period, and unhappy players ask to leave (happiness spec); a window that opens and closes, moves registered only while open (market spec); a club's tier and promotion/relegation between divisions | Ideas and structure, our own text, scaled down. The NOTICE file credits it. |
| **nba-sim** (no licence) | A season hub with "play next / sim to …"; every game keeps its seed and box score, and tables are derived from them; injury states with an expected return, counting from the next game; scouting ranges that narrow with evidence, never to zero; a fixed offseason checklist that ends in archiving the season and making the next schedule | Ideas only. No code or text. |
| **Basketball GM** (not open source) | How a basketball career *feels* to a player: standings with games behind, "out N games" injuries, a short awards list (MVP, DPOY, ROY), a draft lottery shown on screen, re-signing players whose mood decides whether they stay, free agency, retirements in the offseason | Its public, player-facing behaviour only. Its code was not opened. |
| **Hoop Land** | The depth ceiling. Nothing here goes deeper: e.g. no cap sheets, no luxury tax, no scouting budgets | A limit, not a source |
| **Real-world structure** (the two pictures you sent) | America: a pyramid (top league, development league, semi-pro), players arriving from college through a draft. Europe: tiered domestic leagues with promotion and relegation, players coming through club academies, a continental top level | The fictional world keeps both feelings: a draft and colleges for America; academies, promotion and relegation for Europe; a shared top league whose Finals are America v Europe |

---

## Part 1 — Two modes

### R1.1 Choosing a mode
The new-game screen SHALL offer **Quick League** (one season, 8 teams, draft at the start) and
**Career** (the 48-club world, seasons that follow on). Both are one player against the computer
(the two-player hot-seat mode has been removed).

- **WHEN** the player picks Quick League **THEN** the flow is: league → teams → snake draft → season (Part 2).
- **WHEN** the player picks Career **THEN** the flow is: take over a club or create one (Part 3) → season, with no draft at the start.

---

## Part 2 — Quick League (slice 5a)

The first design, kept, with one change: **snake draft only** (the free draft is dropped).

### R2.1 League and budget
Three leagues with their own pool, budget and quality: Street (70 credits), Pro (100), Legends (130)
*(tune)*. Each pool has 140 players (96 for rosters, 44 free agents), at least 26 per position.

- **WHEN** the player picks Pro **THEN** every team's budget is 100 and the Pro pool is used.
- **WHEN** the same league is built twice **THEN** both pools are identical.

### R2.2 Start: choose the league, then the club
*(Changed 2026-11-17: the player no longer drafts.)* A new game starts with the league to start in
(Street, Pro or Legends), then the club to manage: the eight clubs are shown with their squads, how
strong each is, what kind of team it is and its best players. Their squads are put together by the
computer before the player chooses, by the draft below, every pick the AI's. An old save stopped
mid-draft has its draft finished by the computer when it is opened.

- **WHEN** a new league is made **THEN** all eight clubs have full squads and the season is ready to
  start; the player takes over the club he chooses.

The behind-the-scenes draft: 12 rounds, order 1→8 then 8→1, from **one shared pool**, the first-round
order drawn from the seed. At least 2 guards, wings and bigs. The budget rule is
simple and the same for everyone: **keep at least 1 credit for each empty roster spot**. A
**minimum-contract player** (a journeyman made for the purpose, 1 credit, in a position the team
needs) can always be signed, so no team can ever be stuck. The AI is more careful with its money than
the rule asks (its own strategy). The screen shows the latest picks and, if wanted, the signed players
with their teams.

- **WHEN** the draft ends **THEN** every team has 12 players, at least 2 per group, within budget.
- **WHEN** a human spends most of his budget on his first three picks **THEN** on every later turn he
  can still make a pick (from the market or a minimum signing), and the draft finishes.
- **WHEN** a human chooses Auto-draft the rest **THEN** the AI fills his roster and the draft runs on.
- **WHEN** 100 seeded drafts are run **THEN** the weakest team's average top-8 overall is within 6
  points of the league average *(tune)*.

### R2.3 Schedule
Double round-robin by the circle method: 14 matchdays of 4 games, every pair meets once at home and
once away, matchdays 8–14 mirror 1–7, no team has more than 2 home or 2 away games in a row. The same
generator is used for every league in Career.

- **WHEN** a schedule is made **THEN** it has 56 games, each pair meets exactly twice (once home,
  once away), and every team plays once per matchday.

### R2.4 Season hub, live or simulated
One hub between matches: next opponent, table, last results, news, and one main button
("Play matchday 5"), plus "Sim to …": my next match, the trade deadline, the end of the regular
season, the end of the season. The human's match is played live as now, or simulated; a result
stands once played (no re-play). Closing the game during a live match goes back to the start of that
matchday (the last save).

- **WHEN** the player plays matchday 5 **THEN** his match starts with the usual prep screen and the
  other games are simulated when it ends.
- **WHEN** the player simulates his own match **THEN** the AI sets his plan from the prep screen's
  suggestion and the result stands.

### R2.5 Game records, table and tiebreakers
Each game is stored as matchday, home, away, seed, score, overtime, and each player's line (minutes,
points, rebounds, assists, steals, blocks, turnovers, fouls). The table is always derived from the
records. Columns: played, won, lost, win %, games behind, points for and against, difference, last 5,
streak. Rank by wins; ties broken by: (1) head-to-head wins among the tied teams, (2) point
difference among them, (3) overall point difference, (4) points scored, (5) team id, which can never
tie, so the same results always give the same table.

- **WHEN** A and B are both 10–4 and A won both games between them **THEN** A ranks above B.
- **WHEN** the same results are entered in another order **THEN** the table is identical.

### R2.6 Scouting improves as you meet teams
The prep screen's ranges narrow each time the human has played that opponent, never below 6 points
wide *(tune)*.

- **WHEN** the human meets a team for the second time **THEN** its ranges are narrower than the
  first time, and still at least 6 wide.

### R2.7 End of a Quick League
After the playoffs and awards (Part 5) the season summary is shown. A Quick League does not continue
into another season.

- **WHEN** the final is played **THEN** the summary shows the champion and awards, and "New season" starts a new Quick League.

---

## Part 3 — The Career world (slice 5b)

### R3.1 48 clubs, two regions, three tiers
The world SHALL have 48 clubs: 24 in **America**, 24 in **Europe**, each region with 8 clubs in each
of three tiers.

| Tier | America | Europe |
|---|---|---|
| 1 — **Big League** | America Conference (8) | Europe Conference (8) |
| 2 | America Tier 2 (8) | Europe Tier 2 (8) |
| 3 | America Tier 3 (8) | Europe Tier 3 (8) |

Six leagues of 8, each playing the 14-matchday schedule of R2.3, all on the same matchdays.

- **WHEN** a world is created **THEN** it has 48 clubs, 6 leagues of 8, and every club is in exactly one league.

### R3.2 Real cities, invented nicknames
Each club SHALL be a real city with an **invented** nickname and its own colours. No nickname may be a
real professional team's nickname: a test checks every club against a list of real NBA, WNBA, G League,
NFL, MLB, NHL, MLS, EuroLeague and EuroCup nicknames. Each city has a market size (S, M, L, XL) by
population. At the start, the biggest markets are in the Big League.

- **WHEN** the club list is checked **THEN** no nickname matches the real-team list (case and spaces ignored).
- **WHEN** a world is created **THEN** every Big League club has a market of L or XL, and every tier-3 club S or M *(tune)*.

### R3.3 Start: take over a club, or create one
The player SHALL either **take over** any club in any tier, keeping its roster, contracts and budget,
or **create a club**: any city, any name (checked against the real-team list and a word filter) and
colours, replacing a club of his choice in the chosen tier. The new club takes over that club's
roster and contracts; its market size comes from the new city. There is no draft at the start.

- **WHEN** the player takes over a tier-3 club **THEN** he starts with that club's 12 players and its budget.
- **WHEN** the player creates "Rotterdam Kites" in place of a Europe tier-2 club **THEN** that club
  is renamed and recoloured, keeps its roster, and its market size is Rotterdam's.

### R3.5 Each region plays by its own rules
Matches SHALL use the rules of where they are played: **America** (its tiers 2 and 3, and the Big
League's America Conference) by **NBA rules**, a player fouling out on his **6th** foul; **Europe**
(its tiers 2 and 3, and the Big League's Europe Conference) by **FIBA rules**, out on his **5th**. The
**Big League playoffs and the Finals** use NBA rules (6). The rule shows on the prep screen. Quick League
uses NBA rules. Only the foul limit differs for now (the engine's `MatchRules`); the "foul trouble"
point at which a coach sits a player follows it (one foul earlier with 5).

- **WHEN** a Europe Tier 2 match is played **THEN** a player with 5 fouls is out of the game.
- **WHEN** an America Tier 3 match is played **THEN** a player with 5 fouls stays in; with 6 he is out.
- **WHEN** a match is played with NBA rules **THEN** it is the same as before the rules existed (`npm run lab` identical).

### R4.1 A matchday covers the whole world
Each matchday SHALL play all 6 leagues' games (24 games): the human's live, the rest simulated, each
with its own seed from the save seed, season, matchday and game number.

- **WHEN** a matchday is simulated twice from the same save **THEN** every result and box score is identical.
- **WHEN** a matchday's 23 other games are simulated **THEN** it takes under 0.5 s on a normal laptop *(tune)*.

### R4.2 Promotion and relegation
When the playoffs end (Part 5), the next season's tiers SHALL be fixed:
- **Tier 3** (each region): 1st place goes up directly; places 2–5 play a promotion playoff for the
  second spot. Nobody goes down (it is the bottom).
- **Tier 2** (each region): the same two go up; 7th and 8th go down to their region's tier 3.
- **Big League** (each conference): 7th and 8th go down to their **own region's** tier 2.
Every league stays at 8 clubs.

- **WHEN** a season ends **THEN** each region sends 2 clubs up from tier 3 and 2 down from tier 2, 2
  up from tier 2 and 2 down from the Big League, and every league has 8 clubs again.
- **WHEN** a European Big League club finishes 8th **THEN** it plays next season in Europe Tier 2,
  never in America's.

### R4.3 Budgets follow the tier
A club's budget SHALL be, in fixed credits: its **tier base** (Big League 100, Tier 2 75, Tier 3 55)
+ its **market bonus** (S 0, M 5, L 10, XL 15) + a **performance bonus** (R4.5) + a **parachute** if
it was just relegated (R4.4). The new tier counts from the offseason's re-signing step.

- **WHEN** an XL club with no performance bonus is in Tier 2 and was not just relegated **THEN** its budget is 75 + 15 = 90.

### R4.4 Parachute
A relegated club SHALL keep **half the budget it lost** for its first season in the lower tier,
then drop to the full budget of its new tier.

- **WHEN** a club is relegated from the Big League (100) to Tier 2 (75) **THEN** its next season's
  base is 75 + 12.5 = 87.5, and 75 the season after if it stays in Tier 2.
- **WHEN** a club is relegated twice in a row **THEN** each relegation's parachute is half the
  difference between the tier it left and the one it entered, for one season each.

### R4.5 Performance bonus
A club SHALL get a bonus of **0–5 credits** for where it finished, averaged over its last 3 seasons
(fewer at the start of a Career): a finish's points are 5 for a league champion, then down to 0 for
8th, by final place (1st 5, 2nd 4, 3rd 3, 4th 2, 5th 1, 6th–8th 0), with a finish in a higher tier
worth 2 more (capped at 5) *(tune)*.

- **WHEN** a club finished 1st, 3rd and 8th in its last 3 seasons in the same tier **THEN** its
  bonus is (5 + 3 + 0) / 3 = 2.67.
- **WHEN** a Career starts **THEN** every club's performance bonus is computed from the seeded
  starting world (or 0 where there is no history).

---

## Part 5 — Playoffs and awards (slice 5c)

### R5.1 Playoff formats

| League | Format |
|---|---|
| Quick League | Top 4: single-game semis (1 v 4, 2 v 3), single-game final |
| Big League | Each conference's top 4: single-game semis, **best-of-3** conference final; the two conference champions play the **best-of-5 Finals**, America v Europe |
| Tiers 2 and 3 | 1st is champion and promoted. **Promotion playoff** for places 2–5: single-game semis (2 v 5, 3 v 4), single-game final; the winner is promoted |

The higher seed is the home team (in a series: games 1, 3 and 5 at home). *(See open question 1 on
tiers 2–3.)*

- **WHEN** the America final goes 2–0 **THEN** no third game is played.
- **WHEN** the Finals are 2–2 **THEN** game 5 is played at the better-seeded club's home.

### R5.2 Awards are frozen before the playoffs
At the end of matchday 14 the game SHALL freeze the final tables and pick the regular-season awards
from regular-season games only. Playoff awards (Finals MVP) come from the Finals. They are announced
as the first step of the offseason (R7.1).

- **WHEN** a player scores 40 in a playoff game **THEN** the top-scorer award does not change.

### R5.3 The awards
Eligibility: at least 7 regular-season games. Ties go to the better single game, then player id.

| Award | Per | Rule |
|---|---|---|
| **MVP** | league | Highest average game score, ×1.0 for a top-2 team, ×0.95 for 3rd–4th, ×0.9 below |
| **Top scorer** | league | Most points per game |
| **Best defender** | league | Highest average of steals × 2 + blocks × 2 + defensive rebounds × 0.5 *(tune)* |
| **Player of the matchday** | league, each matchday | Highest game score that matchday (playoffs included) |
| **Rookie of the year** | Career, world | Best average game score among first-season players |
| **Finals MVP** | Career | Highest game score total in the Finals, from the winning team |

Game score (a public box-score formula): points + 0.4 × field goals made − 0.7 × field-goal attempts
− 0.4 × missed free throws + 0.7 × offensive rebounds + 0.3 × defensive rebounds + steals + 0.7 ×
assists + 0.7 × blocks − 0.4 × fouls − turnovers.

- **WHEN** two players tie on points per game **THEN** the one with the higher single game wins.
- **WHEN** a matchday is replayed from the same save **THEN** player of the matchday is the same and recorded once.

### R5.4 Season summary and history
After the last playoff game the game SHALL show a summary: champions, promotions and relegations,
final tables, awards, the human's record. In Career, each finished season is kept in a **history**
(champions, tables, awards, each player's season totals) viewable from the hub.

- **WHEN** a Career season ends **THEN** its summary is added to the history, and the history still
  shows season 1 after season 5.

---

## Part 6 — Money and contracts (Career; slice 5d)

### R6.1 Salary is the price, per season
A player's price (today's formula, from ratings and reputation, 1–40) SHALL become his **salary per
season** when he signs. A contract runs **1–4 seasons** and its salary is fixed for the whole contract.

- **WHEN** a player worth 12 signs a 3-season contract **THEN** he earns 12 in each of the 3 seasons, whatever his ratings do.

### R6.2 Salaries fit the budget
A club's total salaries SHALL never exceed its budget, at any moment of a move: signing, re-signing,
trade, draft. There are no cap sheets, no luxury tax and no debt.

- **WHEN** a signing would take a club over its budget **THEN** it is refused, with the reason.

### R6.3 Roster size
A club SHALL have 12 players when a season starts, and 10 to 13 during the offseason
*(tune)*. The rules of R2.2 (at least 2 guards, wings and bigs) hold when the season starts.

- **WHEN** an AI club has 10 players before the new season **THEN** it signs free agents until it has 12.

### R6.4 A relegated club gets under its new budget
A club whose salaries are over its new budget after relegation SHALL get under it before the new
season: by releasing players (they become free agents; their salary stops, no debt) or trading. The
AI does the same, releasing the worst value for money first. The human is told this in the news and
cannot start the season until he is under.

- **WHEN** a relegated club is 8 over its new budget **THEN** the new season cannot start until its salaries are within budget.

---

## Part 7 — The offseason (Career; slice 5d)

### R7.1 A fixed order
After the last playoff game the offseason SHALL run these steps, in this order, each shown on one
screen with a "Next" button (or all at once with "Sim offseason"):

1. **Awards** (R5.3), then the season summary and history (R5.4); promotion and relegation are fixed (R4.2).
2. **Retirements** (R7.2).
3. **Draft lottery** (R7.3).
4. **Draft** (R7.4).
5. **Re-signing** (R7.5).
6. **Free agency** (R7.6).
7. **Development and ageing** (R7.7).
8. **New season**: everyone a year older, new schedules for all 6 leagues, contracts count down a
   season, the history is saved.

- **WHEN** the offseason runs **THEN** the steps happen in exactly this order, and each runs once.

### R7.2 Retirements
Players SHALL retire mostly from 33. The chance per offseason *(tune)* is 15% at 33, +15% per year
after (100% at 39), +20% if his overall is below a tier-3 regular's. Any free agent of 30+ who went a
whole season unsigned retires. A retirement is in the news ("Rex Tipton retires after 14 seasons").

- **WHEN** a 39-year-old is in the offseason **THEN** he retires.
- **WHEN** 1,000 seeded 25-year-olds with good ratings go through the step **THEN** none retire.

### R7.3 Draft lottery
Picks 1–4 SHALL be drawn among the **6 tier-3 clubs that missed the playoffs**: places 6–8 of both
tier-3 leagues, ranked across both regions by win %, then the R2.5 tiebreakers. A promoted club is
never in the lottery. Balls: worst 6, then 5, 4, 3, 2, 1. Four draws without replacement; the other
two clubs follow in record order. No club drops more than 4 places. The draw is shown step by step,
with each club's balls.

- **WHEN** the lottery is drawn **THEN** no club drops more than 4 places from its record order.
- **WHEN** the lottery is run 10,000 times with the same records **THEN** the worst club gets pick 1 about 6/21 of the time (within 1.5 points).
- **WHEN** a tier-3 club is promoted **THEN** it is not in the lottery, whatever its record.

### R7.4 The world draft
One draft, **1 round, 48 picks**, ordered by the season just played: tier 3 first (worst to best,
both regions together, after the lottery), then tier 2, then the Big League, champion last.
- **Prospects**: a class of **52** each season *(tune)*, aged 19–22, ratings 40–60, potential
  hidden behind scouting (shown as a range that is wider for players you have scouted less). American
  prospects come from invented colleges, Europeans from club youth academies (R10.3).
- **Rookie contract**: 3 seasons; the salary is fixed by pick slot, from 6 for pick 1 down to 1 for
  pick 48 *(tune)*, so a high pick fits even a tier-3 budget.
- **Undrafted** prospects become free agents.
- AI clubs pick by need and the best available, as the existing draft AI does. The human picks on his turn.

- **WHEN** the draft ends **THEN** 48 prospects have been picked, each club has one, and 4 are free agents.
- **WHEN** a club makes pick 1 **THEN** that rookie's salary is 6 for each of his 3 seasons.

### R7.5 Re-signing
Each player whose contract ends SHALL ask for a new one: salary = his current price × a mood factor
(😄 0.9, 🙂 0.95, 😐 1.0, 🙁 1.15) for 1–4 seasons (31+: at most 2; 34+: at most 1). A 😟 player refuses
to re-sign and becomes a free agent. The club accepts or lets him go. The AI re-signs when he is worth
his salary and it fits the budget.

- **WHEN** a 😟 player's contract ends **THEN** he refuses to re-sign and is a free agent.
- **WHEN** a 😄 player worth 10 re-signs **THEN** he asks 9 per season.

### R7.6 Free agency
In rounds, clubs in draft order (worst first) may each make one offer per round: salary (at least
the player's asking price) and length. A player with several offers in a round picks the highest
salary, then the higher tier, then the bigger market, then the lowest club id. Rounds go on until a
round passes with no signings. Every club then has 12 players (R6.3); there are always enough
minimum-salary free agents (the pool is topped up with journeymen if needed).

- **WHEN** two clubs offer the same salary **THEN** the player joins the one in the higher tier.
- **WHEN** free agency ends **THEN** every club has 12 players within budget.

### R7.7 Development and ageing
Each offseason, every player's ratings SHALL change by age and potential *(tune)*:
| Age | Change |
|---|---|
| up to 22 | +2 to +6 overall, more with high potential, never past potential |
| 23–26 | 0 to +3 |
| 27–30 | −1 to +1 |
| 31–33 | −1 to −3, speed and stamina first |
| 34+ | −2 to −5 |
Changes show as "+3 3-Point" etc. on the player's card and in the news for the human's players.

- **WHEN** a 20-year-old with high potential goes through the step **THEN** he gains at least 2 points, and none of his ratings passes his potential.
- **WHEN** a 35-year-old goes through the step **THEN** his speed does not go up.

---

## Part 8 — In season: injuries, development, morale, news (slice 5e)

Small, visible, explained. After each matchday, in order: injuries from the games just played →
injured players count down → development → morale → news.

### R8.1 Injuries between games, never inside one
After each game, each player who played gets one injury check. The chance grows with his minutes,
injury proneness and fatigue *(tune)*: `1.2% × (minutes / 30) × proneness (0.5 at 1 … 1.5 at 99)
× fatigue (1.0 fresh … 1.3 exhausted) × fitness coach (1.0 until phase 4)`. That gives about one
injury per team every 3–4 matchdays. An injury counts from the next matchday.

- **WHEN** a player played 0 minutes **THEN** he has no injury check.
- **WHEN** proneness 90 and proneness 20 play the same minutes **THEN** over 1,000 seeded checks the first is injured at least 2× as often.

### R8.2 Out and returning
An injury SHALL keep a player **Out** for 1, 2–3 or 4–6 matchdays (60/30/10% *(tune)*), shown as
"Out: 2 more matchdays", then **Returning** for one game. Playoff games count. A club never has more
than 3 players out: with 3 out, its checks are skipped. Injuries left at the end of a season heal in
the offseason.

- **WHEN** a player is out for 2 matchdays **THEN** he misses the next 2 and is available for the one after.
- **WHEN** a club has 3 players out **THEN** none of its players can be injured until one returns.

### R8.3 Development in season
After each matchday a player under 25 who played SHALL be able to gain +1 in one attribute that
suits his position. The chance grows with potential and minutes; at most +2 / +4 / +6 per season for
low / medium / high potential *(tune)*. Nobody gets worse during a season (that is R7.7).

- **WHEN** a player has reached his season ceiling **THEN** he gains nothing more this season.

### R8.4 Morale: winning, playing time, contracts
Morale 0–100, starting at 60, shown as 😟 🙁 😐 🙂 😄. After each matchday *(tune)*: won +3, lost −2;
minutes against what he expects for his place in the rotation (starter about 28, rotation about 16,
deep bench about 5): well above +2, about right 0, well below −3. There is a pull back towards 60 by 1
a matchday, and a grace period: no playing-time effect for a player's first 2 matchdays at a club or
while injured.

**Morale mainly affects contracts:** it sets the re-signing price and whether he refuses (R7.5),
and a player at 😟 for 3 matchdays in a row **asks to leave**: a news item, and in Career the AI then
accepts trade offers for him more easily (R9.3). The human is never forced to trade him.

- **WHEN** a player has been 😟 for 3 matchdays **THEN** the news says he wants to leave.
- **WHEN** a player is Out injured **THEN** his playing-time effect is 0.

### R8.5 A small on-court effect, measured in the lab
Morale SHALL change ratings slightly for the next game only: 😄 +1, 🙂 +0.5, 😐 0, 🙁 −0.5, 😟 −1 on
shooting, 3-point, free throw, passing and tactics *(tune)*, on the copy of the team given to the
engine; the engine is not changed. The balance lab measures it (R12.4) and the size is shown on the
card ("+1 morale").

- **WHEN** a player is 😐 **THEN** the engine gets exactly his card's ratings.

### R8.6 News
After each matchday the hub SHALL show at most 6 short items, the human's club first: his injuries and
returns, his development, his players' morale (a whole face up or down, asking to leave), then the
league's: player of the matchday, an upset, a streak reaching 4, a big injury elsewhere, retirements
and signings in the offseason. Each is one plain sentence with its reason. The last 3 matchdays are
kept.

- **WHEN** a matchday makes 9 possible items **THEN** 6 are shown, in priority order.

---

## Part 9 — Trade deadline (slice 5f)

### R9.1 When
Trades SHALL be possible from the start of the season until the **deadline after matchday 7**, then
closed until the offseason (between re-signing and new season). **Career only**: Quick League has no trade deadline.

- **WHEN** matchday 8 starts **THEN** no trade can be made until the offseason.

### R9.2 What a trade is
A trade SHALL be 1–2 players for 1–2 players between the human and an AI club, or between two AI
clubs. After it both clubs are within budget and roster rules. Humans don't trade with each other.

- **WHEN** a trade would take a club over budget **THEN** it is refused, with the reason.

### R9.3 The AI only accepts fair deals
An AI club SHALL accept a trade only if the value it gets is at least 105% of the value it gives
*(tune)*. Value is worked out from ratings, age, potential (as its scout sees it) and contract, and
must fit what the AI needs (e.g. not three centres). A player who asked to leave counts 15% less
to his own club. The AI explains a refusal in one line ("We need a guard back").

- **WHEN** the human offers a worse player for a better one **THEN** the AI refuses.
- **WHEN** the same trade is offered twice in the same state **THEN** the answer is the same (no rerolling).

### R9.4 AI clubs trade too
Before the deadline each AI club SHALL consider at most one trade with another AI club, by the same
rules, and make it only if both sides accept. AI trades are shown in the news.

- **WHEN** the deadline passes **THEN** no AI club has made more than one trade that season.

---

## Part 10 — Players, places and names

### R10.1 Ages
Every player SHALL have an age. At the start of a Career, ages run 19–36 with most at 22–30
*(tune)*. Hand-made players get a fixed age from the data file.

- **WHEN** a world is created **THEN** every player has an age from 19 to 36.

### R10.2 Real hometowns
Every player SHALL have a real hometown (city and country), from lists of real places: American
players mostly American cities, European players European ones *(tune: some players from elsewhere)*.

- **WHEN** a player is generated **THEN** his hometown is on the list of real places.

### R10.3 Colleges and academies
American prospects SHALL come from **invented colleges**: a test checks every college name against a
list of real NCAA Division I schools, and none may match. European prospects come from the **youth
academy of a club in the world** (e.g. "Lyon Lynx Academy").

- **WHEN** the college list is checked **THEN** no name matches a real Division I school (case and spaces ignored).
- **WHEN** a European prospect is generated **THEN** his academy belongs to a European club in the world.

### R10.4 Name lists
There SHALL be separate **American** and **European** first- and last-name lists, giving at least
**10,000 combinations** in total (e.g. 120 × 100 American + 100 × 80 European). They are playful, but
not parodies of real players (the hand-made players stay as they are).

- **WHEN** the name lists are counted **THEN** first × last for America plus first × last for Europe is at least 10,000.

### R10.5 The generator always finishes
Name generation SHALL never loop forever. It replaces today's `journeymen()` loop (random draws until
an unused pair, which never ends once the 900 pairs run out). Instead it takes pairs from a seeded,
shuffled list of every combination, skipping used ones; when all are used it adds a suffix ("Jr.",
"II", "III", …). So it always ends, in steps in proportion to the names asked for. Ids are checked
against every player in the world, retired players too.

- **WHEN** 20,000 names are asked for **THEN** 20,000 different names and ids come back, without a time-out.
- **WHEN** it is called twice with the same seed **THEN** it returns the same names.

### R10.6 How many players
At the start: 576 on rosters (48 × 12) and about 104 free agents, about **680** in all. Each season
adds a draft class of 52, so about **1,150** different players appear over 10 seasons
(680 + 9 × 52 = 1,148). Retirements balance the classes (R12.3).

- **WHEN** a world is created **THEN** it has between 670 and 690 players.

---

## Part 11 — Scale, speed and saves

### R11.1 Speed
A season has at most **363 games**: 336 regular (6 leagues × 56), up to 15 in the Big League playoffs
and 12 in the tier 2–3 promotion playoffs. At about 5 ms a game (to be confirmed in the lab), the
whole season simulates in about 2 seconds. The offseason steps take under 1 second. Long sims show
progress and can be stopped.

- **WHEN** a whole season is simulated in the lab **THEN** it takes under 4 seconds on a normal laptop *(tune)*.

### R11.2 Autosave, slots, versions
Saves go to the browser's local storage after: the start, every matchday, the trade deadline, each
playoff game and each offseason step. There are **3 slots**, shared by both modes; a new game in a
used slot asks first. Every save has a format version. An older save is upgraded step by step; a
newer one (from a later version of the game) is not loaded ("made by a newer version"); a broken one is
reported ("This save can't be read"), never crashes the game, and the other slots are untouched.

- **WHEN** matchday 5 is done and the page reloads **THEN** the hub opens on matchday 6 with everything as it was.
- **WHEN** a version-1 save is loaded by a version-2 game **THEN** it is upgraded and continues.

### R11.3 What is kept, and how big it gets
A save SHALL hold what is needed to continue, not what can be recomputed. Box scores are kept for the
**current season only**; a finished season is kept as a summary (tables, playoff results, awards, each
player's season totals). Saves are compressed (gzip, built into the browser) before storing.

Estimate (raw JSON, then compressed):

| What | Raw |
|---|---|
| ~700 active players (ratings, age, contract, morale, injury, career totals) | ~150 KB |
| Current season's games (≤ 363 × ~0.8 KB) | ~290 KB |
| Each finished season's summary | ~30 KB |
| Each retired player kept for the history | ~60 bytes |
| **After season 1** | **~440 KB raw → ~130 KB stored** |
| **After 10 seasons** | **~740 KB raw → ~220 KB stored** |

Three full slots stay under 1 MB, far below the browser's local-storage limit (about 5 MB).

- **WHEN** a 10-season career is saved **THEN** the stored save is under 400 KB *(tune)*.

### R11.4 The world rebuilds from data, not from the save
Hand-made players, cities, nicknames, colleges and name lists come from data files. The save refers
to them by id, plus a data version; if a later data change would break a save, a migration maps it,
or the slot shows "incompatible". A save is never loaded wrong.

- **WHEN** a save refers to a player id that no longer exists **THEN** a migration maps it, or the slot shows "incompatible".

---

## Part 12 — Balance-lab targets

**`npm run world -- --seasons 10 --seed N`** simulates a Career world for that many seasons with the
full engine, no screens, and reports every target below as pass or fail (exit code 1 if any fails).
`--worlds M` runs M worlds from seed N upwards. Each target also becomes a test on a smaller sample.

### R12.1 Promoted teams can compete
A newly promoted club SHALL win **35–45%** of its games in its first season in the higher tier
(averaged over all promotions in 20 worlds × 10 seasons).

- **WHEN** the lab runs 20 worlds for 10 seasons **THEN** promoted clubs' first-season win % averages 35–45%.

### R12.2 A #1 pick is not a starter yet
The #1 pick SHALL not be one of his club's 5 best players by overall in his first season in at least
80% of drafts.

- **WHEN** the lab runs 200 drafts **THEN** in at least 160, the #1 pick is not in his club's top 5 in his first season.

### R12.3 The world's size stays stable
The number of active players SHALL stay within ±5% of the start (about 680) over 10 seasons:
retirements roughly match the draft classes.

- **WHEN** the lab runs 20 worlds for 10 seasons **THEN** each season's player count is within 646–714.

### R12.4 Morale is small on court
Between otherwise equal teams, an all-😄 team SHALL win **50–56%** against an all-😟 team (1,000 games).

- **WHEN** the lab runs the morale test **THEN** the all-😄 team's win % is within 50–56%.

### R12.6 Relegation is not a spiral
A relegated club SHALL be relegated again the next season in no more than about **10%** of cases.

- **WHEN** the lab runs 20 worlds for 10 seasons **THEN** at most 10% of relegations are followed by another relegation of the same club the next season.

### R12.5 Money matters, but isn't everything
Over 10 seasons, the club with the biggest budget in each league SHALL win the title less than half the
time, and every market size SHALL win a Big League title at least once across 20 worlds.

- **WHEN** the lab runs 20 worlds for 10 seasons **THEN** S, M, L and XL clubs have each won at least one Big League title.

---

## Part 13 — Build slices

Each slice keeps the engine unchanged (`npm run lab` identical) and adds tests from its scenarios.

**Order:** 5a (Quick League, playable) first. Then the **Career logic of 5b–5d is built without any
screens**, driven by `npm run world`, until every lab target passes; the Career screens come after
that. 5e and 5f follow the same way: logic and lab first, screens second.

| Slice | Contents | Done when… |
|---|---|---|
| **5a — Quick League** | Part 2; names generator and journeyman fix (R10.5); saves (R11.2) | A one-league season (snake draft, 14 matchdays, live or simulated, table, tiebreakers) can be played, saved, reloaded and finished. |
| **5b — World, schedule, promotion and relegation** (logic first) | Parts 3 and 4: 48 clubs, cities and nicknames, start options, all leagues on the same matchdays, promotion and relegation by final table, budgets by tier | A Career season can be played in any tier, and the next season starts with the right clubs promoted and relegated (simple placeholder playoffs). |
| **5c — Playoffs and awards** | Part 5: all playoff formats, awards, summary, history | Both modes end with real playoffs and awards; Career keeps a history. |
| **5d — Offseason** | Parts 6 and 7, and R10.1–R10.4, R10.6: contracts, budgets, retirements, lottery, world draft, re-signing, free agency, ageing | A Career runs season after season, with rookies, retirements and free agency, and the lab's R12.1–R12.3 pass. |
| **5e — Injuries, development, morale, news** | Part 8 | Players get hurt and come back, young players improve, morale moves and affects contracts, and the news explains it all; R12.4 passes. |
| **5f — Trade deadline** | Part 9 | Trades with the AI until matchday 7, AI–AI trades, all fair and explained; R12.5 checked. |

---

## Part 14 — What we leave out, and why

| Left out | Why |
|---|---|
| Coaches | Phase 4, after this; their factors stay 1.0 until then. |
| Cap sheets, luxury tax, debt, bird rights, options, buyouts | Hoop Land is the ceiling; a budget and a salary are enough to make choices. |
| Trades between the two humans | SPEC.md §1. |
| Continental cups beside the leagues | The Big League Finals already are America v Europe; a second competition would double the matches. |
| Injuries during a match | Would change the engine and its results. |
| Calendar dates, rest days, practice, load management | Matchdays are the clock. |
| Scouting budgets, scouting trips, individual workouts | Potential is a scout's range; the Assistant coach (phase 4) will sharpen it. |
| Owner, finances, attendance, fan mood, firing the manager | Not the game we're making, and nothing that can feel like pressure on a young player. |
| Re-playing a result, re-rolling a lottery or a trade answer | Results stand; that is what makes a season mean something. |
| Real team names, real players' names in Career prospects, real colleges | Safety and SPEC.md §8. |
| Online play, cloud saves | SPEC.md §1. |

---

## Decisions taken at approval

1. Tiers 2–3: one playoff (1st champion and promoted; places 2–5 play off for the second spot).
2. Lottery: places 6–8 of both tier-3 leagues (6 clubs), 4 lottery picks, nobody drops more than 4
   places, promoted clubs never in it.
3. Budgets 100 / 75 / 55 plus market 0 / 5 / 10 / 15 (fixed credits), a parachute (R4.4) and a
   performance bonus (R4.5); lab target R12.6.
4. Quick League has no trade deadline; Career only.
5. Career logic for 5b–5d runs without screens first, checked by `npm run world`; screens after.
