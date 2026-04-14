import { openDB } from 'idb'
import type { RepoGraph, GraphMeta } from '@/lib/pipeline/schemas/graph'

const DB_NAME    = 'repomap'
const DB_VERSION = 1
const STORE      = 'graphs'

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'meta.repoUrl' })
      }
    },
  })
}

export async function saveGraph(graph: RepoGraph): Promise<void> {
  const db = await getDB()
  await db.put(STORE, graph)
}

export async function loadGraph(repoUrl: string): Promise<RepoGraph | null> {
  const db = await getDB()
  const result = await db.get(STORE, repoUrl)
  return result ?? null
}

export async function listGraphs(): Promise<GraphMeta[]> {
  const db     = await getDB()
  const all    = await db.getAll(STORE) as RepoGraph[]
  return all
    .map((g) => g.meta)
    .sort((a, b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime())
}

export async function deleteGraph(repoUrl: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE, repoUrl)
}