import { openDB } from 'idb'
import type { RepoGraph, GraphMeta } from '@/lib/pipeline/schemas/graph'

const DB_NAME    = 'repomap'
const DB_VERSION = 3
const STORE      = 'graphs'
const PROGRESS_STORE = 'progress'

export interface PipelineProgress {
  repoUrl: string
  repoName: string
  fileTree: string[]
  pass1?: any // Pass1Output
  fileContents?: { path: string; content: string }[]
  pass2Nodes?: any
  pass2Edges?: any
  pass3?: any
  lastStep: number // 0: none, 1: pass1 done, 2: pass2 done, 3: pass3 done
  createdAt: string
  updatedAt: string
}

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'meta.repoUrl' })
      }
      if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
        db.createObjectStore(PROGRESS_STORE, { keyPath: 'repoUrl' })
      }
      if (!db.objectStoreNames.contains('branches')) {
        const branchStore = db.createObjectStore('branches', { keyPath: 'id' })
        branchStore.createIndex('byRepoGraphId', 'repoGraphId', { unique: false })
      } else {
        const branchStore = (tx as any).objectStore('branches')
        if (!branchStore.indexNames.contains('byRepoGraphId')) {
          branchStore.createIndex('byRepoGraphId', 'repoGraphId', { unique: false })
        }
      }
      if (!db.objectStoreNames.contains('branchDeltas')) {
        db.createObjectStore('branchDeltas', { keyPath: 'branchId' })
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

export async function saveProgress(progress: PipelineProgress): Promise<void> {
  const db = await getDB()
  progress.updatedAt = new Date().toISOString()
  await db.put(PROGRESS_STORE, progress)
}

export async function loadProgress(repoUrl: string): Promise<PipelineProgress | null> {
  const db = await getDB()
  const result = await db.get(PROGRESS_STORE, repoUrl)
  return result ?? null
}

export async function listProgress(): Promise<PipelineProgress[]> {
  const db = await getDB()
  const all = await db.getAll(PROGRESS_STORE) as PipelineProgress[]
  return all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export async function deleteProgress(repoUrl: string): Promise<void> {
  const db = await getDB()
  await db.delete(PROGRESS_STORE, repoUrl)
}
