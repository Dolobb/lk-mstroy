/**
 * Конфиг pm2 для запуска на сервере.
 *
 * Node 24 снимает типы с .ts сам, поэтому tsx на сервере не нужен —
 * из зависимостей ставится только grammy (`npm install --omit=dev`).
 *
 * Развёртывание:
 *   rsync -az --exclude node_modules --exclude '.env*' --exclude '*.db' \
 *     ./src ./package.json ./tsconfig.json ./ecosystem.config.cjs \
 *     root@<host>:/opt/fuel-bot/
 *   ssh <host> 'cd /opt/fuel-bot && npm install --omit=dev && pm2 restart fuel-bot'
 */
module.exports = {
  apps: [
    {
      name: "fuel-bot",
      cwd: "/opt/fuel-bot",
      script: "src/index.ts",
      interpreter: "node",
      interpreter_args: "--env-file=.env",

      // Long polling: один процесс, кластер тут невозможен — Telegram отдаст
      // 409 Conflict, если тот же токен опрашивают несколько инстансов.
      instances: 1,
      exec_mode: "fork",

      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "200M",

      out_file: "/var/log/fuel-bot.out.log",
      error_file: "/var/log/fuel-bot.err.log",
      time: true
    }
  ]
};
