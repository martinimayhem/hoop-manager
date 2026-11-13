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
3. **Every shot**, layups and dunks included: every defender within about 4.5 m of the shooter gets a
   hand up. Only one further away may leave his hands down.
4. **Half court.** No defender is idle. He tracks his man or his zone spot, steps towards the ball
   when it comes his way, and closes out with his hands up on a catch.
5. **After a score or a turnover**, the side that has to defend runs back. Nobody walks or jogs back
   while the ball is live.
6. **Bodies.** No player passes through an opponent, and no defender's run crosses the ball
   handler's path.

These are enforced by `tests/realism.test.ts` ("defenders always try" and "bodies"). Any animation
change must keep those tests passing.

## Animation changes never change results

Engine results (scores, make rates, `npm run lab`) must be identical before and after an
animation-only change. Check `npm run lab` against a run from before the change.

## Git

Commit or push only when asked.
