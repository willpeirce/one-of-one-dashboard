import { installPushWorker, type PushWorkerScope } from './worker.js';

installPushWorker(globalThis as unknown as PushWorkerScope);
