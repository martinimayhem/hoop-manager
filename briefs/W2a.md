# Slice brief W2a: Play your season

> Read first: [GAME_FLOW.md](../GAME_FLOW.md) §2, §3.2–§3.4, §3.6, §6 (all of it: the screen rules
> are hard rules); [WORLD_SPEC.md](../WORLD_SPEC.md) §1.1, §3, §14. Written 19 Nov 2026 in the design
> chat. If this brief and those files disagree, or something isn't covered: **stop and ask**
> (CLAUDE.md).

## Why this slice, and why now

After W1 you can create a world and look at it, but you can't play. Nothing is fun until you can.
WORLD_SPEC's W2 ("One season") is split in two so you can play as soon as possible:

- **W2a (this brief): the regular season.** Continue moves time; you play your own games; every
  other game is simulated; tables, results and season stats fill up; the season ends with a review.
- **W2b (next): everything after and around it.** Play-ins and playoffs, national playoffs, the
  Big League Final, cups and Final Four weekends, promotion and relegation, wildcards, key-game
  flags, the Key moments mode, and the step into the next season.

## What W2a delivers

From the career, press **Continue**: days pass, the world's games are played, and Continue stops on
your game day. You prepare, choose **Watch** or **Simulate**, play the match on the existing match
screen, see the result, and carry on, through a whole regular season, ending with a season review.
Saved after every matchday.

## 1. The calendar and the schedules

- **One season**, starting on a fixed date in autumn (*tune*); a **day-by-day calendar**.
- **Big League** games **midweek**; national leagues and US Divisions 2–4 at the **weekend**
  (GAME_FLOW §3.2). A European Big League club plays both; never two games on the same day, and at
  least one day between its games.
- **Schedules** (WORLD_SPEC §1.1):
  - Big League: **40 games** (every club once, 29 games, plus 11 more against its own conference),
    half at home.
  - US Divisions 2–4: double round-robin, **30 games**.
  - National leagues (both tiers) and the Portuguese League: double round-robin, **22 games**.
- The regular seasons end within a few weeks of each other. **No cups yet** (W2b), but leave their
  weekend dates free in the calendar.

## 2. Continue

- **Continue** (top bar) runs day by day and **stops on your game day** (GAME_FLOW §3.3). In W2a it
  stops for only two other things: **the season's first day** and **the end of the regular season**.
- Every other game of that day is simulated with the full engine (`simulateMatch`) in the background
  worker. One matchday must take **under 1 second** in the browser (WORLD_SPEC §14): measure and
  report it.
- A second button, **"Simulate to the end of the regular season"**, asks first ("Your games will be
  simulated too"), then runs to the end with a progress bar.
- **Autosave** after every matchday; leaving the career saves first.

## 3. Your game day (GAME_FLOW §3.4)

1. **Match preparation** (full-screen moment, Leave in the Back spot): the opponent's scouting
   report (scout ranges, as built), **your game plan and rotation** (the existing plan editor,
   carried over from your last game and saved with the career), availability.
2. **Choose: Watch or Simulate.** *Key moments* comes in W2b; leave room for it.
3. **Watch** = the existing match screen with everything it has (tactics, timeouts, subs, clutch
   calls, halftime team talk, 2D/3D). **Leave** during a match asks first; leaving simulates the
   rest of the game from that moment.
4. **After the match:** the existing result screen; Continue goes back into the career.
- The match uses the career's real squads and players (ratings, positions, the 12 who dress: the 13th
  is the one with the lowest overall unless you choose otherwise in the rotation).

## 4. Screens that appear now (sidebar and top bar per GAME_FLOW §6.1b)

The sidebar grows from Squad, Competitions and Club to: **Home, Squad, Tactics, Schedule,
Competitions, Club**. Each follows the round-1 mockups' structure where one exists, within the screen
rules (nothing scrolls, 14 px, Back in place).

- **Home:** the next-game card (opponent, date, competition, home/away, both records), your last
  results, a short table around your position in each of your competitions, and an **inbox** with the
  results of your games and the start and end of the season. (Decisions in the inbox come later.)
- **Tactics:** your game plan and rotation (the same editor as match preparation), saved with the
  career.
- **Schedule:** your games for the whole season, by month: date, competition, opponent, home/away,
  result once played. Paged by month.
- **Competitions:** tables now count: played, won, lost, win %, games behind, points difference,
  last five. Big League: one table per conference. Click a club: its page; click a game: its box
  score.
- **Squad:** the **Season stats** view (GAME_FLOW §6.4): games, minutes, points, rebounds, assists,
  shooting percentages; also for other clubs' squads.
- **Season review** (end of the regular season, GAME_FLOW §3.6 in short): final positions in your
  competitions, your record, your best players of the season, the league's top scorers. It ends the
  season: afterwards you can still browse the career, and Continue is hidden until W2b. No "coming
  soon" text anywhere (GAME_FLOW §6.1b).

## 5. Out of W2a

Playoffs of any kind, cups, promotion and relegation, wildcards, the next season, key games, Key
moments, injuries, fatigue between games, morale changes, transfers and the deadline, the board,
sponsors, press. The screens for them are not shown.

## 6. Done when

- `npm run typecheck` clean; `npm test` passes, with new WHEN/THEN tests at least for:
  - every schedule: the right number of games per club, half at home, every pairing as the brief
    says; no club plays twice on one day; a European Big League club always has a day between games;
  - tables: wins and losses add up; the order (win %, then head-to-head, then points difference);
  - the same seed gives the same season; a career saved mid-season and loaded plays on identically;
  - season stats add up to the box scores.
- **Speed:** a matchday under 1 s in the browser and a whole regular season simulated to the end,
  both measured and reported (WORLD_SPEC §14 targets).
- **A full season played through:** run one career from the first day to the season review with
  every game simulated, and one game watched through the real screens (prep → match → result →
  career); report both.
- `npm run lab` identical to main (the engine is not touched).
- **No-scroll sweep and navigation sweep pass** with every new screen and state in them (Home,
  Tactics, Schedule, tables with results, Season stats, match preparation, season review, the
  "simulate to the end" question and progress).
- **Look at it:** screenshots of every new screen at 1366×650 and 768×1024, checked by eye; say which.
- **Commit and push** `world-w2a` (from `world-w1-v2`), and report. No pull request: the owner plays it
  first.
