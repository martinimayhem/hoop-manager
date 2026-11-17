# Hoop Manager — Project Brief (SPEC.md)

> Working title. A browser-based basketball management game in the spirit of Football Manager:
> build a squad under a budget, scout opponents, set tactics, and out-coach the other side in fast,
> watchable matches. Play head-to-head against a friend on the same device, or vs AI, across a full
> season.

---

## 1. Purpose and audience

- **Audience:** young basketball fans (about 13 and up) who know the game and want to coach, plus
  anyone who likes management games. Clear enough for a teenager, deep enough for adults.
- **Fair play:** no manipulative mechanics: no paid random packs, no energy timers or forced waiting,
  no guilt-driven streaks or notifications, no pay-to-win.
- **Modes:** Player vs AI, and Player vs Player on the same device (hot-seat).
- **Feel:** Quick to play (a match takes about 5–8 minutes including timeouts), fun to watch, and
  **skill-based**: the better manager should win more often, not the one who spent the most on
  ratings.
- **Platform:** Runs in the browser (desktop/laptop). No server, no accounts. Saves stored locally.

### Out of scope (v1)
- Online multiplayer (two devices over the internet)
- Mobile or touch layout
- Real player names, photos, team logos or league branding (see §8)
- Trading between two human players, and a salary cap (contracts, trades and multi-season careers
  are now designed in [WORLD_SPEC.md](WORLD_SPEC.md))

---

## 2. Core game loop

```
Pick league → Draft squad (12 players + 3 coaches) under budget
   → Season: for each matchday
        Scout opponent (fuzzy info) → Set game plan → Play match (4 quarters, live)
        → Post-match: results, injuries, player development, morale
   → Playoffs → Season summary → (next season: v2)
```

The two moments that must be fun first: **the draft** and **the live match**. Everything else
supports them.

---

## 3. Players

### 3.1 Attributes (1–99 scale)
Shown to the user in **5 groups** so the screen stays readable; all 15 values used by the engine.

| Group | Attributes |
|---|---|
| **Physical** | Speed, Height, Weight, Stamina |
| **Scoring** | Shooting (mid-range), 3-Point, Free Throw %, Layup, Dunking |
| **Playmaking** | Passing, Dribbling |
| **Defence & Boards** | Rebounding, Tactics (basketball IQ / defensive awareness) |
| **Hidden-ish** | Injury proneness, Development potential (only shown as a scout estimate) |

- Height and weight are real values (e.g. 198 cm, 102 kg), converted to engine ratings.
- Each player has a **position** (PG, SG, SF, PF, C) and can play adjacent positions with a penalty.
- Each player has an **archetype** tag (e.g. "Sharpshooter", "Rim Protector", "Slasher",
  "Floor General") so the user can scan quickly.

### 3.2 Design rule: every strength must have a counter
To keep skill in the game, attributes interact rather than simply add up:
- Big, slow lineups win rebounds and the paint but are punished by pace and the pick-and-roll.
- Small, fast lineups win transition but lose the boards and get bullied inside.
- A great shooter is worth less if nobody on the team can pass to create open looks.
- High-usage stars get tired; stamina and rotation matter late in games.

### 3.3 Player pool
- **Stars:** about 100 hand-made players with **playful parodies** of real players' names (a nod to
  the real name, never the real name or one letter off it), stored as a JSON data file. Ratings
  loosely inspired by each real player's style, so the parody feels recognisable.
- **Everyone else:** generated players ("journeymen"), named from basketball-pun surnames so a
  generated name can never be a real player's.
- **How many names are needed** (3 leagues × 8 teams × 12 players):
  - on rosters: 288;
  - market at the start (rosters plus about 1.3–1.5× choice for drafts and free agency): about
    375–430;
  - new players each season (1–2 rookies per team): 24–48;
  - over a 10-season career: about 650–900 unique names.
