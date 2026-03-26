import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { Bot, FileSpreadsheet, Truck, BarChart3, Wrench, Sparkles } from 'lucide-react';

const EXAMPLE_PROMPTS = [
  { icon: FileSpreadsheet, text: 'Сводка КИП по всей технике за прошлую неделю' },
  { icon: Truck, text: 'Рейсы самосвалов на Тобольске за эту неделю' },
  { icon: BarChart3, text: 'Покажи ТС с расходом топлива выше нормы за февраль' },
  { icon: Wrench, text: 'Сколько самосвалов было в ремонте за последний месяц' },
];

export const AiReportsPage: React.FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');

  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/reports/chat' }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({ transport });

  const isLoading = status === 'submitted' || status === 'streaming';

  // Авто-скролл при новых сообщениях
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;
    const text = input;
    setInput('');
    await sendMessage({ text });
  };

  const handleExampleClick = (text: string) => {
    setInput(text);
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full overflow-hidden p-3 gap-3">
      {/* Контент */}
      <div className="flex-1 min-h-0 flex flex-col glass-card rounded-[18px] overflow-hidden">
        {isEmpty ? (
          /* Пустое состояние — приветствие */
          <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>

            <div className="text-center max-w-md">
              <h2 className="text-lg font-semibold text-foreground mb-2">
                AI-конструктор отчётов
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Опишите какой отчёт вам нужен — система достанет данные из баз
                и сгенерирует готовый Excel-файл.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {EXAMPLE_PROMPTS.map((ex, i) => {
                const Icon = ex.icon;
                return (
                  <button
                    key={i}
                    onClick={() => handleExampleClick(ex.text)}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl
                      bg-card-inner/50 hover:bg-card-inner text-left
                      border border-border/50 hover:border-border
                      transition-all cursor-pointer group"
                  >
                    <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                    <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors leading-snug">
                      {ex.text}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* Сообщения чата */
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4"
          >
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Bot className="w-4 h-4 animate-pulse" />
                <span className="text-xs">Обрабатываю запрос...</span>
              </div>
            )}

            {error && (
              <div className="text-xs text-destructive bg-destructive/10 rounded-xl p-3">
                Ошибка: {error.message}
              </div>
            )}
          </div>
        )}

        {/* Поле ввода */}
        <div className="shrink-0 border-t border-border/50 p-3">
          <ChatInput
            input={input}
            onChange={(e) => setInput(e.target.value)}
            onSubmit={handleSubmit}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
};
