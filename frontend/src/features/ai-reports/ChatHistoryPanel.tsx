import React from 'react';
import { Plus, Trash2, MessageSquare, Clock } from 'lucide-react';
import type { ChatSession } from './useChatHistory';

interface Props {
  sessions: ChatSession[];
  liveId: string;
  viewId: string | null; // null = showing live chat
  onNewChat: () => void;
  onSelectLive: () => void;
  onSelectHistory: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Вчера';
  if (diffDays < 7) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export const ChatHistoryPanel: React.FC<Props> = ({
  sessions,
  liveId,
  viewId,
  onNewChat,
  onSelectLive,
  onSelectHistory,
  onDelete,
}) => {
  const liveSession = sessions.find(s => s.id === liveId);

  return (
    <div className="w-52 shrink-0 flex flex-col glass-card rounded-[18px] overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">История</span>
        </div>
        <button
          onClick={onNewChat}
          className="w-6 h-6 rounded-lg flex items-center justify-center
            hover:bg-primary/10 text-muted-foreground hover:text-primary
            transition-colors cursor-pointer"
          title="Новый чат"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar py-1 min-h-0">
        {/* Current live session (if has messages) */}
        {liveSession && (
          <SessionItem
            session={liveSession}
            isActive={viewId === null}
            isLive
            onSelect={onSelectLive}
            onDelete={() => onDelete(liveId)}
          />
        )}

        {/* Past sessions */}
        {sessions.filter(s => s.id !== liveId).length === 0 && !liveSession ? (
          <div className="px-3 py-6 text-center text-[10px] text-muted-foreground leading-relaxed">
            История чатов появится здесь
          </div>
        ) : (
          sessions
            .filter(s => s.id !== liveId)
            .map(session => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={viewId === session.id}
                isLive={false}
                onSelect={() => onSelectHistory(session.id)}
                onDelete={() => onDelete(session.id)}
              />
            ))
        )}
      </div>
    </div>
  );
};

interface ItemProps {
  session: ChatSession;
  isActive: boolean;
  isLive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

const SessionItem: React.FC<ItemProps> = ({ session, isActive, isLive, onSelect, onDelete }) => (
  <div
    className={`group relative flex items-start gap-2 px-2.5 py-2 mx-1 my-0.5 rounded-xl cursor-pointer transition-all
      ${isActive
        ? 'bg-primary/10 border border-primary/20'
        : 'hover:bg-card-inner/60 border border-transparent hover:border-border/30'
      }`}
    onClick={onSelect}
  >
    <MessageSquare
      className={`w-3 h-3 mt-0.5 shrink-0 transition-colors
        ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
    />
    <div className="flex-1 min-w-0">
      <p className={`text-[11px] leading-snug line-clamp-2 transition-colors
        ${isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}>
        {session.title}
      </p>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="text-[10px] text-muted-foreground/50">
          {formatDate(session.date)}
        </span>
        {isLive && (
          <span className="text-[9px] px-1 py-px rounded bg-primary/15 text-primary font-medium">
            текущий
          </span>
        )}
      </div>
    </div>
    <button
      onClick={e => { e.stopPropagation(); onDelete(); }}
      className="absolute right-2 top-1/2 -translate-y-1/2
        w-4 h-4 flex items-center justify-center rounded
        opacity-0 group-hover:opacity-100
        text-muted-foreground hover:text-destructive
        transition-all cursor-pointer"
      title="Удалить"
    >
      <Trash2 className="w-3 h-3" />
    </button>
  </div>
);
