import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME    = 'repomap-chat'
const DB_VERSION = 1
const STORE      = 'sessions'

export interface PersistedMessage {
  id:      string
  role:    'user' | 'assistant'
  content: string
}

export interface ChatSession {
  repoName:  string
  messages:  PersistedMessage[]
  updatedAt: string
}

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'repoName' })
      }
    },
  })
}

export async function loadChatSession(repoName: string): Promise<ChatSession | null> {
  try {
    const db = await getDB()
    return (await db.get(STORE, repoName)) ?? null
  } catch {
    return null
  }
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  try {
    const db = await getDB()
    await db.put(STORE, session)
  } catch (e) {
    console.warn('[chatStore] save failed:', e)
  }
}

export async function clearChatSession(repoName: string): Promise<void> {
  try {
    const db = await getDB()
    await db.delete(STORE, repoName)
  } catch (e) {
    console.warn('[chatStore] clear failed:', e)
  }
}