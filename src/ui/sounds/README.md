# Sound files

The game uses these recordings through `RECIPES` in `../sound.ts`, which cuts, fades and levels
each one as it loads: the files here are never changed. Every other sound is synthesised, and so
is any sound whose file goes missing. Files here are bundled with the game; `unused/` is not.

## What plays where, and why

| Sound | Recording | Edit | Why |
|---|---|---|---|
| Swish | `basketball-swish_OMsr9CN.mp3` | Starts at 0.2 s, ends at 1.1 s, 0.2 s fade | The first 0.2 s is silence; cut, the swish lands as the ball drops through |
| Free-throw swish | `ElevenLabs_Swoosh_…crisp.mp3` | First 0.65 s, 0.15 s fade | Softer, for the hush at the line; the 2.5 s of silence after it dropped |
| Rim | `basketball_rim_hit.wav` | As is, 0.1 s fade | Every miss off the iron |
| Dunk | `dunk.mp3` | 0.85 s to 2.6 s, 0.5 s fade; the sub-bass hit at 0.25–0.45 s laid under the start (70%), bass +4 dB below 150 Hz | The file has a deep whoomp, then the slam on the rim and its rattle half a second later, with silence around both: cut to the slam with the whoomp under it, it lands with a boom |
| Cheer (home basket, home steal or block) | `loud-crowd-cheering.mp3`, `ElevenLabs_Crowd_cheering_…atmosphere.mp3` | Fades at the end; a different one each time | Short bursts; alternating keeps back-to-back baskets from sounding copied |
| Big cheer (home three or dunk) | `cheer-from-crowd.mp3` | Starts at 0.45 s, about 3.5 s used | It builds into a roar; starting in, the crowd reacts the instant the shot drops |
| Ovation (quarter end, home win) | `crowd-cheer.mp3` | 3.5 s at a quarter end, all of it (with the big cheer on top) for a win | Long, steady and bright |
| Background crowd | `crowd-cheering-sound-effect-download.mp3` | 4.5 s to 11 s, looped with a 1 s crossfade | The only long stretch at an even level; quiet during play, louder late in a close game, a murmur in breaks |

Cuts are levelled when they load: crowds to the same average loudness, short hits (swish, rim) to
the same peak. That keeps every take of a sound equally loud. Each crowd take also plays a few
per cent faster or slower at random, so no two reactions are identical.

Still synthesised, because none of these recordings covers them: applause, boos, groans, "ooh",
the whistle, the buzzer and a block's slap. A recording of any of them can be
added to `RECIPES` the same way.

## Not used (`unused/`)

- `crowd-cheering-sound-effect-download_hsktrvu.mp3`: the same recording as the one used for the
  background crowd (identical loudness from start to finish), saved twice.
- `sound_2018_10_19_18_59_33_604_kv9PSN7.mp3`: 3 s of crowd voices, steady then fading. Not clearly
  a cheer, a groan or a chant, so it is left out until we know what it is.

## Licences

Check that every recording here may be used in the game: ElevenLabs output under the terms of your
ElevenLabs plan, and downloaded effects under the licence of the site they came from.
