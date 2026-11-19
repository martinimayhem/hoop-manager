// The world's background worker (WORLD_SPEC §14): world building and matchdays run here, so the screen
// never freezes. A matchday arrives as the games' inputs (the teams that dress, your plan, the seed)
// and goes back as results; the worker keeps nothing between messages.

import { simulateInputs, type GameOutput, type SimInput } from '../season/play';
import { createWorld } from './generate';

export type WorkerRequest = { type: 'create'; seed: number } | { type: 'sim'; id: number; inputs: SimInput[] };
export type WorkerReply =
  | { type: 'created'; world: ReturnType<typeof createWorld>; ms: number }
  | { type: 'simmed'; id: number; outputs: GameOutput[]; ms: number }
  | { type: 'error'; id?: number; message: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    const t = performance.now();
    if (req.type === 'create') {
      const world = createWorld(req.seed);
      const reply: WorkerReply = { type: 'created', world, ms: performance.now() - t };
      self.postMessage(reply);
    } else if (req.type === 'sim') {
      const outputs = simulateInputs(req.inputs);
      const reply: WorkerReply = { type: 'simmed', id: req.id, outputs, ms: performance.now() - t };
      self.postMessage(reply);
    }
  } catch (err) {
    const reply: WorkerReply = { type: 'error', ...(req.type === 'sim' ? { id: req.id } : {}), message: err instanceof Error ? err.message : String(err) };
    self.postMessage(reply);
  }
};
