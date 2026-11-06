# Hoop Manager

A browser basketball management game: draft a squad on a budget, scout the opponent, set your
tactics and out-coach the other bench. Play against the computer or head-to-head on one keyboard.
See [SPEC.md](SPEC.md) for the full design.

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

Each team has 3 timeouts. A timeout happens at the next dead ball; both coaches may adjust during it.

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
