# Hoop Manager

A browser basketball management game: take over a club, scout the opponent, set your tactics and
out-coach the other bench, against the computer.
Made for young basketball fans (about 13 and up) who want to coach, and for anyone who likes
management games. One player against the computer. See [SPEC.md](SPEC.md)
for the full design and [SCOPE.md](SCOPE.md) for what is in and out.

## Play

```
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173).

1. **Menu**: continue your saved game, or start a new one by choosing the league to start in
   (Street, Pro or Legends). A *Friendly match* plays one game with two ready-made teams.
2. **Choose your club**: the league's eight clubs, each with its squad, its strength and its best
   players. Take one over and play its 14-matchday season.
3. **Game plan**: pick your starting five, bench order, offence, defence, tempo and key matchup,
   using the scouting report on the right.
4. **Match**: watch the action on a crisp, high-resolution isometric court. Change tactics and lineups at timeouts and quarter breaks.

| Key | Action |
|---|---|
| `Q` | Timeout (your team) |
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

Next up is **career mode**: a world of about 320 clubs in America and eleven European countries, with
national leagues and cups, promotion and relegation, scouting, a draft, free agents, trades, youth
development, staff and money, designed in [WORLD_SPEC.md](WORLD_SPEC.md). After that: a Daily
Clutch challenge and arcade-style match moments. See the roadmap in [SPEC.md](SPEC.md).

What is in and out of the game, measured against Football Manager, is in [SCOPE.md](SCOPE.md).

## Rights

All rights reserved. The code is visible for reference; please ask before reusing it. All player
names are fictional; any resemblance to real players is meant as affectionate parody.
