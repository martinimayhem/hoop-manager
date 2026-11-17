# Hoop Manager

A browser basketball management game: draft a squad on a budget, scout the opponent, set your
tactics and out-coach the other bench. Play against the computer or head-to-head on one keyboard.
Made for young basketball fans (about 13 and up) who want to coach, and for anyone who likes
management games. See [SPEC.md](SPEC.md) for the full design.

## Play

```
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173).

1. **Menu**: choose *vs Computer* or *vs Player (same keyboard)*, name the teams, and pick how to get squads:
   - **Free draft** (vs computer): spend 100 credits on 12 players. The AI shops first.
   - **Snake draft**: take turns picking from one shared pool (1-2-2-1…).
   - **Quick match**: skip the draft with two ready-made teams.
2. **Draft**: ratings are scout ranges; famous players are easy to read, unknowns are a gamble.
   Prices follow reputation, not usefulness, so look for bargains that fit your plan. You need at least
   2 guards, 2 wings and 2 bigs. *Auto-pick* chooses a sensible player for you.
3. **Game plan**: pick your starting five, bench order, offence, defence, tempo and key matchup,
   using the scouting report on the right. In hot-seat mode each player sets their plan in secret.
4. **Match**: watch the action on a crisp, high-resolution isometric court. Change tactics and lineups at timeouts and quarter breaks.

| Key | Action |
|---|---|
| `Q` | Timeout, Player 1 (home, orange) |
| `P` | Timeout, Player 2 (away, blue), hot-seat only |
| `Space` | Pause / resume |

Each team has 2 timeouts in the first half, 3 in the second and 1 per overtime. A timeout happens at
the next dead ball; both coaches may adjust during it.

## Developer commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests (engine, draft, AI, live-match controller) |
| `npm run typecheck` | TypeScript check |
| `npm run match -- --seed 42` | Text-only match in the terminal (play-by-play + box score) |
| `npm run lab` | Balance lab: 1,000 games, win rate per tactic |
| `npm run build` | Production build into `dist/` |

## Layout

- `src/engine/`: pure match simulation (seeded, no DOM)
- `src/game/`: player pool, pricing, scouting, draft rules, AI coach, assistant tips
- `src/ui/`: React screens, canvas court, live-match controller
- `src/data/`: `players.json` (the market) and the two quick-match teams
- `scripts/`: terminal match and balance lab

## Roadmap

Next up is **career mode**: a world of 126 clubs in the US and Europe with promotion and relegation,
scouting, a draft, free agents, trades, youth development, staff and money, designed in
[WORLD_SPEC.md](WORLD_SPEC.md). After that: a Daily Clutch challenge, arcade-style match moments
and team codes for head-to-head play at a distance. See the roadmap in [SPEC.md](SPEC.md).

## Rights

All rights reserved. The code is visible for reference; please ask before reusing it. All player
names are fictional; any resemblance to real players is meant as affectionate parody.
