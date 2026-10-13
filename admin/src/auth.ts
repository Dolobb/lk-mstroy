/**
 * Простая защита админки PIN-кодом (без учёток и ролей).
 *
 * - PIN — в admin/.env (ADMIN_PIN). Не задан → защита выключена (warning в лог).
 * - После верного PIN ставится httpOnly-cookie на 30 дней. Cookie подписана HMAC-ключом,
 *   производным от PIN → смена PIN разлогинивает всех.
 * - Cookie привязана к хосту (не к порту) → та же cookie работает и для гео-админки (:3003),
 *   которая проверяет её через GET /api/admin/auth/status.
 * - Внутренние вызовы между сервисами (loopback без X-Forwarded-For) PIN не требуют.
 *   Запросы через Caddy всегда несут X-Forwarded-For → считаются внешними.
 * - Брутфорс: 5 неверных попыток с одного IP → пауза 1 минута.
 */
import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { log } from './logger';

export const SESSION_COOKIE = 'lk_admin_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const BLOCK_MS = 60 * 1000;

const PUBLIC_PATHS = new Set(['/api/admin/auth/login', '/api/admin/auth/status', '/api/admin/auth/logout']);

function pin(): string {
  return (process.env.ADMIN_PIN || '').trim();
}

export function isAuthEnabled(): boolean {
  return pin().length > 0;
}

function sessionKey(): Buffer {
  return crypto.createHash('sha256').update(`lk-admin-session:${pin()}`).digest();
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', sessionKey()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function hasValidSession(req: Request): boolean {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(exp));
}

function isLoopback(addr: string | undefined): boolean {
  return !!addr && (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1');
}

/** Вызов от другого локального сервиса (не через Caddy и не из LAN). */
export function isInternalRequest(req: Request): boolean {
  return isLoopback(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
}

export function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (isLoopback(req.socket.remoteAddress) && typeof xff === 'string' && xff) {
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

const attempts = new Map<string, { fails: number; blockedUntil: number }>();

function cookieHeader(value: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function registerAuth(app: Express): void {
  if (!isAuthEnabled()) {
    log.warn({ category: 'admin', msg: 'ADMIN_PIN не задан в admin/.env — админка НЕ защищена' });
  }

  app.get('/api/admin/auth/status', (req, res) => {
    const enabled = isAuthEnabled();
    res.json({ enabled, authenticated: !enabled || hasValidSession(req) });
  });

  app.post('/api/admin/auth/login', (req, res) => {
    if (!isAuthEnabled()) return res.json({ ok: true });
    const ip = clientIp(req);
    const now = Date.now();
    const st = attempts.get(ip) ?? { fails: 0, blockedUntil: 0 };
    if (st.blockedUntil > now) {
      const retryAfterSec = Math.ceil((st.blockedUntil - now) / 1000);
      return res.status(429).json({ error: 'too_many_attempts', retryAfterSec });
    }
    const entered = String((req.body as { pin?: unknown })?.pin ?? '').trim();
    if (!safeEqual(entered, pin())) {
      st.fails += 1;
      if (st.fails >= MAX_FAILS) {
        st.fails = 0;
        st.blockedUntil = now + BLOCK_MS;
        log.warn({ category: 'admin', msg: 'PIN: 5 неверных попыток, пауза 1 мин', fields: { ip } });
        attempts.set(ip, st);
        return res.status(429).json({ error: 'too_many_attempts', retryAfterSec: BLOCK_MS / 1000 });
      }
      attempts.set(ip, st);
      return res.status(401).json({ error: 'wrong_pin', attemptsLeft: MAX_FAILS - st.fails });
    }
    attempts.delete(ip);
    const exp = String(now + SESSION_TTL_MS);
    res.setHeader('Set-Cookie', cookieHeader(`${exp}.${sign(exp)}`, SESSION_TTL_MS / 1000));
    log.info({ category: 'admin', msg: 'PIN: вход выполнен', fields: { ip } });
    res.json({ ok: true });
  });

  app.post('/api/admin/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', cookieHeader('', 0));
    res.json({ ok: true });
  });

  // Всё остальное под /api/admin/* — только с PIN-сессией или от локального сервиса.
  app.use('/api/admin', (req: Request, res: Response, next: NextFunction) => {
    if (!isAuthEnabled()) return next();
    if (PUBLIC_PATHS.has(req.originalUrl.split('?')[0])) return next();
    if (isInternalRequest(req) || hasValidSession(req)) return next();
    res.status(401).json({ error: 'pin_required' });
  });
}
