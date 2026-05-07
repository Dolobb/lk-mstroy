/**
 * Нагрузочный тест: прогоняет обычные пайплайны (КИП + самосвалы) за 3 последних дня
 * и проверяет, что TIS API не вернул 429 / прочих ошибок при максимальной concurrency.
 *
 * Запуск: cd admin && npx tsx scripts/test-pipeline-load.ts
 *
 * Перед запуском оба сервиса должны быть подняты (npm run dev из корня).
 *
 * exit 0 — все ассерты прошли
 * exit 1 — найдены 429 / прочие ошибки / pipeline вернул errors[]
 */

const DT_BASE  = process.env.DT_URL  || 'http://localhost:3002';
const KIP_BASE = process.env.KIP_URL || 'http://localhost:3001';

const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 30 * 60 * 1000; // 30 минут на смену — с запасом

type ShiftType = 'shift1' | 'shift2';

interface DtFetchStatus {
  state: 'running' | 'done' | 'error' | 'not_found';
  date: string;
  shift: ShiftType;
  startedAt?: number;
  finishedAt?: number | null;
  vehiclesProcessed?: number;
  vehiclesSkipped?: number;
  errors?: string[];
}

interface TisStats {
  requests: number;
  retry429: number;
  retryTimeout: number;
  http404: number;
  otherErrors: number;
}

interface TisStatsResponse {
  stats: TisStats | null;
  tokenCount?: number;
  message?: string;
}

