// Building a world off the main thread (worker.ts); where workers are unavailable, on it.

import { createWorld } from './generate';
import type { World } from './types';
import type { WorkerReply, WorkerRequest } from './worker';

export function buildWorld(seed: number): Promise<World> {
  if (typeof Worker === 'undefined') return Promise.resolve(createWorld(seed));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(createWorld(seed));
      return;
    }
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      worker.terminate();
      if (e.data.type === 'created') resolve(e.data.world);
      else reject(new Error(e.data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      // A worker that cannot start (old browser, blocked): build it here instead.
      resolve(createWorld(seed));
    };
    const req: WorkerRequest = { type: 'create', seed };
    worker.postMessage(req);
  });
}
