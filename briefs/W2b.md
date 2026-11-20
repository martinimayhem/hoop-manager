# Slice brief W2b: The whole season, and the next one

> Read first: [WORLD_SPEC.md](../WORLD_SPEC.md) §1.1–§1.2, §10.1, §14; [GAME_FLOW.md](../GAME_FLOW.md)
> §2–§3.6, §4.3, §6 (the screen rules are hard rules). Written 19 Nov 2026 in the design chat.
> Builds on `world-w2a`. If this brief and those files disagree, or something isn't covered: **stop and
> ask** (CLAUDE.md).

## What W2b delivers

A career runs **from one season into the next**: after the regular season come the play-ins and
playoffs, the national playoffs, the cups with their Final Four weekends and the Big League Final;
then promotion and relegation, licences and wildcards, and a new season with new schedules. Key games
and the **Key moments** way of playing make a season fit in 2–4 hours. Players don't age yet (W3).

## 1. The postseason, per competition (WORLD_SPEC §1.1)

| Competition | Postseason |
|---|---|
| Big League, America | Places 1–6 in; **play-in** for 7–10 (7 v 8: winner is seed 7; loser v winner of 9 v 10: seed 8); then 3 rounds **best-of-7** (first round, conference semi-finals, conference final). NBA rules |
| Big League, Europe | Places 1–6 in; the same **play-in** for 7–10; **best-of-5** quarter-finals; **Final Four** weekend (single-game semi-finals and final). FIBA rules |
| Big League Final | **One game**, America champion v Europe champion. **Europe hosts in even seasons (FIBA), America in odd seasons (NBA)** |
| US Divisions 2–4 | Champion promoted; places 2–5: single-game knockout (2 v 5, 3 v 4, then the final) for the second spot |
| National tier 1 (10 countries) and the Portuguese League | Top 8: quarter-finals and semi-finals **best-of-3**, final **best-of-5**, for the national title |
| National tier 2 | Champion promoted; places 2–5 play off for the second spot, as in the US divisions |

- **Home court:** the better-placed club has the extra home game: best-of-7 2-2-1-1-1, best-of-5
  2-2-1, best-of-3 1-1-1. Single games and the play-in: the better-placed club at home. Final Four:
  one venue, the best-placed of the four hosts *(tune)*.

## 2. Cups (WORLD_SPEC §1.1)

- **America Cup:** all 66 clubs; a preliminary game between the 4 lowest-placed Division 4 clubs of
  last season (first season: the 4 weakest Division 4 clubs) makes 64; rounds of 64, 32, 16,
  quarter-finals, Final Four.
- **National cups (24):** round 1 for the 16 lowest-placed; the last 16 adds the 8 best tier-1 clubs
  of last season (first season: the strongest); quarter-finals; Final Four. **Portugal (12):** round 1
  for the 8 lowest, the top 4 join in the quarter-finals, Final Four.
- Single games, drawn at random each round, the **lower-tier club at home** (same tier: the first
  drawn). The draw is shown in the inbox.

## 3. The calendar

Fit the cups and the postseason into the W2a calendar so that:

- **No club plays twice on a day, and every club has at least one day between games** (as in W2a).
- **Cup rounds** use free dates spread through the regular season (midweek for clubs without a Big
  League game that week, otherwise a free weekend day); the **Final Four weekends** fall in the last
  third of the regular season, at a weekend with no league games for the four clubs.
- After the regular seasons: the **Big League** play-ins and playoffs first; the **national playoffs**
  are scheduled around the Big League dates of the European clubs still in both (as in real life,
  the national league waits); the **national finals** come after the Europe Final Four; the **Big
  League Final** about a week after both conference champions are known.
- US divisions and national tier-2 playoffs right after their regular seasons.
- Design the exact dates yourself within these rules, and test the rules (§9).

## 4. Key games, Key moments, simulate to the next key game

- **Key games** (WORLD_SPEC §1.1), only your own: every play-in, playoff and Final game; cup ties from
  the quarter-finals on; **season deciders**: your last 5 regular-season games when you are within 2
  wins of a playoff, play-in, promotion or relegation line. Marked on Home, Schedule and match
  preparation; they pre-select **Watch**.
- **"Simulate to the next key game"**: a Continue option that plays all your games until the next key
  game (asks first, shows progress).
- **Key moments** (GAME_FLOW §3.4): each quarter simulated and shown as a **quarter card** (score,
  runs, top players); at each break the tactics and rotation changes of a watched game; the **last 5
  minutes of the 4th quarter and any overtime live** on the match screen; a lead of 20+ with 5 minutes
  left goes straight to the result. The match result must be the same kind of result a watched game
  gives (the engine decides; the cards only show it).

## 5. Continue in the postseason (GAME_FLOW §3.3)

