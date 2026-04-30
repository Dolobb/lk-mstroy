import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'dt-audit.jsonl');
const ROTATE_BYTES = 10 * 1024 * 1024;

let stream: fs.WriteStream | null = null;

function rotateIfBig(): void {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < ROTATE_BYTES) return;
    if (stream) { stream.end(); stream = null; }
    fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch { /* file missing — fine */ }
}

function getStream(): fs.WriteStream {
  if (stream) return stream;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  rotateIfBig();
  stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  return stream;
}

export interface PlSummaryEvent {
  kind: 'pl_summary';
  runId: string | null;
  date: string;
  shift: 'shift1' | 'shift2';
  fetchRange: string;
  tisCount: number;
  upsertedCount: number;
  dbOverlapCount: number;
  plsWithSamosval: number;
  uniqueVehicles: number;
  dateOutDist: Record<string, number>;
}

export type Verdict =
  | 'processed'
  | 'no_monitoring'
  | 'engine_below_threshold'
  | 'no_object_detected'
  | 'processing_error';

export interface VehicleDecisionEvent {
  kind: 'vehicle_decision';
  runId: string | null;
  date: string;
  shift: 'shift1' | 'shift2';
  idMO: number;
  nameMO: string;
  plId?: number;
  tz: string;
  engineSec: number;
  trackPoints: number;
  zoneEvents: number;
  detectedObject: string | null;
  verdict: Verdict;
  reason?: string;
}

export function auditLog(event: PlSummaryEvent | VehicleDecisionEvent): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
    getStream().write(line);
  } catch {
    // never throw from audit
  }
}
