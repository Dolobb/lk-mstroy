/**
 * PIN-защита записи в гео-админке. Чтение (карты, списки зон) — свободное.
 *
 * Сессию выдаёт и проверяет admin (:3005, admin/src/auth.ts): cookie привязана к хосту,
 * поэтому та же cookie приходит и сюда (:3003). Проверяем её запросом к admin.
 * Внутренние вызовы (loopback без X-Forwarded-For, напр. скрипты на сервере) — без PIN.
 */
import type { Express, Request, Response, NextFunction } from 'express';
import { logger } from './utils/logger';

const ADMIN_URL = process.env.ADMIN_URL || 'http://127.0.0.1:3005';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isLoopback(addr: string | undefined): boolean {
  return !!addr && (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1');
}

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (isLoopback(req.socket.remoteAddress) && typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

export function isInternal(req: Request): boolean {
  return isLoopback(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
}

async function adminCall(path: string, req: Request, init: RequestInit = {}): Promise<globalThis.Response> {
  return fetch(`${ADMIN_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      cookie: req.headers.cookie ?? '',
      'x-forwarded-for': clientIp(req),
    },
  });
}

export function registerGeoAuth(app: Express): void {
  // Логин/статус проксируются в admin — гео-админка открыта на своём порту, /api/admin тут нет.
  app.get('/api/geo/auth/status', async (req: Request, res: Response) => {
    try {
      const r = await adminCall('/api/admin/auth/status', req);
      res.status(r.status).json(await r.json());
    } catch {
      res.status(503).json({ error: 'Сервис админки недоступен' });
    }
  });

  app.post('/api/geo/auth/login', async (req: Request, res: Response) => {
    try {
      const r = await adminCall('/api/admin/auth/login', req, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      const setCookie = r.headers.get('set-cookie');
      if (setCookie) res.setHeader('Set-Cookie', setCookie);
      res.status(r.status).json(await r.json());
    } catch {
      res.status(503).json({ error: 'Сервис админки недоступен' });
    }
  });

  app.use('/api/geo', async (req: Request, res: Response, next: NextFunction) => {
    if (!WRITE_METHODS.has(req.method) || req.path.startsWith('/auth/')) return next();
    if (isInternal(req)) return next();
    try {
      const r = await adminCall('/api/admin/auth/status', req);
      const body = await r.json() as { authenticated?: boolean };
      if (body.authenticated) return next();
      res.status(401).json({ error: 'pin_required' });
    } catch (err) {
      logger.warn(`[auth] admin недоступен для проверки PIN: ${String(err)}`);
      res.status(503).json({ error: 'Не удалось проверить PIN: сервис админки недоступен' });
    }
  });
}
