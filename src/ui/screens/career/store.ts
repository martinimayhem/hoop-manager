// Where careers are saved in this browser: IndexedDB if allowed, else memory (WORLD_SPEC §14).

import { browserWorldStore } from '../../../game/world/saves';

export const careerStore = browserWorldStore();