- **Generator requirement:** at least 10× that many possible names (e.g. 100+ first names × 100+
  pun surnames), names that don't visibly repeat, and a guaranteed unique result. The generator
  must never loop forever when names run short (today's 30 × 30 lists can).

---

## 4. Budget and the draft

- Each team gets a fixed budget (e.g. 100 credits) for **12 players + 3 coaches**.
- **Price reflects market value, not true value.** Price is driven mainly by overall rating and
  reputation/hype, so some players are overpriced stars and some are bargains *for the right system*.
  Finding bargains is a core skill (the Moneyball idea).
- Constraint: at least 2 players per position group (guards / wings / bigs) to stop silly squads.
- **Draft modes:**
  - *Free draft* (vs AI): buy freely from the market until budget or roster is full.
  - *Snake draft* (head-to-head): players alternate picks from a shared pool, so you can't both have the
    best player. Both still bound by budget.
- The AI teams build sensible squads using the same rules.

---

## 5. Coaches (3 per team, cost budget)

Each coach has 3–4 attributes. A cheap staff saves budget for players; a strong staff makes you
better at the game *and* gives you more information.

| Role | What they do | Key attributes |
|---|---|---|
| **Head Coach** | How well the team executes tactics; how much a timeout helps; morale | Tactical knowledge, Motivation, Adaptability |
| **Assistant / Scout** | How accurate the opponent scouting report is; live in-game tips ("their PG is tiring", "zone is working") | Scouting, Game reading, Analysis |
| **Fitness & Development** | Stamina recovery between quarters/games, injury risk, how fast young players improve | Conditioning, Medical, Player development |

---

## 6. Scouting (fuzzy information)

- Before each match you see the opponent's squad and likely tactic, but **ratings are shown as
  ranges** (e.g. 3-Point: 70–85), and their game plan as a probability ("likely zone defence, 60%").
- A better Assistant/Scout narrows the ranges and makes the tactic prediction more accurate.
- Development potential of your own players is also a scout estimate (stars 1–5), not exact.

---

## 7. The match

### 7.1 Structure
- 4 quarters. Simulated as **possessions**, not real basketball seconds.
- **Speed setting:** Normal (≈2 minutes per quarter) and Fast (≈1 minute per quarter).
  *Note:* a real game has about 25 possessions per team per quarter. At 1 minute per quarter that is
  one possession every 1.2 seconds, which is too fast to follow. The engine should therefore show
  key possessions in full on the 2D court and fast-forward the routine ones, or simulate fewer
  possessions and scale scoring. To be tuned in play-testing.

### 7.2 Game plan (set before the match, changeable at timeouts and between quarters)
1. **Starting five and rotation** (who plays, minutes priority)
2. **Offensive focus:** Inside / Balanced / 3-Point heavy / Pick-and-roll / Fast break
3. **Defence:** Man-to-man / 2-3 zone / Full-court press
4. **Tempo:** Slow / Normal / Fast
5. **Key matchup:** who guards their best player (or "double-team their star")

These form a **counter system** (rock-paper-scissors with nuance), e.g.:
- Zone defence weakens inside scoring but is vulnerable to good 3-point shooting.
- Press forces turnovers but tires your players and gives up easy layups when beaten.
- Fast tempo favours fit, quick teams; slow tempo favours strong half-court teams.

### 7.3 In-match decisions
- **Timeouts:** 2 in the first half, 3 in the second, 1 per overtime (FIBA-style, kept on purpose
  for pace; everything else follows NBA rules). The match pauses; you can change any of the game plan
  above.
- **Substitutions** at timeouts and quarter breaks (plus automatic subs for exhausted or fouled-out
  players, following your rotation).
- **Live feedback** to read what's working: momentum bar, a mini box score, player fatigue bars, and
  assistant-coach tips. Better staff = clearer tips.
- **Hot-seat (head-to-head):** each player has a timeout key (e.g. Player 1 = `Q`, Player 2 = `P`). The
  team calling the timeout makes its changes; the other team may also adjust during the same pause.

### 7.4 Match engine (FM-inspired, loosely)
For each possession:
1. Pick the ball handler and play type, based on offensive focus, tempo and player skills.
2. Resolve against the defence: matchup quality (attributes), defensive scheme, fatigue, tactics
   execution (head coach), momentum and a controlled amount of randomness.
3. Outcome: made shot (2/3), miss → rebound contest, turnover, foul → free throws, or fast break.
   Every shot comes from a **shot zone** (restricted area, paint, mid-range, corner three, above-the-
   break three) with NBA league-average base odds; the zone decides the points and where the shot
   is drawn. Rebounds depend on where the ball comes down.
4. Update fatigue, fouls, stats, momentum and commentary.

**Architecture rule:** the engine is pure logic, separate from the visuals, with a seeded random
generator. That means:
- AI vs AI league games can be simulated instantly.
- The same seed reproduces the same match (easy debugging).
- A **balance lab** can run 1,000+ games to check that no single tactic or squad type always wins.

### 7.5 Presentation
- **2D isometric court** with 10 players and the ball. Movement is an animation of each possession
  (drive, pass, shot, rebound) driven by the engine's events, not a physics simulation. The engine
  decides every outcome; the animation never changes it (see CLAUDE.md).
- **Rules and court:** NBA (28.65 × 15.24 m court, 7.24 m three-point arc, 12-minute quarters,
  6 fouls to foul out), except timeouts (see 7.3).
- **3D view:** an experiment, kept off the main branch until it looks better than the 2D view.
- **Commentary feed** with short, fun lines ("Hot Curry pulls up from deep… BANG!").
- Scoreboard, quarter clock, fouls, timeouts left, momentum bar.

---

## 8. Leagues and season

> **Superseded for career mode** by [WORLD_SPEC.md](WORLD_SPEC.md): a world of 126 clubs in the US
> and Europe with promotion and relegation. The three small leagues below remain a possible quick
> season for Exhibition.

- **3 leagues** with different budgets and player quality, e.g. *Street League* (low budget),
  *Pro League*, *Legends League* (high budget).
- Each league: **8 teams**, double round-robin (14 matchdays), then top-4 playoffs (semi-final, final).
- Both human players can be in the same league; AI fills the other teams.
- **Between matchdays:**
  - Injuries (chance driven by injury proneness, fatigue and the fitness coach)
  - Player development (young players with high potential improve; driven by minutes and the
    development coach)
  - Morale (winning, playing time)
  - Small transfer window mid-season: sell one player / buy one with the remaining budget
- League table, top scorers, season awards.

> **Naming note:** parody names are fine for private use. If this is ever published, use fully
> fictional names; parodies of real players carry likeness and trademark risk.

---

## 9. Tech choices

- **TypeScript + Vite**, running in the browser.
- **2D rendering:** HTML Canvas (or Phaser if animation gets complex).
- **UI screens:** React for menus, draft, tactics and league tables.
- **Data:** players, coaches and leagues in JSON files.
- **Saves:** browser local storage (save/load a season).
- **Tests:** unit tests for the match engine; the balance lab as a script.

---

## 10. Build phases (build in this order)

Each phase must be playable and fun before starting the next.

| Phase | What | Done when… |
|---|---|---|
| **1. Match engine (text only)** ✅ | Possession sim, tactics, counters, fatigue, box score. No graphics. | You can run a match in the console and tactics clearly change outcomes. Balance lab runs 1,000 games. |
| **2. Playable match** ✅ | 2D court, commentary, timeouts, subs, speed setting. Fixed squads. | Two players enjoy a full 4-quarter match head-to-head. |
| **3. Draft + budget + scouting** ✅ | Player pool, pricing, free and snake draft, fuzzy scouting. | Two different drafting strategies can both win. |
| **4. Coaches** | 3 coach roles with real effects. | Spending on staff is a real trade-off vs players. |
| **5. Season** | Leagues, schedule, AI teams, table, playoffs, injuries, development, saves. | A full season can be played and saved. |
| **6. Polish** | Sounds, better animations, awards, season 2 carry-over. | — |

### Roadmap after phase 3

Phases 1–3 are done. Next, in this order:

1. **Career mode** as designed in [WORLD_SPEC.md](WORLD_SPEC.md), built in slices W1–W9
   (foundation, one season, years go by, talent pipeline, free agency, trades, the club, scouting,
   living world). Phases 4 (coaches) and 5 (season) are part of it.
2. **Daily Clutch:** the same late-game scenario for everyone each day (seeded), using the clutch
   play-calls.
3. **Match feel:** arcade banners for big plays ("ALLEY-OOP!"), a play-of-the-game replay, a
   reacting crowd.
4. **Team codes:** save a team and tactics as a code to play an asynchronous head-to-head.
5. **Goals:** achievements, board goals per match and season.

---

## 11. Success criteria

- A match vs the AI or a friend takes **under 10 minutes** and you want to play another.
- In the balance lab, **no single tactic wins more than ~60%** of games between equal squads.
- A well-drafted cheaper squad with the right tactic can beat a more expensive squad.
- Changing tactics at a timeout **visibly changes** what happens on court within a few possessions.

---

## 12. Open questions (decide during build)

- Exact budget numbers and price curve (tune in Phase 3).
- How many possessions to show in full vs fast-forward (tune in Phase 2).
- Should the AI difficulty be adjustable (easy for learning, hard for a challenge)?
- How much hidden information the opponent sees about *your* tactics in hot-seat mode.
