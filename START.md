# Запуск ЛК Мстрой

Каждая команда — в отдельном терминале.

## 1. Единый фронтенд (главное окно)
```bash
cd frontend && npm install && npm run dev
# → http://localhost:5173
```

## 2. КИП техники (вкладка «КИП техники» в iframe)
```bash
cd kip
npm run build --workspace=client   # один раз или после изменений в клиенте
npm run dev:server                 # Express :3001 — API + статика
```

## 3. Тягачи (кнопка «Открыть тягачи» → новая вкладка)
```bash
cd tyagachi && python3 main.py --web --port 8000
# → http://localhost:8000
```

## 4. Гео-интерфейс (кнопка «Гео» в хедере → новая вкладка)
```bash
cd geo-admin/server && npm install && npm run dev
# → http://localhost:3003/admin
```

## 5. Самосвалы API (бэкенд для будущего фронтенда)
```bash
cd dump-trucks/server && npm install && npm run dev
# → http://localhost:3002
```

---

**БД:**
- PostgreSQL 16 (kip): `/usr/local/opt/postgresql@16/bin/pg_ctl -D /usr/local/var/postgresql@16 start`
- PostgreSQL 17 (mstroy/geo/dump-trucks): `/usr/local/opt/postgresql@17/bin/pg_ctl -D /usr/local/var/postgresql@17 start`
