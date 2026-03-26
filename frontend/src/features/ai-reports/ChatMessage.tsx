import React from 'react';
import type { UIMessage } from 'ai';
import { User, Bot, Download } from 'lucide-react';
import { ToolStatus } from './ToolStatus';

interface Props {
  message: UIMessage;
}

/** Extract tool-* parts from AI SDK v6 message parts */
function getToolParts(message: UIMessage) {
  const tools: { toolName: string; state: string; output?: Record<string, unknown> }[] = [];

  for (const part of message.parts || []) {
    // AI SDK v6: tool parts have type like 'tool-queryKipData'
    if (part.type.startsWith('tool-') && part.type !== 'tool-invocation') {
      const toolName = part.type.replace('tool-', '');
      const p = part as any;
      tools.push({
        toolName,
        state: p.state || 'input-available',
        output: p.state === 'output-available' || p.state === 'output-error' ? p.result ?? p.output : undefined,
      });
    }
    // Also support standard tool-invocation format
    if (part.type === 'tool-invocation') {
      const p = part as any;
      tools.push({
        toolName: p.toolName || p.toolCallId || 'unknown',
        state: p.state || 'input-available',
        output: p.state === 'result' ? p.result : undefined,
      });
    }
  }
  return tools;
}

/** Extract download URLs from text and tool outputs */
function extractDownloadLinks(message: UIMessage): { fileId: string; url: string }[] {
  const links = new Map<string, string>();
  const urlRegex = /\/api\/reports\/files\/([\w-]+)/g;

  for (const part of message.parts || []) {
    if (part.type === 'text') {
      let match;
      while ((match = urlRegex.exec(part.text)) !== null) {
        links.set(match[1], match[0]);
      }
    }
    // Check tool-invocation result
    if (part.type === 'tool-invocation') {
      const p = part as any;
      const result = p.result as Record<string, unknown> | undefined;
      if (result && typeof result.downloadUrl === 'string') {
        const m = result.downloadUrl.match(/\/api\/reports\/files\/([\w-]+)/);
        if (m) links.set(m[1], result.downloadUrl);
      }
    }
    // Check tool-* parts (AI SDK v6)
    if (part.type.startsWith('tool-') && part.type !== 'tool-invocation') {
      const p = part as any;
      const result = p.result ?? p.output;
      if (result && typeof result === 'object' && typeof result.downloadUrl === 'string') {
        const m = result.downloadUrl.match(/\/api\/reports\/files\/([\w-]+)/);
        if (m) links.set(m[1], result.downloadUrl);
      }
    }
  }

  return Array.from(links.entries()).map(([fileId, url]) => ({ fileId, url }));
}

export const ChatMessage: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';

  // Collect text parts
  const textContent = message.parts
    ?.filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n') || '';

  // Remove raw URLs from text (download button replaces them)
  const cleanText = textContent.replace(/\s*\/api\/reports\/files\/[\w-]+/g, '');

  // Tool parts for progress display
  const toolParts = isUser ? [] : getToolParts(message);

  // Download links from text and tool outputs (deduplicated by ToolStatus download buttons)
  const downloadLinks = isUser ? [] : extractDownloadLinks(message);
  // Filter out download links that are already shown via ToolStatus
  const toolDownloadUrls = new Set(
    toolParts
      .filter((t) => t.output?.downloadUrl)
      .map((t) => String(t.output!.downloadUrl)),
  );
  const extraDownloadLinks = downloadLinks.filter(
    (l) => !toolDownloadUrls.has(l.url),
  );

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* Assistant avatar */}
      {!isUser && (
        <div className="shrink-0 w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mt-0.5">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
      )}

      {/* Message bubble */}
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-card-inner/60 text-card-foreground rounded-bl-md border border-border/30'
        }`}
      >
        {/* Tool progress indicators */}
        {toolParts.length > 0 && (
          <div className="flex flex-col gap-1 mb-2">
            {toolParts.map((tp, i) => (
              <ToolStatus
                key={`${tp.toolName}-${i}`}
                toolName={tp.toolName}
                state={tp.state}
                output={tp.output}
              />
            ))}
          </div>
        )}

        {/* Text */}
        {cleanText.trim() && (
          <div className="whitespace-pre-wrap break-words">
            {cleanText}
          </div>
        )}

        {/* Extra download buttons (from text URLs not covered by ToolStatus) */}
        {extraDownloadLinks.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1.5">
            {extraDownloadLinks.map((link) => (
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

      {/* User avatar */}
      {isUser && (
        <div className="shrink-0 w-7 h-7 rounded-lg bg-muted/50 border border-border/50 flex items-center justify-center mt-0.5">
          <User className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
};
