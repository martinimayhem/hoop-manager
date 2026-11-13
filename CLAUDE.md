# Hoop Manager: working rules

## DEFENDERS ALWAYS TRY

The engine (`src/engine/`) decides every outcome. The animation (`src/ui/court/animation.ts`,
`src/ui/court/motion.ts`) shows defenders trying and failing, never not trying. An open outcome
(an open lane, an open shot) is shown by a defender being a step late, never by him standing still,
jogging, or staying out of the way.

In every live-ball situation:

1. **Transition.** Every defender sprints the moment the ball is lost. The nearest one goes for the
   ball handler: he chases from behind or angles in from his own side, never through him (`chase` on
   a beat; the motion layer keeps him on the handler's heels). The others sprint back towards the
   paint and pick up the nearest runner on their side of the handler's line.
2. **Open-lane break.** The chaser ends up about 1.5–2 m from the shooter at the shot, hand up: a
   late contest or chase-down attempt that misses. Anyone else back near the rim steps out at the
   shooter from the side (`lateContest`). This never changes the engine's result.
3. **Every shot**, layups and dunks included: the defender nearest the shooter gets a hand up if he
   is within about 4.5 m (a late contest), and so does any other defender within 2.5 m. Nobody
   further off raises his hands at nothing; on a rebound only those the ball comes down within
   about 2 m of reach for it.
4. **Half court.** No defender is idle. He tracks his man or his zone spot, steps towards the ball
   when it comes his way, and closes out with his hands up on a catch.
5. **After a score or a turnover**, the side that has to defend runs back. Nobody walks or jogs back
   while the ball is live.
6. **Bodies.** No player passes through an opponent, and no defender's run crosses the ball
   handler's path.

## Man-to-man: when to leave your man

A defender stays with his man except in these cases (`guardSpot` in `src/ui/court/formations.ts`,
help in `Motion.updateHelp`, switches and double-team rotations in `animation.ts`):

- **Help side**: two passes away he sinks into the paint on his man's side; he recovers to his man
  (closing out, hands up) if the ball goes there.
- **Stopping the ball**: a driver who has beaten his man near the rim draws the nearest help
  defender in front of him; the next defender rotates to the man the helper left.
- **Switching on screens**: when the two defenders are of a size (no more than one position apart),
  or late in a long possession. The screener's defender shows first, so it is a step, not a run.
- **Double teams and traps**: the second man's own man is left; the nearest other defender rotates
  to him.
- **Transition**: protect the basket first, match up once the ball is stopped (see above).

He stays attached to an **elite shooter** (80+ from three): tight, never sent to help. **One pass
away** he denies: a step into the passing lane, a hand in it. Enforced by `tests/mantoman.test.ts`.

These are enforced by `tests/realism.test.ts` ("defenders always try" and "bodies"). Any animation
change must keep those tests passing.

## Animation changes never change results

Engine results (scores, make rates, `npm run lab`) must be identical before and after an
animation-only change. Check `npm run lab` against a run from before the change.

## Look at what you draw

For every animation change (2D or 3D), capture frames of the affected situation **before and after**
the change, **look at them**, and fix what looks wrong before reporting back. Say in the report which
frames you checked (the folder and file names) and what you saw in them. Numbers and test results
are not a substitute: the user judges the animation by eye, so judge it by eye too, against any
reference pictures the user gave.

- `npm run frames -- --seed <n> --quarter <q> --from <clock> --to <clock> --every <seconds> [--view 2d|3d|both] [--zoom]`
  plays a match headlessly up to a moment and saves PNG frames (the game's own renderers, the clock
  and the commentary line in each image) to `frames/`. `--zoom` frames the area round the ball.
- `?movelab` (dev server) loops one move in slow motion: dribble standing, dribble while running,
  jump shot, layup, dunk, rebound, defensive closeout, fast-break chase.

## Reference values

- **Ball**: radius 11.93 cm, mass 623.7 g, floor bounce restitution 0.8, gravity 9.81 m/s².
- **Dribble cycle**: about 0.75 s standing, about 0.6 s while running.
- **The ball always follows physics**; the hand meets it at the top of the bounce. It never sticks
  to a hand or changes direction in the air.

## Git

Commit or push only when asked.
