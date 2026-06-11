import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatHistoryPanel } from './ChatHistoryPanel';
import { useChatHistory } from './useChatHistory';
import { Bot, Sparkles, Zap, Database, Shield, TrendingUp, History, Play } from 'lucide-react';

const EXAMPLE_PROMPTS = [
  { icon: TrendingUp, text: 'КИП техники за май 2026 по всем бульдозерам, разбивка по СМУ' },
  { icon: Zap, text: 'Рейсы самосвалов по объектам за прошлую неделю, сводка с количеством' },
  { icon: Database, text: 'Реестр всех ТС в системе с госномерами' },
  { icon: Shield, text: 'Ремонты и ТО за последние 3 месяца, сгруппируй по типу' },
];

// ──────────────────────────────────────────────
// Live chat area (remounts when liveId changes)
// ──────────────────────────────────────────────
interface LiveChatAreaProps {
  sessionId: string;
  initialMessages?: UIMessage[];
  onMessagesChange: (sessionId: string, messages: UIMessage[]) => void;
}

const LiveChatArea: React.FC<LiveChatAreaProps> = ({ sessionId, initialMessages, onMessagesChange }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');

  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/reports/chat' }),
    [],
  );

  // @ai-sdk/react v3: initial messages passed as "messages", not "initialMessages"
  const { messages, sendMessage, status, error } = useChat({ transport, messages: initialMessages });

  const isLoading = status === 'submitted' || status === 'streaming';

  // Save only after streaming completes (not on every token)
  const hasSentMessage = useRef(false);
  useEffect(() => {
    if (!isLoading && messages.length > 0 && hasSentMessage.current) {
      onMessagesChange(sessionId, messages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;
    hasSentMessage.current = true;
    const text = input;
    setInput('');
    await sendMessage({ text });
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col glass-card rounded-[18px] overflow-hidden">
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>

          <div className="text-center max-w-md">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Ассистент НПС
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              AI-помощник для генерации отчётов. Опиши что нужно —
              запрошу данные из баз и создам Excel-файл.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
            {EXAMPLE_PROMPTS.map((ex, i) => {
              const Icon = ex.icon;
              return (
                <button
                  key={i}
                  onClick={() => setInput(ex.text)}
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

      <div className="shrink-0 border-t border-border/50 p-3">
        <ChatInput
          input={input}
          onChange={(e) => setInput(e.target.value)}
          onSubmit={handleSubmit}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
// History view — read-only
// ──────────────────────────────────────────────
const HistoryView: React.FC<{ messages: UIMessage[]; title: string; onContinue: () => void }> = ({ messages, title, onContinue }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex-1 min-h-0 flex flex-col glass-card rounded-[18px] overflow-hidden">
      <div className="shrink-0 px-4 py-2.5 border-b border-border/50 flex items-center gap-2">
        <History className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground truncate flex-1">{title}</span>
        <button
          onClick={onContinue}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg
            bg-primary/10 hover:bg-primary/20 text-primary
            border border-primary/20 hover:border-primary/40
            transition-all cursor-pointer text-[11px] font-medium"
          title="Продолжить этот диалог"
        >
          <Play className="w-3 h-3" />
          Продолжить
        </button>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4"
      >
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────
export const AiReportsPage: React.FC = () => {
  const { sessions, sessionsLoaded, liveId, upsert, startNew, continueSession, deleteSession } = useChatHistory();
  const [viewId, setViewId] = useState<string | null>(null);

  const handleNewChat = () => {
    startNew();
    setViewId(null);
  };

  const handleContinue = (id: string) => {
    continueSession(id);
    setViewId(null);
  };

  const handleDeleteSession = (id: string) => {
    deleteSession(id);
    if (viewId === id) setViewId(null);
    if (id === liveId) startNew();
  };

  const historySession = viewId ? sessions.find((s) => s.id === viewId) : null;
  const liveSession = sessions.find((s) => s.id === liveId);

  return (
    <div className="flex h-full overflow-hidden p-3 gap-3">
      <ChatHistoryPanel
        sessions={sessions}
        liveId={liveId}
        viewId={viewId}
        onNewChat={handleNewChat}
        onSelectLive={() => setViewId(null)}
        onSelectHistory={setViewId}
        onDelete={handleDeleteSession}
      />

      {!sessionsLoaded ? (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          Загрузка...
        </div>
      ) : viewId && historySession ? (
        <HistoryView
          messages={historySession.messages}
          title={historySession.title}
          onContinue={() => handleContinue(viewId)}
        />
      ) : (
        <LiveChatArea
          key={liveId}
          sessionId={liveId}
          initialMessages={liveSession?.messages}
          onMessagesChange={upsert}
        />
      )}
    </div>
  );
};
