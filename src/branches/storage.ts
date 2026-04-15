// ============================================================
// RepoMap — Branch Storage (IndexedDB via `idb`)
//
// Stores: Branch metadata + BranchDelta (separate for clean updates)
//
// IndexedDB structure:
//   branches      — Branch[] (metadata, indexed by repoGraphId)
//   branchDeltas  — BranchDelta[] (one per branch, keyed by branchId)
// ============================================================

import { openDB, type IDBPDatabase } from 'idb'
import type { Branch, BranchDelta } from './types'

// ------------------------------------------------------------
// DB schema version — bump if you add stores or indexes
// ------------------------------------------------------------
const DB_NAME    = 'repomap'
const DB_VERSION = 2           // v1 = repo graphs, v2 adds branches

type RepomapDB = {
  branches: {
    key: string
    value: Branch
    indexes: { byRepoGraphId: string }
  }
  branchDeltas: {
    key: string
    value: BranchDelta
  }
}

// Singleton DB connection
let _db: IDBPDatabase<RepomapDB> | null = null

async function getDB(): Promise<IDBPDatabase<RepomapDB>> {
  if (_db) return _db

  _db = await openDB<RepomapDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // v1 stores (repo_graphs) were created in a previous migration,
      // only create them if they don't exist
      if (!db.objectStoreNames.contains('repo_graphs' as never)) {
        db.createObjectStore('repo_graphs' as never, { keyPath: 'meta.repoUrl' })
      }

      // v2: branch stores
      if (oldVersion < 2) {
        const branchStore = db.createObjectStore('branches', { keyPath: 'id' })
        branchStore.createIndex('byRepoGraphId', 'repoGraphId', { unique: false })

        db.createObjectStore('branchDeltas', { keyPath: 'branchId' })
      }
    },
  })

  return _db
}

// ------------------------------------------------------------
// Branch CRUD
// ------------------------------------------------------------

export async function saveBranch(branch: Branch): Promise<void> {
  const db = await getDB()
  await db.put('branches', branch)
}

export async function getBranch(branchId: string): Promise<Branch | undefined> {
  const db = await getDB()
  return db.get('branches', branchId)
}

/**
 * Returns all branches for a given repo graph, in creation order.
 */
export async function getBranchesForRepo(repoGraphId: string): Promise<Branch[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('branches', 'byRepoGraphId', repoGraphId)
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function deleteBranch(branchId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['branches', 'branchDeltas'], 'readwrite')
  await Promise.all([
    tx.objectStore('branches').delete(branchId),
    tx.objectStore('branchDeltas').delete(branchId),
    tx.done,
  ])
}

// ------------------------------------------------------------
// BranchDelta CRUD
// ------------------------------------------------------------

export async function saveDelta(delta: BranchDelta): Promise<void> {
  const db = await getDB()
  await db.put('branchDeltas', delta)
}

export async function getDelta(branchId: string): Promise<BranchDelta | undefined> {
  const db = await getDB()
  return db.get('branchDeltas', branchId)
}

/**
 * Returns an empty delta skeleton for a new branch.
 * Use this as the initial state when creating a branch.
 */
export function emptyDelta(branchId: string): BranchDelta {
  return {
    branchId,
    addedNodes:     [],
    addedEdges:     [],
    fictionalFiles: {},
  }
}

// ------------------------------------------------------------
// Branch creation helper
// Creates both the Branch record and an empty BranchDelta atomically.
// ------------------------------------------------------------
export async function createBranch(params: {
  name: string
  description?: string
  color?: string
  parentBranchId: string | null
  repoGraphId: string
}): Promise<Branch> {
  const id = `branch__${Date.now()}__${Math.random().toString(36).slice(2, 7)}`
  const now = new Date().toISOString()

  const branch: Branch = {
    id,
    name:           params.name,
    description:    params.description,
    color:          params.color,
    parentBranchId: params.parentBranchId,
    repoGraphId:    params.repoGraphId,
    createdAt:      now,
    updatedAt:      now,
  }

  const db = await getDB()
  const tx = db.transaction(['branches', 'branchDeltas'], 'readwrite')
  await Promise.all([
    tx.objectStore('branches').put(branch),
    tx.objectStore('branchDeltas').put(emptyDelta(id)),
    tx.done,
  ])

  return branch
}

// ------------------------------------------------------------
// Delta mutation helpers
// Each function loads the delta, applies the change, and saves it back.
// Callers don't need to manage the full delta object.
// ------------------------------------------------------------

export async function addNodeToBranch(
  branchId: string,
  node: BranchDelta['addedNodes'][number]
): Promise<void> {
  const db   = await getDB()
  const delta = (await db.get('branchDeltas', branchId)) ?? emptyDelta(branchId)
  delta.addedNodes = [...delta.addedNodes.filter(n => n.id !== node.id), node]
  await db.put('branchDeltas', delta)
  await _touchBranch(db, branchId)
}

export async function removeNodeFromBranch(branchId: string, nodeId: string): Promise<void> {
  const db    = await getDB()
  const delta = (await db.get('branchDeltas', branchId)) ?? emptyDelta(branchId)
  delta.addedNodes = delta.addedNodes.filter(n => n.id !== nodeId)
  // Also remove any edges that referenced this node
  delta.addedEdges = delta.addedEdges.filter(
    e => e.source !== nodeId && e.target !== nodeId
  )
  await db.put('branchDeltas', delta)
  await _touchBranch(db, branchId)
}

export async function addEdgeToBranch(
  branchId: string,
  edge: BranchDelta['addedEdges'][number]
): Promise<void> {
  const db    = await getDB()
  const delta = (await db.get('branchDeltas', branchId)) ?? emptyDelta(branchId)
  delta.addedEdges = [...delta.addedEdges.filter(e => e.id !== edge.id), edge]
  await db.put('branchDeltas', delta)
  await _touchBranch(db, branchId)
}

export async function removeEdgeFromBranch(branchId: string, edgeId: string): Promise<void> {
  const db    = await getDB()
  const delta = (await db.get('branchDeltas', branchId)) ?? emptyDelta(branchId)
  delta.addedEdges = delta.addedEdges.filter(e => e.id !== edgeId)
  await db.put('branchDeltas', delta)
  await _touchBranch(db, branchId)
}

export async function addFictionalFile(
  branchId: string,
  nodeId: string,
  file: import('./types').FictionalFile
): Promise<void> {
  const db    = await getDB()
  const delta = (await db.get('branchDeltas', branchId)) ?? emptyDelta(branchId)
  const existing = delta.fictionalFiles[nodeId] ?? []
  delta.fictionalFiles = {
    ...delta.fictionalFiles,
    [nodeId]: [...existing.filter(f => f.id !== file.id), file],
  }
  await db.put('branchDeltas', delta)
  await _touchBranch(db, branchId)
}

export async function removeFictionalFile(
  branchId: string,
  nodeId: string,
  fileId: string
): Promise<void> {
  const db    = await getDB()
  const delta = (await db.get('branchDeltas', branchId)) ?? emptyDelta(branchId)
  const existing = delta.fictionalFiles[nodeId] ?? []
  delta.fictionalFiles = {
    ...delta.fictionalFiles,
    [nodeId]: existing.filter(f => f.id !== fileId),
  }
  await db.put('branchDeltas', delta)
  await _touchBranch(db, branchId)
}

// Updates the `updatedAt` timestamp on the branch record
async function _touchBranch(db: IDBPDatabase<RepomapDB>, branchId: string): Promise<void> {
  const branch = await db.get('branches', branchId)
  if (branch) {
    await db.put('branches', { ...branch, updatedAt: new Date().toISOString() })
  }
}