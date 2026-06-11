import { useState, useEffect, useCallback } from 'react';
import type { UIMessage } from 'ai';

export interface ChatSession {
  id: string;
  title: string;
  date: string;
  messages: UIMessage[];
}

const LIVE_ID_KEY = 'ai-reports-live-id';
const API_BASE = '/api/reports/sessions';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadLiveId(): string {
  try {
    return localStorage.getItem(LIVE_ID_KEY) || generateId();
  } catch {
    return generateId();
  }
}

function extractTitle(messages: UIMessage[]): string {
  const userMsg = messages.find((m) => m.role === 'user');
  if (!userMsg) return 'Диалог';
  const textPart = (userMsg.parts ?? []).find((p: any) => p.type === 'text') as any;
  const text = textPart?.text ?? (typeof (userMsg as any).content === 'string' ? (userMsg as any).content : '');
  return (text || 'Диалог').slice(0, 60);
}

// Strip large data arrays before saving — they're not needed for display
// and are stripped server-side anyway when continuing sessions.
function stripDataForStorage(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg: any) => {
    if (!Array.isArray(msg?.parts)) return msg;
    const parts = msg.parts.map((part: any) => {
      if (part.type === 'tool-invocation' && part.result?.data) {
        return { ...part, result: { success: part.result.success, count: part.result.count, error: part.result.error } };
      }
      if (part.type?.startsWith('tool-') && part.type !== 'tool-invocation' && part.output?.data) {
        return { ...part, output: { success: part.output.success, count: part.output.count, error: part.output.error } };
      }
      return part;
    });
    return { ...msg, parts };
  });
}

export function useChatHistory() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [liveId, setLiveId] = useState<string>(loadLiveId);

  // Load sessions from server on mount
  useEffect(() => {
    fetch(API_BASE)
      .then((r) => r.json())
      .then((data) => setSessions(data.sessions || []))
      .catch(() => {})
      .finally(() => setSessionsLoaded(true));
  }, []);

  // Persist liveId locally (just an ID string — tiny)
  useEffect(() => {
    try { localStorage.setItem(LIVE_ID_KEY, liveId); } catch {}
  }, [liveId]);

  const upsert = useCallback(async (sessionId: string, messages: UIMessage[]) => {
    if (!messages.length) return;
    const title = extractTitle(messages);
    const date = new Date().toISOString();

    // Optimistic local update (keep full messages for display)
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sessionId);
      const session: ChatSession = { id: sessionId, title, date, messages };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = session;
        return copy;
      }
      return [session, ...prev].slice(0, 50);
    });

    // Save to server (strip large data arrays)
    try {
      await fetch(`${API_BASE}/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, date, messages: stripDataForStorage(messages) }),
      });
    } catch (err) {
      console.error('[useChatHistory] save failed:', err);
    }
  }, []);

  const startNew = useCallback(() => {
    setLiveId(generateId());
  }, []);

  const continueSession = useCallback((id: string) => {
    setLiveId(id);
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    try {
      await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('[useChatHistory] delete failed:', err);
    }
  }, []);

  return { sessions, sessionsLoaded, liveId, upsert, startNew, continueSession, deleteSession };
}
