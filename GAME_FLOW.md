# Hoop Manager: game flow, money and screens (GAME_FLOW.md)

> How a career season **plays**: every phase, the decisions in it, what is required and what is
> optional, how money works in America and in Europe, and which screens exist. Decided with the
> owner on **18 November 2026**. The world (clubs, competitions, people) is in
> [WORLD_SPEC.md](WORLD_SPEC.md); what is in or out is in [SCOPE.md](SCOPE.md). Numbers marked
> *(tune)* are starting values for the world lab, not promises.
>
> **For Claude Code:** this page is the reference for every career slice. Each slice also gets a
> one-page *slice brief* in `briefs/` (exact scope + "done when" checks) and, for screens, the
> approved mockups. Build what the brief says; if this page and a brief disagree, ask.

---

## 1. Principles

1. **Continue drives the game.** One Continue button moves time forward. Nothing is required
   between games: your lineup and tactics carry over, staff handle the routine. Continue **stops
   only for real decisions** (§3.3).
2. **A season takes 2–4 hours.** Every phase is designed so most games can be simulated without
   losing the story.
3. **Every block has a reason.** Whenever a move is refused (a trade, a signing, a budget request)
   the screen says why in one plain sentence.
4. **America and Europe feel different.** America: salary cap, trades, draft. Europe: club
   budget, buyouts, academies. As in the real world.

---

## 2. The season at a glance

```
PRESEASON ──► REGULAR SEASON ──────────────────────────► POSTSEASON ──► SEASON REVIEW ──► OFFSEASON ──┐
 board meeting   matchdays (midweek Big League,             play-ins         final position     retirements   │
 sponsor & kit   weekend national/US divisions/cups)        playoffs         board verdict      options       │
 staff           transfer window open ──► DEADLINE DAY      national titles  awards night       draft         │
 transfers       cup rounds ──► cup Final Four weekends     Big League Final finances           contracts     │
 squad assessment                                                                               free agency   │
 dev squad & academy                                                                            youth intake  │
 training camp, friendlies                                                                      development   │
 ▲                                                                                                            │
 └────────────────────────────────────────────── next season ◄───────────────────────────────────────────────┘
```

Time moves in **days**. A day can hold games, an event (deadline day, a draw, the draft) or
nothing; Continue jumps to the next day that matters to you.

---

## 3. Phase by phase

### 3.1 Preseason (about 3 weeks of game days)

Continue stops at each step the first time; after that the inbox holds what's left. All optional
except the board meeting.

| Step | What you do | Required? |
|---|---|---|
| **Board meeting** | The board sets the **season objective** and your **money** (§4): payroll limit in the Big League America, a club budget everywhere else. You may **push back once**: ask for more money in exchange for a harder objective, or an easier objective for less. The board says yes or no with a reason. | Yes (one screen) |
| **Sponsor and kit** | Pick one of 2–3 sponsor offers and a shoe/kit deal (WORLD_SPEC §10.3). If you skip it, the assistant picks the middle offer. | No |
| **Staff** | See your staff, their ratings and contracts; hire, fire, or search the staff market. | No |
| **Squad assessment** | Your **assistant coach** reports where the team is strong and weak **compared with the league**: per position and per attribute group, plus the depth chart. Better assistant = more accurate report. | No (an inbox item) |
| **Transfers and scouting** | The market is open: trades (America), buyouts and free agents, scout assignments, shortlist. | No |
| **Dev squad and academy** | Promote a development-squad or academy player to the first team, or send a first-team player down (§5.3). | No |
| **Training camp** | Set the team focus and individual focuses (WORLD_SPEC §4.1). New signings start learning your tactics (tactic familiarity grows during camp). | No (defaults stay) |
| **Friendlies** | 2–3 exhibition games to test lineups and tactics. Results don't count; injuries can happen but are short *(tune)*. You may skip them. | No |

Preseason ends when you press Continue past the last friendly: the regular season starts.

### 3.2 Regular season

- **Matchdays:** Big League midweek; national leagues, US Divisions 2–4 and cups at the weekend
  (WORLD_SPEC §1.1).
- **Transfer window** open until the **trade deadline** (about 60% through the season). After it:
  free agents only.
- **Deadline day** is an event: Continue stops on the morning, AI clubs send offers, the inbox
  fills with rumours, and a countdown shows the hours left. Deals are answered within the day.
