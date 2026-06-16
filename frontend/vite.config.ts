import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import type { ProxyOptions } from 'vite';

// Глушим спам ECONNREFUSED, пока бэкенды ещё не подняты, и троттлим прочие ошибки.
const lastErrAt = new Map<string, number>();
function quietProxy(target: string, extra: Partial<ProxyOptions> = {}): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    ...extra,
    configure(proxy) {
      proxy.on('error', (err: NodeJS.ErrnoException, req, res) => {
        const code = err.code ?? 'ERR';
        if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EAI_AGAIN') {
          const key = `${target}|${code}`;
          const now = Date.now();
          const prev = lastErrAt.get(key) ?? 0;
          if (now - prev > 30_000) {
            lastErrAt.set(key, now);
            console.warn(`[proxy] ${target}: ${code} (бэкенд не отвечает; повтор через ≥30с)`);
          }
        } else {
          console.warn(`[proxy] ${target}: ${code} ${err.message}`);
        }
        if (res && 'writeHead' in res && !res.headersSent) {
          try { res.writeHead(502, { 'Content-Type': 'application/json' }); } catch {}
          try { res.end(JSON.stringify({ error: 'backend_unavailable', code })); } catch {}
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      host: true,
      allowedHosts: 'all',
      proxy: {
        '/api/vs': quietProxy('http://localhost:3004'),
        '/api/dt': quietProxy('http://localhost:3002'),
        '/api/kip': quietProxy('http://localhost:3001', {
          rewrite: (path) => path.replace(/^\/api\/kip/, '/api'),
        }),
        '/api/tyagachi': quietProxy('http://localhost:8000', {
          rewrite: (path) => path.replace(/^\/api\/tyagachi/, '/api'),
        }),
        '/api/admin': quietProxy('http://localhost:3005'),
        '/api/reports': quietProxy('http://localhost:3006'),
        '/api/geo': quietProxy('http://localhost:3003'),
        '/api/analytics': quietProxy('http://localhost:3007'),
        // По умолчанию — боевой VPS. Для локальной разработки/смоук-теста новых admin-эндпоинтов
        // задать FUEL_API_TARGET=http://localhost:4000 в frontend/.env.local (см. fuel-backend dev :4000),
        // чтобы мутации не уходили в продакшн.
        '/api/fuel': quietProxy(env.FUEL_API_TARGET ?? 'https://atz.pisarenkovmax.ru', {
          rewrite: (path) => path.replace(/^\/api\/fuel/, '/admin'),
          headers: { Authorization: `Bearer ${env.FUEL_ADMIN_TOKEN ?? ''}` },
        }),
      },
    },
    build: {
      outDir: 'dist',
    },
  };
});
