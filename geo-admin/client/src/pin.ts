// Окно ввода PIN для записи (создание/правка/удаление объектов и зон).
// Проверка — на сервере; после верного PIN браузер получает cookie на 30 дней
// (та же, что и для админ-раздела ЛК).

let pending: Promise<boolean> | null = null;

/** Показывает окно PIN. true — вход выполнен, false — пользователь отменил. */
export function askPin(): Promise<boolean> {
  if (pending) return pending;
  pending = new Promise<boolean>(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '10000';
    overlay.innerHTML = `
      <div class="modal-box" style="width: 320px; text-align: center">
        <h3>Нужен PIN-код</h3>
        <p style="font-size: 13px; color: #6b7280; margin-bottom: 12px">
          Изменять объекты и зоны можно только с PIN-кодом администратора.
        </p>
        <input id="pin-input" type="password" inputmode="numeric" maxlength="4" autocomplete="off"
          style="text-align: center; font-size: 22px; letter-spacing: 0.5em" aria-label="PIN-код" />
        <div id="pin-error" style="min-height: 2.4em; font-size: 12px; color: #dc2626; margin-top: 8px"></div>
        <div class="form-actions" style="justify-content: center">
          <button type="button" class="btn-cancel" id="pin-cancel">Отмена</button>
          <button type="button" class="btn-primary" id="pin-ok">Войти</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector<HTMLInputElement>('#pin-input')!;
    const errorEl = overlay.querySelector<HTMLDivElement>('#pin-error')!;
    const okBtn = overlay.querySelector<HTMLButtonElement>('#pin-ok')!;

    const finish = (ok: boolean) => {
      overlay.remove();
      pending = null;
      resolve(ok);
    };

    const submit = async () => {
      const pin = input.value.replace(/\D/g, '');
      if (pin.length !== 4) { errorEl.textContent = 'PIN — 4 цифры'; return; }
      okBtn.disabled = true;
      errorEl.textContent = '';
      try {
        const res = await fetch('/api/geo/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin }),
        });
        const body = await res.json().catch(() => ({})) as { attemptsLeft?: number; retryAfterSec?: number; error?: string };
        if (res.ok) { finish(true); return; }
        input.value = '';
        if (res.status === 429) {
          errorEl.textContent = `Слишком много неверных попыток. Подождите ${body.retryAfterSec ?? 60} с.`;
        } else if (res.status === 401) {
          errorEl.textContent = `Неверный PIN${body.attemptsLeft != null ? ` — осталось попыток: ${body.attemptsLeft}` : ''}`;
        } else {
          errorEl.textContent = body.error || 'Не удалось проверить PIN';
        }
      } catch {
        errorEl.textContent = 'Сервер не отвечает';
      } finally {
        okBtn.disabled = false;
        input.focus();
      }
    };

    okBtn.addEventListener('click', submit);
    overlay.querySelector('#pin-cancel')!.addEventListener('click', () => finish(false));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      if (input.value.length === 4) submit();
    });
    input.focus();
  });
  return pending;
}