function lastNDates(n: number): string[] {
  // YYYY-MM-DD за последние n дней (включая вчера, не сегодня)
  const out: string[] = [];
  const today = new Date();
  for (let i = n; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function http<T = any>(method: 'GET' | 'POST', url: string): Promise<T> {
  const res = await fetch(url, { method });
  if (!res.ok && res.status !== 409) {
    throw new Error(`${method} ${url} → HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function pollDtStatus(date: string, shift: ShiftType): Promise<DtFetchStatus> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const status = await http<DtFetchStatus>(
      'GET',
      `${DT_BASE}/api/dt/admin/fetch/status?date=${date}&shift=${shift}`,
    );
    if (status.state === 'done' || status.state === 'error') return status;
    if (status.state === 'not_found') {
      // Возможно ещё не успел зарегистрироваться, подождём
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    process.stdout.write('.');
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timeout waiting for ${date} ${shift}`);
}

async function getDtStats(): Promise<TisStatsResponse> {
  return http<TisStatsResponse>('GET', `${DT_BASE}/api/dt/admin/tis-stats`);
}

async function getKipStats(): Promise<TisStatsResponse> {
  return http<TisStatsResponse>('GET', `${KIP_BASE}/api/admin/tis-stats`);
}

interface RunReport {
  service: 'dt' | 'kip';
  date: string;
  shift?: ShiftType;
  durationSec: number;
  vehiclesProcessed?: number;
  vehiclesSkipped?: number;
  pipelineErrors: string[];
  tisStatsBefore: TisStats | null;
  tisStatsAfter: TisStats | null;
}

function diffStats(before: TisStats | null, after: TisStats | null): TisStats {
  if (!before || !after) {
    return after ?? { requests: 0, retry429: 0, retryTimeout: 0, http404: 0, otherErrors: 0 };
  }
  return {
    requests:     after.requests     - before.requests,
    retry429:     after.retry429     - before.retry429,
    retryTimeout: after.retryTimeout - before.retryTimeout,
    http404:      after.http404      - before.http404,
    otherErrors:  after.otherErrors  - before.otherErrors,
  };
}

async function runDtShift(date: string, shift: ShiftType): Promise<RunReport> {
  console.log(`\n[DT ] ${date} ${shift} — start`);
  const tisBefore = (await getDtStats()).stats;
  const t0 = Date.now();

  const startResp = await http<{ status: string }>(
    'POST',
    `${DT_BASE}/api/dt/admin/fetch?date=${date}&shift=${shift}`,
  );
  if (startResp.status === 'busy') {
    throw new Error(`DT busy on ${date} ${shift}: ${JSON.stringify(startResp)}`);
  }

  const finalStatus = await pollDtStatus(date, shift);
  const durationSec = Math.round((Date.now() - t0) / 1000);
  const tisAfter = (await getDtStats()).stats;

  console.log(
    `\n[DT ] ${date} ${shift} — done in ${durationSec}s, ` +
    `processed=${finalStatus.vehiclesProcessed ?? 0}, skipped=${finalStatus.vehiclesSkipped ?? 0}, errors=${(finalStatus.errors ?? []).length}`,
  );

  return {
    service: 'dt',
    date,
    shift,
    durationSec,
    vehiclesProcessed: finalStatus.vehiclesProcessed,
    vehiclesSkipped: finalStatus.vehiclesSkipped,
    pipelineErrors: finalStatus.errors ?? [],
    tisStatsBefore: tisBefore,
    tisStatsAfter: tisAfter,
  };
}

async function runKipDay(date: string): Promise<RunReport> {
  console.log(`\n[KIP] ${date} — start`);
  const tisBefore = (await getKipStats()).stats;
  const t0 = Date.now();

  await http('POST', `${KIP_BASE}/api/admin/fetch?date=${date}`);

  // У КИП нет /fetch/status — поллим tis-stats: считаем готовым, когда requests
  // не растёт N подряд (стабильно 30 секунд).
  let lastReq = -1;
  let stableTicks = 0;
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const stats = (await getKipStats()).stats;
    const cur = stats?.requests ?? 0;
    if (cur === lastReq) {
      stableTicks++;
      if (stableTicks >= 10) break; // 10 × 3с = 30с тишины
    } else {
      stableTicks = 0;
      lastReq = cur;
      process.stdout.write('.');
    }
  }
  const durationSec = Math.round((Date.now() - t0) / 1000);
  const tisAfter = (await getKipStats()).stats;
  console.log(`\n[KIP] ${date} — done in ${durationSec}s`);

  return {
    service: 'kip',
    date,
    durationSec,
    pipelineErrors: [],
    tisStatsBefore: tisBefore,
    tisStatsAfter: tisAfter,
  };
}

async function main(): Promise<void> {
  const dates = lastNDates(3);
  console.log('=== Pipeline Load Test ===');
  console.log(`Dates: ${dates.join(', ')}`);
  console.log(`DT base:  ${DT_BASE}`);
  console.log(`KIP base: ${KIP_BASE}`);

  const reports: RunReport[] = [];
  let failures = 0;

  // DT: для каждой даты — обе смены (последовательно, чтобы fetchLock не отбивал)
  for (const date of dates) {
    for (const shift of ['shift1', 'shift2'] as ShiftType[]) {
      try {
        const rep = await runDtShift(date, shift);
        reports.push(rep);
      } catch (err) {
        console.error(`[DT ] ${date} ${shift} FAILED: ${String(err)}`);
        failures++;
      }
    }
  }

  // KIP: для каждой даты — один прогон (одна смена в день в КИП-логике)
  for (const date of dates) {
    try {
      const rep = await runKipDay(date);
      reports.push(rep);
    } catch (err) {
      console.error(`[KIP] ${date} FAILED: ${String(err)}`);
      failures++;
    }
  }

  // Финальный отчёт
  console.log('\n\n=== Report ===');
  console.log('service date       shift  dur(s) processed skipped pipeErr  reqs  retry429 retryTimeout http404 otherErr');
  for (const r of reports) {
    const d = diffStats(r.tisStatsBefore, r.tisStatsAfter);
    const flag = (d.retry429 > 0 || d.otherErrors > 0 || r.pipelineErrors.length > 0) ? '⚠ ' : '  ';
    console.log(
      `${flag}${r.service.padEnd(4)} ${r.date} ${(r.shift ?? '-     ').padEnd(7)} ` +
      `${String(r.durationSec).padStart(5)}  ${String(r.vehiclesProcessed ?? '-').padStart(8)}  ${String(r.vehiclesSkipped ?? '-').padStart(6)}  ` +
      `${String(r.pipelineErrors.length).padStart(6)}  ${String(d.requests).padStart(5)}  ${String(d.retry429).padStart(8)}  ${String(d.retryTimeout).padStart(11)}  ${String(d.http404).padStart(6)}  ${String(d.otherErrors).padStart(7)}`,
    );
  }

  // Ассерты
  console.log('\n=== Assertions ===');
  let assertFails = 0;
  for (const r of reports) {
    const d = diffStats(r.tisStatsBefore, r.tisStatsAfter);
    const tag = `${r.service} ${r.date}${r.shift ? ' ' + r.shift : ''}`;
    if (d.retry429 > 0) {
      console.error(`✗ ${tag}: retry429=${d.retry429} (ожидали 0)`);
      assertFails++;
    }
    if (d.otherErrors > 0) {
      console.error(`✗ ${tag}: otherErrors=${d.otherErrors} (ожидали 0)`);
      assertFails++;
    }
    if (r.pipelineErrors.length > 0) {
      console.error(`✗ ${tag}: pipeline errors=${r.pipelineErrors.length}: ${r.pipelineErrors.slice(0, 3).join('; ')}`);
      assertFails++;
    }
  }

  if (failures > 0 || assertFails > 0) {
    console.error(`\nFAIL: ${failures} прогонов упало, ${assertFails} ассертов нарушено`);
    process.exit(1);
  }
  console.log('\nOK: все прогоны без 429 и прочих ошибок TIS');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
