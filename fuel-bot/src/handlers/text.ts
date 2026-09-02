/**
 * Текстовые сообщения.
 *
 * Смысл текста зависит от шага диалога: «120» — это остаток при старте смены,
 * объём при выдаче или объём при приёмке. Поэтому здесь единственный switch
 * по session.step, а не десяток разрозненных проверок.
 */
import type { Context } from "grammy";
import { bindDriverToTg, findDriverByPin, findDriverByTgId, findOpenShift, getAtz, getVehicle, searchVehicles } from "../db.ts";
import { currentRemaining, formatLiters, openShift, parseLiters, parseRecipient } from "../domain.ts";
import { backToMenu, confirm, vehicleList } from "../keyboards.ts";
import { getSession, resetStep } from "../session.ts";
import { showMenu, WELCOME } from "../views.ts";

export async function onText(ctx: Context): Promise<void> {
  const tgId = ctx.from?.id;
  const text = ctx.message?.text;
  if (!tgId || !text) return;
  if (text.startsWith("/")) return; // команды обрабатываются отдельно

  const session = getSession(tgId);
  const driver = findDriverByTgId(tgId);

  // ── Вход по PIN ────────────────────────────────────────────────────────────
  if (!driver) {
    const found = findDriverByPin(text.trim());
    if (!found) {
      return void (await ctx.reply("❌ Неверный PIN. Попробуйте ещё раз."));
    }
    bindDriverToTg(found.id, tgId);
    resetStep(tgId);
    return void (await showMenu(ctx, found, `✅ Вы вошли как *${found.full_name}* — учебный водитель.`));
  }

  switch (session.step.name) {
    // ── Старт смены: ввод остатка ────────────────────────────────────────────
    case "await_opening_liters": {
      const parsed = parseLiters(text);
      if (!parsed.ok) return void (await ctx.reply(`❌ ${parsed.error}`));

      const res = openShift(driver.id, session.step.atzId, parsed.value);
      resetStep(tgId);
      if (!res.ok) return void (await showMenu(ctx, driver, `⚠️ ${res.error}`));

      const atz = getAtz(res.value.atz_id);
      return void (await showMenu(
        ctx,
        driver,
        `✅ Шаг 3 из 3. Смена открыта на ${atz?.gos_number ?? "заправщике"}, в цистерне ${formatLiters(parsed.value)} л.\nТеперь можно выдавать топливо.`
      ));
    }

    // ── Выдача: поиск ТС ─────────────────────────────────────────────────────
    case "await_vehicle_query": {
      const query = text.trim();
      if (query.length < 2) return void (await ctx.reply("Введите хотя бы 2 символа госномера."));

      const found = searchVehicles(query);
      if (found.length === 0) {
        return void (await ctx.reply(
          [
            `По «${query}» ничего не нашлось.`,
            "",
            "В учебной базе есть, например, `Е701КХ72`, `Х330ТТ96`, `Т812УУ174`.",
            "Введите фрагмент любого из них — поиск продолжает работать."
          ].join("\n"),
          { parse_mode: "Markdown", reply_markup: backToMenu }
        ));
      }
      return void (await ctx.reply(`Найдено машин: ${found.length}. Выберите нужную:`, {
        reply_markup: vehicleList(found)
      }));
    }

    // ── Выдача: объём ────────────────────────────────────────────────────────
    case "await_dispense_liters": {
      const parsed = parseLiters(text);
      if (!parsed.ok) return void (await ctx.reply(`❌ ${parsed.error}`));

      const shift = findOpenShift(driver.id);
      if (!shift) {
        resetStep(tgId);
        return void (await showMenu(ctx, driver, "⚠️ Смена закрылась. Начните заново."));
      }

      // Ранняя проверка: не заставляем вводить ФИО, если объёма всё равно не хватает.
      const remaining = currentRemaining(shift);
      if (parsed.value > remaining) {
        return void (await ctx.reply(
          `❌ В цистерне только ${formatLiters(remaining)} л. Введите объём не больше этого.`
        ));
      }

      session.step = { name: "await_recipient", vehicleId: session.step.vehicleId, liters: parsed.value };
      return void (await ctx.reply(
        [
          "Кто принимает топливо? Фамилия и инициалы водителя машины —",
          "он расписывается за полученное.",
          "",
          "Например: `Петров П.П.` В демо подойдёт любая фамилия."
        ].join("\n"),
        { parse_mode: "Markdown" }
      ));
    }

    // ── Выдача: получатель и подтверждение ───────────────────────────────────
    case "await_recipient": {
      const parsed = parseRecipient(text);
      if (!parsed.ok) return void (await ctx.reply(`❌ ${parsed.error}`));

      const { vehicleId, liters } = session.step;
      const vehicle = getVehicle(vehicleId);
      session.step = { name: "confirm_dispense", vehicleId, liters, recipient: parsed.value };

      return void (await ctx.reply(
        [
          "*Проверьте перед записью*",
          "",
          `ТС: ${vehicle?.gos_number ?? "—"} · ${vehicle?.mark ?? "—"}`,
          `Организация: ${vehicle?.org_name ?? "—"}`,
          `Объём: *${formatLiters(liters)} л*`,
          `Получатель: ${parsed.value}`
        ].join("\n"),
        { parse_mode: "Markdown", reply_markup: confirm("dispense:save") }
      ));
    }

    // ── Приёмка: объём и подтверждение ───────────────────────────────────────
    case "await_receipt_liters": {
      const parsed = parseLiters(text);
      if (!parsed.ok) return void (await ctx.reply(`❌ ${parsed.error}`));

      session.step = { name: "confirm_receipt", liters: parsed.value };
      return void (await ctx.reply(
        ["*Проверьте перед записью*", "", `Принимаем: *${formatLiters(parsed.value)} л*`].join("\n"),
        { parse_mode: "Markdown", reply_markup: confirm("receipt:save") }
      ));
    }

    // ── Вне сценария ─────────────────────────────────────────────────────────
    default:
      return void (await showMenu(ctx, driver, "Здесь бот не ждёт текст — выберите действие кнопкой ниже."));
  }
}

export { WELCOME };
