# Frontend — AI Reports

## Компоненты

```
frontend/src/features/ai-reports/
├── AiReportsPage.tsx   — основная страница с чатом
├── ChatMessage.tsx      — рендеринг одного сообщения (user / assistant)
├── ChatInput.tsx        — поле ввода с авто-resize и отправкой по Enter
├── types.ts             — типы
└── index.ts             — реэкспорт
```

## AiReportsPage

- Роут: `/reports`
- Навигация: кнопка "Отчёты AI" в TopNavBar (правая часть, иконка Sparkles)
- Layout: `glass-card` на всю высоту, как у других страниц
- Два состояния:
  - **Пустое**: приветствие + 4 кнопки-примера запросов
  - **С сообщениями**: скролл-контейнер с сообщениями

## useChat (Vercel AI SDK v6)

```tsx
const { messages, sendMessage, status, error } = useChat({
  transport: { type: 'http', api: '/api/reports/chat' },
});
```

- `sendMessage({ text })` — отправка сообщения
- `status` — 'submitted' | 'streaming' | 'ready' | 'error'
- `messages` — массив UIMessage с `.parts` (text, tool-call, tool-result)
- Input управляется через local `useState` (не встроен в useChat v6)

## ChatMessage

- **User**: оранжевый пузырь справа (bg-primary)
- **Assistant**: серый пузырь слева (bg-card-inner) с аватаром Bot
- Ищет ссылки `/api/reports/files/*` в тексте → кнопка "Скачать отчёт"
- Кнопка скачивания: зелёная (accent), иконка Download

## ChatInput

- Textarea с авто-resize (max 120px)
- Enter = отправить, Shift+Enter = новая строка
- Кнопка Send (оранжевая) / Loader при загрузке
- Disabled при isLoading

## Стили

Полное соответствие дизайн-системе ЛК:
- `glass-card` для основного контейнера
- CSS переменные: `--card-inner`, `--primary`, `--muted-foreground`
- `custom-scrollbar` для области сообщений
- Размер шрифтов: `text-xs` (11px) — как во всём ЛК
