import { openDB, type IDBPDatabase } from 'idb'
import type { RepoGraph, GraphMeta } from '@/lib/pipeline/schemas/graph'

// ------------------------------------------------------------
// DB config
// ------------------------------------------------------------

const DB_NAME    = 'repomap'
const DB_VERSION = 1
const STORE      = 'graphs'

type DB = IDBPDatabase<{
  graphs: {
    key:     string
    value:   RepoGraph
    indexes: { analyzedAt: string }
  }
}>

async function getDB(): Promise<DB> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE, { keyPath: 'meta.repoUrl' })
      store.createIndex('analyzedAt', 'meta.analyzedAt')
    },
  })
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

/** Save or overwrite a graph. Key = meta.repoUrl */
export async function saveGraph(graph: RepoGraph): Promise<void> {
  const db = await getDB()
  await db.put(STORE, graph)
}

/** Load a graph by repo URL. Returns null if not found. */
export async function loadGraph(repoUrl: string): Promise<RepoGraph | null> {
  const db  = await getDB()
  const val = await db.get(STORE, repoUrl)
  return val ?? null
}

/** List metadata for all saved graphs, newest first. */
export async function listGraphs(): Promise<GraphMeta[]> {
  const db     = await getDB()
  const graphs = await db.getAllFromIndex(STORE, 'analyzedAt')
  return graphs.map((g) => g.meta).reverse()
}

/** Delete a graph by repo URL. No-op if not found. */
export async function deleteGraph(repoUrl: string): Promise<void> {
  const db = await getDB()
  await db.delete(STORE, repoUrl)
}

/** Check if a graph exists for a given URL. */
export async function hasGraph(repoUrl: string): Promise<boolean> {
  const db  = await getDB()
  const key = await db.getKey(STORE, repoUrl)
  return key !== undefined
}