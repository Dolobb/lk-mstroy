import fs from 'fs';
import path from 'path';
import type { UIMessage } from 'ai';

const DATA_DIR = path.resolve(__dirname, '../../data');
const FILE_PATH = path.join(DATA_DIR, 'sessions.json');
const MAX_SESSIONS = 50;

export interface ChatSession {
  id: string;
  title: string;
  date: string;
  messages: UIMessage[];
}

interface Store {
  sessions: ChatSession[];
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readStore(): Store {
  try {
    if (!fs.existsSync(FILE_PATH)) return { sessions: [] };
    return JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8')) as Store;
  } catch {
    return { sessions: [] };
  }
}

function writeStore(store: Store) {
  ensureDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

export function listSessions(): ChatSession[] {
  return readStore().sessions;
}

export function getSession(id: string): ChatSession | null {
  return readStore().sessions.find((s) => s.id === id) ?? null;
}

export function upsertSession(session: ChatSession): void {
  const store = readStore();
  const idx = store.sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) {
    store.sessions[idx] = session;
  } else {
    store.sessions = [session, ...store.sessions].slice(0, MAX_SESSIONS);
  }
  writeStore(store);
}

export function deleteSession(id: string): void {
  const store = readStore();
  store.sessions = store.sessions.filter((s) => s.id !== id);
  writeStore(store);
}