Continue stops on: the **start of your postseason** (who you play, the format), **each of your games**,
your **cup draws** and **Final Four weekend**, **being knocked out** (a short screen: who beat you,
your season so far), and the **season review**. When your season is over, Continue offers
**"Simulate to the end of the season"** (shows progress, then the review). Every other result goes to
the inbox.

## 6. Season review and the step into the next season

- **Season review** (GAME_FLOW §3.6, the parts that exist now): your final positions and trophies; the
  champions of every competition; promoted and relegated clubs, licences lost, wildcards won; your best
  players and the league leaders. Then **"Start the next season"**.
- **What changes for the new season:**
  - **Promotion and relegation** in America and in each country (WORLD_SPEC §1.2): bottom 2 down, the
    champion and the playoff winner up; licence clubs exempt nationally; Portugal stays one tier.
  - **Licences:** a licence club's `bottomTwoFinishes` counts bottom-2 finishes in the Europe conference
    over the **last 5 seasons**; at the third, it loses the licence to that season's best wildcard
    club. **Wildcards:** the 2 best national-league seasons among clubs without a licence (national
    champions first, then national-league record). Big League Europe always has 12 clubs.
  - **Money systems follow the tier** (GAME_FLOW §4.3): a club promoted into the Big League America
    joins the cap system, one relegated out of it leaves; budgets for clubs that change tier are set
    by WORLD_SPEC §10.1 with the **parachute** (50% of the gap the first season). Contracts keep
    running unchanged; a payroll above a new budget is allowed for now (W5 deals with it).
  - **New schedules** for every competition and cup; tables and season stats start again.
  - **History:** the season is archived: final tables, champions, cup winners, promoted and relegated
    clubs; each player's season stats are added to his career stats.
  - **Contracts (added 20 Nov 2026):** contract expiry, re-signing and the free-agent list as in
    WORLD_SPEC §7.0, with its two Continue stops (contract screen, free-agent screen).
  - **Not yet (W3):** ageing, development, retirements, new youth. Game plans are kept.

## 7. Stored data

- **This season:** results of every game; **box scores** of your games, every postseason game and
  every cup game from the quarter-finals; every player's season totals. Other games' box scores are
  not stored (and not replayed from seeds any more: from W3 squads change during a season).
- **Past seasons:** final tables, results, champions, player season totals; box scores only of your
  own games and of every Final.
- Measure and report the save size after one and after three seasons.
- **Compressed saves (added 20 Nov 2026):** gzip with CompressionStream (WORLD_SPEC §14); old saves
  still load.

## 8. Screens

Within the screen rules (nothing scrolls, 14 px, Back in place):

- **Competitions:** play-in and playoff **brackets**, cup brackets, and a **History** page
  (champions and cup winners per season).
- **Home:** your postseason or cup situation (e.g. "First round v Tulsa, 1–2 down"), key games marked.
- **Schedule:** postseason and cup games included, key games marked.
- **Match preparation:** Watch / **Key moments** / Simulate.
- **Key moments:** the quarter cards and breaks, then the live part.
- **Knocked out**, **Season review**, **Start the next season**.

## 9. Done when

- `npm run typecheck` clean; `npm test` passes, with WHEN/THEN tests at least for:
  - each postseason format: who qualifies, the play-in logic, series lengths and home order;
  - cups: 64 after the preliminary game, the national cups' entry rounds, lower tier at home;
  - the calendar: no club plays twice a day, one day between games, Final Four weekends free;
  - promotion and relegation: the right clubs move, every league keeps its size after the move, licence
    clubs exempt, Portugal unchanged;
  - licences and wildcards: the 5-season counter, the third bottom-2 finish, wildcards picked as
    above, Big League Europe 12 clubs;
  - Key moments with no changes made at the breaks: the same seed gives the same result as Simulate;
  - the same seed gives the same seasons; save and load mid-postseason plays on identically;
  - contracts (WORLD_SPEC §7.0): count-down and expiry, your re-sign answers, going over the cap only
    for your own players and never above 1.34 C, budget clubs within budget, AI re-signing, every
    club at 13 players before the new season, the new-season step blocked below 13.
- **Twenty seasons** headless: squads stay at 13 every season, no errors; report the compressed save
  size after each rollover.
- **Three seasons in a row** played headless with every game simulated: every competition the right
  size each season, champions recorded, no errors; report the time per season and the save size.
- One postseason game watched and one played with Key moments through the real screens; report both.
- `npm run lab` identical to main; no-scroll and navigation sweeps pass with every new screen and
  state; screenshots of every new screen at 1366×650 and 768×1024 checked by eye.
- **Commit and push** `world-w2b` (from `world-w2a`) and report. No pull request: the owner plays it
  first.
