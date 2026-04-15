// ============================================================
// RepoMap — Branch Resolver
//
// Given a branchId + base RepoGraph, computes the fully resolved
// graph by walking the ancestor chain and applying deltas in order.
//
// Resolution order:
//   base graph → grandparent delta → parent delta → current delta
//
// Each layer only ADDS nodes/edges/fictional-files.
// (Deletion/hiding of base nodes is out of scope for Phase 1.)
// ============================================================

import type { RepoGraph } from '@/lib/pipeline/schemas/graph'
import type { ResolvedGraph, ResolvedNode, ResolvedEdge, FictionalFile } from './types'
import { getBranch, getDelta } from './storage'

// ------------------------------------------------------------
// Main resolver
// ------------------------------------------------------------

/**
 * Resolves the full effective graph for a given branch.
 * If branchId is null, returns the base graph unchanged.
 *
 * @param baseGraph  The RepoGraph produced by the analysis pipeline
 * @param branchId   The branch to resolve (or null for base graph)
 */
export async function resolveBranch(
  baseGraph: RepoGraph,
  branchId: string | null
): Promise<ResolvedGraph> {
  // --- Base graph (no branch) ---
  if (branchId === null) {
    return buildBaseResolved(baseGraph)
  }

  // --- Collect ancestor chain (oldest first, current last) ---
  const chain = await collectAncestorChain(branchId)
  // chain[0] = root branch (parent = base), chain[last] = current branch

  // --- Collect all deltas in ancestor order ---
  const deltas = await Promise.all(chain.map(b => getDelta(b.id)))

  // --- Start from base graph ---
  const resolvedNodes = new Map<string, ResolvedNode>(
    baseGraph.nodes.map(node => [
      node.id,
      {
        ...node,
        fictionalFiles: [],
        origin: 'base' as const,
      },
    ])
  )

  const resolvedEdges = new Map<string, ResolvedEdge>(
    baseGraph.edges.map(edge => [
      edge.id,
      { ...edge, origin: 'base' as const },
    ])
  )

  // --- Apply each delta in order ---
  for (let i = 0; i < chain.length; i++) {
    const branch = chain[i]
    const delta  = deltas[i]

    if (!delta) continue

    // Add nodes from this branch
    for (const node of delta.addedNodes) {
      resolvedNodes.set(node.id, {
        id:            node.id,
        label:         node.label,
        type:          node.type,
        parentId:      node.parentId,
        depth:         node.depth,
        files:         node.files,
        detectedRole:  '',
        patterns:      [],
        metadata:      node.metadata ?? {},
        description:   node.description,
        fictionalFiles: [],
        origin:        branch.id,
      })
    }

    // Add edges from this branch
    for (const edge of delta.addedEdges) {
      resolvedEdges.set(edge.id, { ...edge, origin: branch.id })
    }

    // Apply fictional files to nodes (base or previously added)
    for (const [nodeId, files] of Object.entries(delta.fictionalFiles)) {
      const existing = resolvedNodes.get(nodeId)
      if (existing) {
        // Merge fictional files — later branches can add more, no duplicates by id
        const mergedFiles = mergeFictionalFiles(existing.fictionalFiles, files)
        resolvedNodes.set(nodeId, { ...existing, fictionalFiles: mergedFiles })
      }
    }
  }

  return {
    branchId,
    nodes: Array.from(resolvedNodes.values()),
    edges: Array.from(resolvedEdges.values()),
  }
}

// ------------------------------------------------------------
// Helper: Build ResolvedGraph from base graph (no branch)
// ------------------------------------------------------------
function buildBaseResolved(baseGraph: RepoGraph): ResolvedGraph {
  return {
    branchId: null,
    nodes: baseGraph.nodes.map(node => ({
      ...node,
      fictionalFiles: [],
      origin: 'base' as const,
    })),
    edges: baseGraph.edges.map(edge => ({
      ...edge,
      origin: 'base' as const,
    })),
  }
}

// ------------------------------------------------------------
// Helper: Walk up the parent chain and return branches oldest-first
//
// Example tree:     base → A → B → C  (current = C)
// Returns:          [A, B, C]
// ------------------------------------------------------------
async function collectAncestorChain(
  branchId: string
): Promise<import('./types').Branch[]> {
  const chain: import('./types').Branch[] = []
  let currentId: string | null = branchId

  // Safety limit — prevent infinite loops from corrupted data
  const MAX_DEPTH = 50

  while (currentId !== null && chain.length < MAX_DEPTH) {
    const branch = await getBranch(currentId)
    if (!branch) break
    chain.unshift(branch)              // prepend → oldest first after loop
    currentId = branch.parentBranchId
  }

  return chain
}

// ------------------------------------------------------------
// Helper: Merge fictional file arrays, no duplicate IDs
// Later files override earlier ones with the same id (last-write-wins)
// ------------------------------------------------------------
function mergeFictionalFiles(
  existing: FictionalFile[],
  incoming: FictionalFile[]
): FictionalFile[] {
  const map = new Map<string, FictionalFile>(existing.map(f => [f.id, f]))
  for (const f of incoming) {
    map.set(f.id, f)
  }
  return Array.from(map.values()).sort((a, b) => a.addedAt.localeCompare(b.addedAt))
}

// ------------------------------------------------------------
// Utility: Check if a node ID belongs to a specific branch
// Useful for UI to know if a node can be deleted (only branch-added nodes)
// ------------------------------------------------------------
export function isNodeFromBranch(
  node: ResolvedNode,
  branchId: string
): boolean {
  return node.origin === branchId
}

export function isEdgeFromBranch(
  edge: ResolvedEdge,
  branchId: string
): boolean {
  return edge.origin === branchId
}

// ------------------------------------------------------------
// Utility: Generate a unique ID for a new branch node/edge
// ------------------------------------------------------------
export function newBranchNodeId(label: string, type: string): string {
  const slug = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  return `${type}__branch__${slug}__${Date.now()}`
}

export function newBranchEdgeId(sourceId: string, targetId: string): string {
  return `edge__branch__${sourceId}__${targetId}__${Date.now()}`
}

export function newFictionalFileId(): string {
  return `fictfile__${Date.now()}__${Math.random().toString(36).slice(2, 6)}`
}