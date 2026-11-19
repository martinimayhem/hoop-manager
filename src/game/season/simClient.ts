// Matchdays off the main thread (WORLD_SPEC §14): one worker for the career, kept open, fed a day's
// games at a time. Where workers are unavailable, the games are played here instead (the results are
// the same: every game decides itself from its seed). The last matchday's time is kept for the screen
// and the console (slice brief W2a: under 1 s in the browser).

import type { WorkerReply, WorkerRequest } from '../world/worker';
import { simulateInputs, type GameOutput, type SimInput } from './play';

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, { resolve: (o: GameOutput[]) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return (worker = null);
  try {
    worker = new Worker(new URL('../world/worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return (worker = null);
  }
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const r = e.data;
    if (r.type === 'simmed') {
      waiting.get(r.id)?.resolve(r.outputs);
      waiting.delete(r.id);
    } else if (r.type === 'error' && r.id !== undefined) {
      waiting.get(r.id)?.reject(new Error(r.message));
      waiting.delete(r.id);
    }
  };
  worker.onerror = () => {
    // A worker that cannot run: everything from now on is played here.
    worker?.terminate();
    worker = null;
    for (const [, w] of waiting) w.reject(new Error('worker failed'));
    waiting.clear();
  };
  return worker;
}

/** Timing of the last matchday (ms): the games, and everything round them. */
export const lastTiming = { games: 0, sim: 0 };

/** Plays a day's games (in the worker when there is one). */
export async function simulateDay(inputs: SimInput[]): Promise<GameOutput[]> {
  const t = performance.now();
  const wk = getWorker();
  let out: GameOutput[];
  if (!wk) out = simulateInputs(inputs);
  else {
    try {
      out = await new Promise<GameOutput[]>((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        const req: WorkerRequest = { type: 'sim', id, inputs };
        wk.postMessage(req);
      });
    } catch {
      out = simulateInputs(inputs);
    }
  }
  lastTiming.games = inputs.length;
  lastTiming.sim = performance.now() - t;
  return out;
}
