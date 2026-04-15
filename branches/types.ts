// ============================================================
// RepoMap — Branch System Types
//
// A Branch is a named "what-if" variation of the architecture graph.
// Branches form a tree: each branch has a parent (another branch,
// or null meaning "the base analyzed graph").
//
// Rendering a branch = base graph + all ancestor deltas + own delta.
// The base graph is NEVER modified.
// ============================================================

import type { Node, Edge } from '../schemas/graph'

// ------------------------------------------------------------
// Branch metadata (identity, not content)
// ------------------------------------------------------------
export interface Branch {
  id: string
  name: string
  description?: string
  parentBranchId: string | null  // null → child of the base graph
  repoGraphId: string            // which RepoGraph this tree belongs to
  createdAt: string              // ISO
  updatedAt: string              // ISO
  color?: string                 // optional color tag for UI distinction
}

// ------------------------------------------------------------
// Fictional file — a planned/proposed file inside a node
// Added by the user when exploring a branch.
// Not a real file in the repo.
// ------------------------------------------------------------
export interface FictionalFile {
  id: string
  name: string               // e.g. "UserNotificationService.ts"
  description?: string       // what this file would do
  pseudocode?: string        // rough implementation sketch
  addedAt: string            // ISO
}

// ------------------------------------------------------------
// Branch node — a node added inside a branch (not in base graph)
// Simpler than the full Node type: no detectedRole/patterns
// (those are AI-generated, branch nodes are user-created)
// ------------------------------------------------------------
export interface BranchNode {
  id: string                     // must be unique across base + all branches
  label: string
  type: 'layer' | 'module' | 'file' | 'component'
  parentId: string | null        // can reference base nodes or other branch nodes
  depth: number                  // 0=layer, 1=module, 2=file, 3=component
  files: string[]                // real file paths (usually empty for branch nodes)
  description?: string           // user's intent note for this node
  metadata?: {
    language?: string
    complexity?: 'low' | 'medium' | 'high'
  }
}

// ------------------------------------------------------------
// Branch edge — an edge added inside a branch
// Can connect base nodes, branch nodes, or mix of both
// ------------------------------------------------------------
export interface BranchEdge {
  id: string
  source: string               // node id (base or branch)
  target: string               // node id (base or branch)
  edgeType: 'engineering' | 'architecture' | 'both'
  strength: 1 | 2 | 3 | 4 | 5
  label?: string
  confidence: 'high' | 'medium' | 'uncertain'
}

// ------------------------------------------------------------
// BranchDelta — the actual changes introduced by ONE branch
// (relative to its parent, not to the base graph)
// ------------------------------------------------------------
export interface BranchDelta {
  branchId: string
  addedNodes: BranchNode[]
  addedEdges: BranchEdge[]
  // Fictional files added to existing nodes (base OR ancestor branch nodes)
  // Key = nodeId, Value = array of fictional files
  fictionalFiles: Record<string, FictionalFile[]>
}

// ------------------------------------------------------------
// Resolved graph — the effective graph for a specific branch,
// computed by walking the ancestor chain and applying all deltas.
// This is what the renderer consumes.
// ------------------------------------------------------------
export interface ResolvedNode {
  // Base Node fields (when the node comes from the base graph)
  id: string
  label: string
  type: 'layer' | 'module' | 'file' | 'component'
  parentId: string | null
  depth: number
  files: string[]
  detectedRole: string           // empty string for branch-added nodes
  patterns: string[]             // empty array for branch-added nodes
  metadata: {
    language?: string
    lineCount?: number
    complexity?: 'low' | 'medium' | 'high'
  }
  description?: string           // user note (branch nodes only)
  // Fictional files accumulated across all ancestor branches for this node
  fictionalFiles: FictionalFile[]
  // Attribution: which branch introduced this node ('base' or branch id)
  origin: 'base' | string
}

export interface ResolvedEdge {
  id: string
  source: string
  target: string
  edgeType: 'engineering' | 'architecture' | 'both'
  strength: 1 | 2 | 3 | 4 | 5
  label?: string
  confidence: 'high' | 'medium' | 'uncertain'
  // Attribution: which branch introduced this edge ('base' or branch id)
  origin: 'base' | string
}

export interface ResolvedGraph {
  branchId: string | null        // null = base graph (no branch active)
  nodes: ResolvedNode[]
  edges: ResolvedEdge[]
}