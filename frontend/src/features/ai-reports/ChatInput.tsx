import React, { useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';

interface Props {
  input: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
}

export const ChatInput: React.FC<Props> = ({ input, onChange, onSubmit, isLoading }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Авто-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
        onSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder="Опишите какой отчёт вам нужен..."
        rows={1}
        disabled={isLoading}
        className="flex-1 resize-none bg-transparent text-foreground text-xs
          placeholder:text-muted-foreground/60
          border-none outline-none
          py-2 px-1
          disabled:opacity-50"
        style={{ maxHeight: '120px' }}
      />

      <button
        type="submit"
        disabled={!input.trim() || isLoading}
        className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center
          bg-primary text-primary-foreground
          hover:opacity-90 active:scale-95
          disabled:opacity-30 disabled:cursor-not-allowed
          transition-all cursor-pointer border-none"
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Send className="w-3.5 h-3.5" />
        )}
      </button>
    </form>
  );
};
