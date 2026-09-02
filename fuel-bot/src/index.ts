/**
 * Точка входа.
 *
 * Здесь только сборка: подключаем базу, регистрируем команды и два обработчика
 * (кнопки и текст), запускаем long polling. Никакой бизнес-логики.
 */
import { Bot } from "grammy";
import { findDriverByTgId, seed } from "./db.ts";
import { onCallback } from "./handlers/callbacks.ts";
import { onText } from "./handlers/text.ts";
import { getSession, resetStep } from "./session.ts";
import { showMenu, WELCOME } from "./views.ts";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Не задан BOT_TOKEN. Скопируйте .env.example в .env и вставьте токен от @BotFather.");
  process.exit(1);
}

seed();

const bot = new Bot(token);

// ── Команды ──────────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const tgId = ctx.from?.id;
  if (!tgId) return;

  const driver = findDriverByTgId(tgId);
  if (driver) {
    resetStep(tgId);
    return void (await showMenu(ctx, driver));
  }

  getSession(tgId).step = { name: "await_pin" };
  await ctx.reply(WELCOME, { parse_mode: "Markdown" });
});

bot.command("menu", async (ctx) => {
  const tgId = ctx.from?.id;
  if (!tgId) return;
  const driver = findDriverByTgId(tgId);
  if (!driver) return void (await ctx.reply("Сначала войдите: /start"));
  resetStep(tgId);
  await showMenu(ctx, driver);
});

bot.command("cancel", async (ctx) => {
  const tgId = ctx.from?.id;
  if (!tgId) return;
  const driver = findDriverByTgId(tgId);
  resetStep(tgId);
  if (!driver) return void (await ctx.reply("Отменено. Введите PIN для входа."));
  await showMenu(ctx, driver, "Действие отменено.");
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    [
      "*Команды*",
      "/start — вход и главное меню",
      "/menu — вернуться в меню",
      "/cancel — прервать текущее действие",
      "",
      "Основная работа — кнопками под сообщениями."
    ].join("\n"),
    { parse_mode: "Markdown" }
  );
});

// ── Два источника ввода ──────────────────────────────────────────────────────

bot.on("callback_query:data", onCallback);
bot.on("message:text", onText);

// ── Ошибки ───────────────────────────────────────────────────────────────────

bot.catch((err) => {
  console.error("Ошибка при обработке апдейта:", err.error);
});

// Подсказки команд в меню Telegram.
await bot.api.setMyCommands([
  { command: "start", description: "Вход и главное меню" },
  { command: "menu", description: "Вернуться в меню" },
  { command: "cancel", description: "Прервать текущее действие" },
  { command: "help", description: "Справка" }
]);

console.log("Бот запущен. Ctrl+C для остановки.");
await bot.start();
