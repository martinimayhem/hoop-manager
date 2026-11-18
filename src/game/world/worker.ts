// The world's background worker (WORLD_SPEC §14): world building (and, from slice W2, matchdays) runs
// here, so the screen never freezes.

import { createWorld } from './generate';

export type WorkerRequest = { type: 'create'; seed: number };
export type WorkerReply = { type: 'created'; world: ReturnType<typeof createWorld> } | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    if (e.data.type === 'create') {
      const reply: WorkerReply = { type: 'created', world: createWorld(e.data.seed) };
      self.postMessage(reply);
    }
  } catch (err) {
    const reply: WorkerReply = { type: 'error', message: err instanceof Error ? err.message : String(err) };
    self.postMessage(reply);
  }
};