- **Cups:** rounds through the season; each **Final Four weekend** is a key-game event.
- **Morale, injuries, development, news** update after every matchday (WORLD_SPEC §2.1, §2.2, §4).

### 3.3 When Continue stops

Continue runs through days on its own and stops only when:

| Stop | What you see |
|---|---|
| **Your game day** | Match preparation (§3.4) |
| **A decision with a deadline** | A trade or buyout offer, a contract request, a player chat, a board request |
| **Something that breaks your lineup** | An injury to a starter, a suspension |
| **An event** | Deadline day, a cup draw, a press moment, a sacking warning, a job offer |
| **A phase change** | End of preseason, start of playoffs, season review, each offseason step |

Everything else goes to the **inbox** without stopping. A setting lets you add stops (e.g. "stop
for every news item about my players").

### 3.4 Your game day

1. **Match preparation screen:** the opponent report (scouting ranges, likely tactics), your game
   plan and rotation (carried over from last game), fatigue and availability, assistant tips.
2. **Choose how to play it:** **Watch** (the full match) · **Key moments** (quarter summaries, then
   the last 5 minutes and every timeout live) · **Simulate** (result only). **Key games** (rivals,
   top of the table, cups, playoffs) pre-select Watch; other games pre-select what you chose last
   time.
3. **The match** as built today: tactics, timeouts, subs, clutch calls, halftime team talk.
4. **After the match:** box score, player ratings, injuries, morale changes, and a **press moment**
   if it was a big game.

### 3.5 Postseason

- **Play-ins, then playoffs** (America: NBA format; Europe: EuroLeague format, WORLD_SPEC §1.1).
  National-league playoffs run alongside for European clubs.
- **Big League Final:** one game, America champion v Europe champion.
- Clubs knocked out go straight to their **season review** (the world keeps playing in the
  background).

### 3.6 Season review (one screen, then Continue)

- **Final position** in every competition, and the trophies won.
- **Board verdict:** objective met or not, **job security** now, and a short comment. If you are
  sacked (and sacking is on), job offers follow (WORLD_SPEC §11).
- **Awards night:** league awards, then your club's player of the season.
- **Your best players** and biggest improvers.
- **Finances:** income, spending, payroll against the cap or budget, next season's outlook.

### 3.7 Offseason checklist

One screen lists the steps in order; each opens its own screen and Continue moves to the next.
Steps without a decision for you run on their own and only report.

| # | Step | Your decision |
|---|---|---|
| 1 | **Retirements** | None (report) |
| 2 | **Options** | Team options: keep or decline. Player options: the player decides, you see why |
| 3 | **Draft lottery and draft** (America Big League clubs) | **Live draft room**: watch picks one by one, pick on your turn, trade picks during the draft; **"auto-pick from my shortlist"** for speed |
| 4 | **Contracts** | Extend or let go of expiring players; rookie contracts |
| 5 | **Free agency** (two weeks of game days) and the **buyout market** | Offers, counter-offers, buyouts; Continue moves one day at a time |
| 6 | **Youth intake** | College freshmen (America), academy intake (Europe); place young players in the dev squad |
| 7 | **Development jump** | None (report: who grew, who declined) |
| 8 | **Licences and wildcards** (Europe) | None (report) |

Then the next **preseason** starts with the board meeting.

---

## 4. Money

Two systems, matching the real world. All wages are after-tax and the same everywhere (no
country tax rates). All money is in **dollars**.

| | **Cap system** | **Budget system** |
|---|---|---|
| Used by | **Big League, America conference** (18 clubs) | **Everyone else**: Big League Europe, European national leagues, US Divisions 2–4 |
| Getting a player under contract | **Trade** (players, picks) with salary matching | **Buyout**: pay his release fee to his club |
| Free agents | Within cap space, or with an exception | Within the budget |
| Draft | Yes (2 rounds) | No (academies in Europe; undrafted free agents in US Divisions 2–4) |

### 4.1 America: the cap system ("NBA-lite")

All amounts are shares of the **cap C** so the world lab can tune one number. Start: **C = $100M**
*(tune)*. Real 2026–27 proportions in brackets.

| Line | Value | What it means |
|---|---|---|
| **Floor** | 0.9 C | Payroll must reach this by the first game, or the shortfall is paid out to the players |
| **Cap** | C | Below it you can sign anyone into the space left |
| **Tax line** | 1.21 C *(real: $200.4M / $165.0M)* | Above it you pay **luxury tax: $1.50 for every $1 over**. Tax money is shared among clubs below the line |
| **Hard ceiling** | 1.34 C *(real 2nd apron: $221.7M)* | Payroll can never go above this |

**Over the cap, you can still:**
- **Re-sign your own players** for any amount up to the max (Bird rights, simplified: a player who
  has been with you 2+ seasons).
- Sign players to **minimum contracts** (0.01 C, 1 year).
- Use **one mid-level exception** per season (up to 0.085 C a year, up to 3 years). Not available
  above the tax line.
- **Trade**, if the salary you take in is at most **125% of what you send out** (+0.01 C). Above
  the tax line: at most 100%.

**Contracts:** 1–5 years. **Max contract** 0.30 C a year. **Rookie scale** by pick. Team and player
options on the last year (WORLD_SPEC §7.3).

**The board** sets a **payroll limit** each season: below the tax line, or "tax allowed up to X"
for contenders. Staff wages are paid by the board outside the cap.

**Left out on purpose:** cap holds, sign-and-trade, aprons other than the hard ceiling, repeater
tax, two-way contracts, stretch provision, trade kickers, base-year rules.

### 4.2 Europe (and US Divisions 2–4): the budget system

- The board gives **one club budget** each season. It pays **player wages, staff wages and buyout
  fees** from the same pot. The screen shows: budget, committed wages, buyouts paid, room left.
- **Contracts:** 1–3 years. **Every contract has a buyout fee** (set when signing; players ask
  for a lower one at smaller clubs). Paying it releases the player to you; his club can't refuse,
  but **he** still has to agree to your offer.
- **Selling:** buyout fees you receive go back into the budget *(tune: 75% this season)*.
- **Big League Europe clubs (12) also have a payroll threshold** ("EuroLeague-lite"):
  - Threshold **0.7 C** *(tune)*, counting all wages **except up to 3 anchor players** (your
    highest-paid, you pick them) **and players under 23**.
  - Above it: pay **$0.50 for every $1 over**, at most 10% of your total wages. The money is shared
    among the European Big League clubs below the threshold.
- **US Divisions 2–4** use the same budget system without the threshold.

### 4.3 Moving between systems and regions

| Move | How |
|---|---|
| America Big League club ↔ America Big League club | **Trade** (players, picks, up to 0.05 C cash a season) |
| America Big League club signs a player under contract anywhere else | Pays his **buyout** (outside the cap, from a yearly buyout allowance of 0.01 C *(tune)*; the player pays the rest himself, as in reality, so he only comes if the offer is worth it) |
| A budget-system club signs a player under contract at an America Big League club | **Not possible.** Only free agents, or players that club releases |
| Budget-system club ↔ budget-system club (any region) | **Buyout** |
| A club is promoted into the Big League America | Enters the cap system; its contracts keep running |
| A club is relegated out of it | Leaves the cap system; its payroll now counts against its new budget |
| A European club gains or loses a wildcard | Gains or loses the payroll threshold |

### 4.4 Reading it on screen

- **One payroll bar** per club with the lines marked (floor, cap, tax, ceiling; or budget and
  threshold), current payroll filled in, and next season's commitments ghosted.
- Every refused move explains itself: "You're over the cap: you can re-sign your own players, sign
  minimum deals or use your mid-level exception ($8.5M left)."

---

## 5. Squads

### 5.1 Sizes
- **First team: 13 players** (12 dress for a game; WORLD_SPEC §1.4).
- **Development squad: up to 5 players**, every club. Young or developing players who train with
  the club but don't play in the league. Wages fixed at the minimum and **outside the cap and the
  threshold** *(tune)*.
- **Academy (European clubs):** about 6 players aged 15–18 (WORLD_SPEC §5.2).

### 5.2 The draft (America only)
- **18 America Big League clubs, 2 rounds, 36 picks.** **Lottery:** the 10 that miss the
  playoffs. Relegated clubs keep their picks.
- **Entrants:** US college seniors and early entrants, and international free agents aged 19–22.
  European academy players are not in the draft; they grow with their club.
- European clubs, US Divisions 2–4 and everyone else sign **undrafted** players as free agents.

### 5.3 Moving players up and down
- **Promote** a dev-squad or academy player to the first team any time the window is open (needs a
  free first-team spot and, in America, cap room or an exception for his new contract).
- **Send down** a first-team player under 23 to the dev squad (he keeps his contract; it moves
  outside the cap only if it is a minimum deal).

---

## 6. Screens

### 6.1 Look and navigation
- **Style:** modern dark, sporty: dark background, the club's colours as accents, cards and
  tables, big numbers. Like a sports app, readable for a 13-year-old, dense enough for FM players.
  The match view stays as it is.
- **Navigation:** a **left sidebar**, collapsed to icons on tablet. A top bar with date, club,
  money summary and the **Continue** button, always visible.
- **Tablet:** everything works by touch from about 768 px wide; no hover-only information.

### 6.1a Two hard rules for every screen (decided 18 Nov 2026)

**1. Nothing ever scrolls.**
- Every screen, menu, sidebar, dropdown, pop-up and table fits **whole** in the window at these
  sizes: **laptop 1366 × 768** (about 1366 × 650 of page once the browser's own bars are counted),
  **desktop 1920 × 1080**, **tablet 1024 × 768** (landscape) and **768 × 1024** (portrait).
- A list that can be longer than the space (free agents, player search, the transfer market,
  history, news) is **filtered and split into pages** ("1–20 of 412", previous / next). It never
  scrolls.
- If a screen doesn't fit, the screen is wrong: make rows more compact, move detail to a tab, a
  second panel or the player page. Never solve it with a scroll bar, and never by shrinking text
  below the minimum sizes below. If it can't be done without a design change, stop and ask.
- Checked automatically: a "no-scroll sweep" opens every screen at the four sizes and fails if the
  page or any element in it can scroll.

**2. Everything is sharp.**
- **Fonts are bundled with the game**, not left to the computer: **Inter** for text and **Barlow
  Condensed** for headings and big numbers (both free, open-licence fonts, e.g. via Fontsource).
  No falling back to Arial Narrow or system fonts as the look.
- **Icons are vector (SVG) from one icon set** (Lucide, ISC licence). No emoji and no text symbols
  (▶ ⏸ ★ ✓) as icons, no PNG or JPG for interface parts.
- **Canvases are drawn at the screen's pixel density** (`devicePixelRatio`), so the court and any
  chart are sharp on high-resolution screens.
- **No CSS `transform`/`zoom` to resize** screens or text (it blurs); lay out at real sizes.
- **Minimum sizes:** body text 14 px, labels 12 px, tap targets 44 px.
- The look follows the approved mockups (§6.3).

**Details settled after the first sweep (18 Nov 2026):**
- **Text sizes:** 14 px is the minimum for anything you read as content, **table cells included**
  (names, numbers, stars' labels). 12–13 px only for column headers, labels and captions. The sweep
  checks both.
- **Row heights:** table rows 28 px with a mouse, 44 px on touch screens (where a long table then
  pages sooner).
- **Nothing is cut off.** If something can't be shown whole at a size (for example the "Player of
  the game" card on a small court), it is hidden at that size or moved, never clipped.
- **Sorting on touch:** column headers stay compact; touch screens get a 44 px **Sort** button above
  each sortable table that opens the sort choices. Headers still sort with a mouse.
- **Dropdowns:** a native browser dropdown is allowed only when all its options fit without
  scrolling (about 12 or fewer). Longer choices use the game's own picker, filtered and paged.
- **Pop-ups during a match** (clutch call, arguing a call, team talk) are part of the sweep.
- Moved to make screens fit, and agreed: the squad's stat cards are on the Club screen; the game plan
  explains only the last choice you made; the key matchup is its own game-plan tab; game plan, breaks,
  the match team panel and the result screen use tabs.

### 6.2 Screen map

| Sidebar | Screens |
|---|---|
| **Home** | **Inbox** (news and decisions, with action buttons), next game card, mini table, objective and job security |
| **Squad** | First team, dev squad, academy, each a sortable table with three **views** (§6.4), **player page** (attributes in 5 groups with scout ranges, personality, history, contract, promises, "talk to him") |
| **Tactics** | **Game plan** (starting five, rotation, offence, defence, tempo, intensity, key matchup), **training** (team focus, individual focus) |
| **Schedule** | Calendar of all your competitions, results, key games marked |
| **Competitions** | Tables, play-in and playoff brackets, cups, league stats, awards, history |
| **Transfers** | Player search, shortlist, **offers in and out**, **trade screen** (America) or **buyout screen**, free agents, payroll bar |
| **Scouting** | Scouts and their assignments, reports, draft board (America) |
| **Club** | Board (objective, job security, requests), finances, sponsor and kit, facilities, staff |
| **Manager** | Your career, reputation, job offers, settings |

**Full-screen moments** (opened by Continue, not the sidebar): new career setup, board meeting,
match preparation, the match, post-match, player chat, press moment, deadline day, draft room,
free agency days, season review, offseason checklist.

### 6.3 Mockups

Before a screen is built, the owner approves a clickable mockup. The first set, **round 1, not yet
approved**: Home/Inbox, Squad, Player page, Game plan, Transfers (both money systems), Schedule and
Competitions, on the design canvas
[Hoop Manager – core screens](https://claude.ai/artifact/Ybpp3qbdbnEXn4ynUu295A) (private to the
owner; screenshots go into the slice brief, because Claude Code can't open it). Approved mockups
are linked from the slice brief that builds them.


### 6.4 Squad table views

Every squad table (your club's and other clubs') has a **view switch** above it, next to the
First team / Dev squad / Academy tabs. Decided 18 Nov 2026.

| View | Columns |
|---|---|
| **Overview** (default) | Portrait, Pos, Player, Age, Nat, **Ability ★**, **Potential ★**, **Morale face**, Contract end, Wage, Buyout (budget clubs) or Years left (cap clubs) |
| **Attributes** | Pos, Player, OVR, then all 11 ratings with short headers: SPD, STA, MID, 3PT, FT, LAY, DNK, PAS, DRI, REB, IQ, colour-coded as on the player page |
| **Profile** | Portrait, Pos, Player, Age, Height, Weight, Archetype, Origin (college or academy), Hometown, Potential ★ |

- Every column sorts. Other clubs' players show **scout ranges** for numbers, as everywhere else.
  Stars are always your staff's estimate (§6.5).
- **Personality stays on the player page only**, not in a table.
- Each view fits **768 px** without sideways scrolling.
- The chosen view is remembered on this device.
- **From W2:** a fourth view, **Season stats** (games, minutes, points, rebounds, assists, shooting
  percentages), once matches are played.

### 6.5 Showing players: stars, morale faces, portraits

Decided 18 Nov 2026 (owner, with Football Manager screens as reference for the *idea*, not the look).

- **Ability and potential are stars**, 0.5 to 5 in half stars, in every table and on the player page.
  - Stars compare the player with **the league the club plays in** (a 4-star player in US Division 4
    is a key player there, not in the Big League). The player page says which league.
  - **Ability** stars come from his overall; **potential** stars from his staff-estimated ceiling, so
    they are an estimate for your own players too. Other clubs' players: the estimate of your scouts.
  - Two colours that differ in lightness too: ability gold, potential blue.
  - The **numbers stay** where you need them: OVR in the Attributes view and on the player page next
    to the stars; the potential range on the player page.
- **Morale is a face, not a word:** five faces (superb, good, okay, low, very low) that differ in
  **mouth shape and colour**, so they read without colour vision. Each has a text label for screen
  readers, and the table's legend names them (nothing hover-only).
- **Portraits:** every player has a cartoon face, drawn with **faces.js** (Apache-2.0, an open-source
  library made for basketball management games). The face is **generated from the player's id**, so it
  never changes and nothing extra is saved. Shown small in every table, large on the player page and
  in the inbox. The licence notice goes in the repository. (Real photos are out: the players are
  fictional or parodies.)

---

## 7. Which slice builds what

| Slice (WORLD_SPEC §15) | From this page |
|---|---|
| W1 Foundation | §6 sidebar shell, top bar, Squad and Competitions screens (browse only), payroll bar (display) |
| W2 One season | §2–§3.6 calendar, Continue and its stops, game day, postseason, season review |
| W3 Years go by | §3.7 offseason checklist (retirements, development), §5.1 dev squad and academy |
| W4 Talent pipeline | §5.2 draft and live draft room |
| W5 Free agency | §4 both money systems for signings, buyouts, options, free agency days |
| W6 Trades | §4.1 trades with salary matching, deadline day |
| W7 The club | §3.1 board meeting, sponsor and kit, staff, squad assessment |
| W8 Scouting 2.0 | Scouting screens |
| W9 Living world | Press moments, awards night, history |
