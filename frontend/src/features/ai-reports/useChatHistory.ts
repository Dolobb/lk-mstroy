import { useState, useEffect, useCallback } from 'react';
import type { UIMessage } from 'ai';

export interface ChatSession {
  id: string;
  title: string;
  date: string;
  messages: UIMessage[];
}

const STORAGE_KEY = 'ai-reports-chat-history';
const LIVE_ID_KEY = 'ai-reports-live-id';
const MAX_SESSIONS = 50;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadFromStorage(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(sessions: ChatSession[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {}
}

function loadLiveId(): string {
  try {
    return localStorage.getItem(LIVE_ID_KEY) || generateId();
  } catch {
    return generateId();
  }
}

function extractTitle(messages: UIMessage[]): string {
  const userMsg = messages.find(m => m.role === 'user');
  if (!userMsg) return 'Диалог';
  // AI SDK v6: parts array
  const textPart = (userMsg.parts ?? []).find((p: any) => p.type === 'text') as any;
  const text = textPart?.text ?? (typeof (userMsg as any).content === 'string' ? (userMsg as any).content : '');
  return (text || 'Диалог').slice(0, 60);
}

export function useChatHistory() {
  const [sessions, setSessions] = useState<ChatSession[]>(loadFromStorage);
  const [liveId, setLiveId] = useState<string>(loadLiveId);

  useEffect(() => {
    saveToStorage(sessions);
  }, [sessions]);

  useEffect(() => {
    try { localStorage.setItem(LIVE_ID_KEY, liveId); } catch {}
  }, [liveId]);

  const upsert = useCallback((sessionId: string, messages: UIMessage[]) => {
    if (!messages.length) return;
    const title = extractTitle(messages);

    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === sessionId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], messages };
        return copy;
      }
      const newSession: ChatSession = {
        id: sessionId,
        title,
        date: new Date().toISOString(),
        messages,
      };
      return [newSession, ...prev];
    });
  }, []);

  const startNew = useCallback(() => {
    setLiveId(generateId());
  }, []);

  const continueSession = useCallback((id: string) => {
    setLiveId(id);
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
  }, []);

  return { sessions, liveId, upsert, startNew, continueSession, deleteSession };
}
