/**
 * In-memory progress tracker for KIP segment fetch jobs.
 * Survives page refresh, NOT server restart.
 *
 * Smart queue: skips jobs whose idMO is in cooldown,
 * auto-retries when cooldown expires.
 */

export interface SegmentJob {
  vehicleId: string;
  date: string;
  shift: string;
  idMO?: number;
  status: 'queued' | 'running' | 'done' | 'error';
  segmentsDone: number;  // 0..24
  startedAt?: number;
  error?: string;
}

interface SegmentProgressState {
  queue: SegmentJob[];
  active: SegmentJob[];
  completed: SegmentJob[];   // last 50
  maxConcurrent: number;
}

const state: SegmentProgressState = {
  queue: [],
  active: [],
  completed: [],
  maxConcurrent: 1,
};

let processQueueFn: (() => void) | null = null;
let cooldownCheckFn: ((idMO: number) => boolean) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let nextCooldownFn: (() => number | null) | null = null;

export function setMaxConcurrent(n: number): void {
  state.maxConcurrent = Math.max(1, n);
}

export function setProcessQueueFn(fn: () => void): void {
  processQueueFn = fn;
}

/**
 * Set cooldown checker: returns true if idMO can be fetched now.
 */
export function setCooldownChecker(fn: (idMO: number) => boolean): void {
  cooldownCheckFn = fn;
}

/**
 * Set function that returns ms until next cooldown expires, or null if none.
 */
export function setNextCooldownFn(fn: () => number | null): void {
  nextCooldownFn = fn;
}

export function enqueue(vehicleId: string, date: string, shift: string): SegmentJob {
  // Check if already exists
  const existing = [...state.queue, ...state.active].find(
    j => j.vehicleId === vehicleId && j.date === date && j.shift === shift,
  );
  if (existing) return existing;

  const job: SegmentJob = {
    vehicleId,
    date,
    shift,
    status: 'queued',
    segmentsDone: 0,
  };
  state.queue.push(job);

  // Trigger queue processing
  if (processQueueFn) processQueueFn();

  return job;
}

export function markRunning(vehicleId: string, date: string, shift: string): void {
  const idx = state.queue.findIndex(
    j => j.vehicleId === vehicleId && j.date === date && j.shift === shift,
  );
  if (idx >= 0) {
    const job = state.queue.splice(idx, 1)[0]!;
    job.status = 'running';
    job.startedAt = Date.now();
    state.active.push(job);
  }
}

export function updateProgress(vehicleId: string, date: string, shift: string, segmentsDone: number): void {
  const job = state.active.find(
    j => j.vehicleId === vehicleId && j.date === date && j.shift === shift,
  );
  if (job) job.segmentsDone = segmentsDone;
}

export function markDone(vehicleId: string, date: string, shift: string): void {
  const idx = state.active.findIndex(
    j => j.vehicleId === vehicleId && j.date === date && j.shift === shift,
  );
  if (idx >= 0) {
    const job = state.active.splice(idx, 1)[0]!;
    job.status = 'done';
    job.segmentsDone = 24;
    state.completed.push(job);
    if (state.completed.length > 50) state.completed.shift();
  }
}

export function markError(vehicleId: string, date: string, shift: string, error: string): void {
  const idx = state.active.findIndex(
    j => j.vehicleId === vehicleId && j.date === date && j.shift === shift,
  );
  if (idx >= 0) {
    const job = state.active.splice(idx, 1)[0]!;
    job.status = 'error';
    job.error = error;
    state.completed.push(job);
    if (state.completed.length > 50) state.completed.shift();
  }
}

export function getProgress(): SegmentProgressState {
  return {
    queue: [...state.queue],
    active: [...state.active],
    completed: [...state.completed],
    maxConcurrent: state.maxConcurrent,
  };
}

export function hasSlot(): boolean {
  return state.active.length < state.maxConcurrent;
}

/**
 * Smart queue: find first job whose idMO is NOT in cooldown.
 * Jobs without idMO (not yet resolved) are allowed — cooldown checked in the job itself.
 */
export function nextQueued(): SegmentJob | undefined {
  if (!cooldownCheckFn) {
    return state.queue[0];
  }

  for (const job of state.queue) {
    if (!job.idMO) return job; // idMO not known yet — let the job resolve it
    if (cooldownCheckFn(job.idMO)) return job;
  }

  // All queued jobs are in cooldown — schedule auto-retry
  scheduleRetry();
  return undefined;
}

/**
 * Schedule a retry when the nearest cooldown expires.
 */
function scheduleRetry(): void {
  if (retryTimer) return; // already scheduled
  if (!nextCooldownFn || !processQueueFn) return;

  const waitMs = nextCooldownFn();
  if (waitMs == null || waitMs <= 0) return;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (processQueueFn) processQueueFn();
  }, waitMs + 100); // +100ms safety margin
}
