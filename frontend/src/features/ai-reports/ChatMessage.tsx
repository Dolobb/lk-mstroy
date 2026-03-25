import React from 'react';
import type { UIMessage } from 'ai';
import { User, Bot, Download } from 'lucide-react';

interface Props {
  message: UIMessage;
}

/** Ищет ссылки на скачивание XLSX в тексте ответа */
function extractDownloadLinks(text: string): { fileId: string; url: string }[] {
  const links: { fileId: string; url: string }[] = [];
  const regex = /\/api\/reports\/files\/([\w-]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    links.push({ fileId: match[1], url: match[0] });
  }
  return links;
}

export const ChatMessage: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';

  // Собираем текстовые части сообщения
  const textContent = message.parts
    ?.filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n') || '';

  const downloadLinks = isUser ? [] : extractDownloadLinks(textContent);

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* Аватар ассистента */}
      {!isUser && (
        <div className="shrink-0 w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mt-0.5">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
      )}

      {/* Пузырь сообщения */}
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-card-inner/60 text-card-foreground rounded-bl-md border border-border/30'
        }`}
      >
        {/* Текст */}
        <div className="whitespace-pre-wrap break-words">
          {textContent}
        </div>

        {/* Кнопки скачивания */}
        {downloadLinks.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1.5">
            {downloadLinks.map((link) => (
              <a
                key={link.fileId}
                href={link.url}
                download
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
                  bg-accent/15 hover:bg-accent/25 text-accent
                  border border-accent/20 hover:border-accent/40
                  transition-all no-underline text-xs font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                Скачать отчёт
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Аватар пользователя */}
      {isUser && (
        <div className="shrink-0 w-7 h-7 rounded-lg bg-muted/50 border border-border/50 flex items-center justify-center mt-0.5">
          <User className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
};
