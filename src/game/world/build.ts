// Building a world off the main thread (worker.ts); where workers are unavailable, on it. The time it
// took is logged to the console (slice brief W1 §5: well under 5 s in the browser).

import { createWorld } from './generate';
import type { World } from './types';
import type { WorkerReply, WorkerRequest } from './worker';

function here(seed: number, started: number): World {
  const world = createWorld(seed);
  log(performance.now() - started, 'main thread');
  return world;
}

function log(ms: number, where: string) {
  console.info(`[world] created in ${Math.round(ms)} ms (${where})`);
}

export function buildWorld(seed: number): Promise<World> {
  const started = performance.now();
  if (typeof Worker === 'undefined') return Promise.resolve(here(seed, started));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(here(seed, started));
      return;
    }
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      worker.terminate();
      if (e.data.type === 'created') {
        log(e.data.ms, 'worker');
        log(performance.now() - started, 'worker, including start-up and hand-over');
        resolve(e.data.world);
      } else reject(new Error(e.data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      // A worker that cannot start (old browser, blocked): build it here instead.
      resolve(here(seed, started));
    };
    const req: WorkerRequest = { type: 'create', seed };
    worker.postMessage(req);
  });
}
