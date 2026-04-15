// ============================================================
// RepoMap — useBranches hook
//
// Single source of truth for the branch system.
// Wrap your graph page with <BranchProvider> and consume
// with useBranches() anywhere in the tree.
//
// Responsibilities:
//   - Load all branches for the active repo from IndexedDB
//   - Track which branch is currently active
//   - Resolve the effective graph for the active branch
//   - Expose typed actions for every branch mutation
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import type { RepoGraph } from '../schemas/graph'
import type {
  Branch,
  BranchNode,
  BranchEdge,
  FictionalFile,
  ResolvedGraph,
} from './types'
import {
  createBranch,
  saveBranch,
  deleteBranch,
  getBranchesForRepo,
  addNodeToBranch,
  removeNodeFromBranch,
  addEdgeToBranch,
  removeEdgeFromBranch,
  addFictionalFile,
  removeFictionalFile,
} from './storage'
import {
  resolveBranch,
  newBranchNodeId,
  newBranchEdgeId,
  newFictionalFileId,
  isNodeFromBranch,
  isEdgeFromBranch,
} from './resolver'

// ------------------------------------------------------------
// State
// ------------------------------------------------------------

interface BranchState {
  /** All branches for the current repo, sorted by createdAt */
  branches: Branch[]
  /** Currently active branch id — null means viewing the base graph */
  activeBranchId: string | null
  /** The resolved graph for the active branch (or base graph) */
  resolvedGraph: ResolvedGraph | null
  /** True while loading from IndexedDB or resolving the graph */
  loading: boolean
  /** Any error that occurred during load/resolve */
  error: string | null
}

type BranchAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; branches: Branch[]; resolvedGraph: ResolvedGraph }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'SET_ACTIVE'; branchId: string | null; resolvedGraph: ResolvedGraph }
  | { type: 'BRANCHES_UPDATED'; branches: Branch[] }
  | { type: 'GRAPH_UPDATED'; resolvedGraph: ResolvedGraph }

function reducer(state: BranchState, action: BranchAction): BranchState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null }

    case 'LOAD_SUCCESS':
      return {
        ...state,
        loading: false,
        branches: action.branches,
        resolvedGraph: action.resolvedGraph,
      }

    case 'LOAD_ERROR':
      return { ...state, loading: false, error: action.error }

    case 'SET_ACTIVE':
      return {
        ...state,
        activeBranchId: action.branchId,
        resolvedGraph: action.resolvedGraph,
      }

    case 'BRANCHES_UPDATED':
      return { ...state, branches: action.branches }

    case 'GRAPH_UPDATED':
      return { ...state, resolvedGraph: action.resolvedGraph }

    default:
      return state
  }
}

const initialState: BranchState = {
  branches: [],
  activeBranchId: null,
  resolvedGraph: null,
  loading: true,
  error: null,
}

// ------------------------------------------------------------
// Context
// ------------------------------------------------------------

interface BranchContextValue extends BranchState {
  // --- Branch management ---

  /** Switch the active view to a branch (or null for base graph) */
  setActiveBranch: (branchId: string | null) => Promise<void>

  /** Create a new branch. parentBranchId null = child of base graph */
  createNewBranch: (params: {
    name: string
    description?: string
    color?: string
    parentBranchId: string | null
  }) => Promise<Branch>

  /** Rename or update color/description of a branch */
  updateBranch: (branchId: string, patch: Partial<Pick<Branch, 'name' | 'description' | 'color'>>) => Promise<void>

  /** Delete a branch and all its descendants */
  removeBranch: (branchId: string) => Promise<void>

  // --- Node mutations (active branch only) ---

  addNode: (params: {
    label: string
    type: BranchNode['type']
    parentId: string | null
    depth: number
    description?: string
    metadata?: BranchNode['metadata']
  }) => Promise<BranchNode>

  removeNode: (nodeId: string) => Promise<void>

  // --- Edge mutations (active branch only) ---

  addEdge: (params: {
    source: string
    target: string
    edgeType: BranchEdge['edgeType']
    strength: BranchEdge['strength']
    label?: string
    confidence: BranchEdge['confidence']
  }) => Promise<BranchEdge>

  removeEdge: (edgeId: string) => Promise<void>

  // --- Fictional file mutations (active branch only) ---

  addFictionalFileToNode: (params: {
    nodeId: string
    name: string
    description?: string
    pseudocode?: string
  }) => Promise<FictionalFile>

  removeFictionalFileFromNode: (nodeId: string, fileId: string) => Promise<void>

  // --- Derived helpers ---

  /** True if there is an active branch selected (not viewing base graph) */
  isOnBranch: boolean

  /** True if a node can be deleted (only branch-added nodes in the active branch) */
  canDeleteNode: (nodeId: string) => boolean

  /** True if an edge can be deleted (only branch-added edges in the active branch) */
  canDeleteEdge: (edgeId: string) => boolean

  /** Returns all direct children of a branch (for tree rendering) */
  childrenOf: (branchId: string | null) => Branch[]
}

const BranchContext = createContext<BranchContextValue | null>(null)

// ------------------------------------------------------------
// Provider
// ------------------------------------------------------------

interface BranchProviderProps {
  baseGraph: RepoGraph
  children: ReactNode
}

export function BranchProvider({ baseGraph, children }: BranchProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Stable ref to baseGraph so callbacks don't re-create on every render
  const baseGraphRef = useRef(baseGraph)
  baseGraphRef.current = baseGraph

  // repoGraphId used as the key for this repo's branches
  const repoGraphId = baseGraph.meta.repoUrl

  // ------------------------------------------------------------
  // Initial load
  // ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false

    async function load() {
      dispatch({ type: 'LOAD_START' })
      try {
        const branches = await getBranchesForRepo(repoGraphId)
        // Start on base graph (no active branch)
        const resolvedGraph = await resolveBranch(baseGraphRef.current, null)
        if (!cancelled) {
          dispatch({ type: 'LOAD_SUCCESS', branches, resolvedGraph })
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: 'LOAD_ERROR',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [repoGraphId])

  // ------------------------------------------------------------
  // Re-resolve graph when base graph changes externally
  // (e.g. after a re-analysis of the repo)
  // ------------------------------------------------------------
  useEffect(() => {
    async function reResolve() {
      const resolved = await resolveBranch(baseGraph, state.activeBranchId)
      dispatch({ type: 'GRAPH_UPDATED', resolvedGraph: resolved })
    }
    if (!state.loading) {
      reResolve()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseGraph])

  // ------------------------------------------------------------
  // Helper: re-resolve graph and update state
  // Call this after any delta mutation
  // ------------------------------------------------------------
  const reResolveActive = useCallback(async () => {
    const resolved = await resolveBranch(baseGraphRef.current, state.activeBranchId)
    dispatch({ type: 'GRAPH_UPDATED', resolvedGraph: resolved })
  }, [state.activeBranchId])

  // ------------------------------------------------------------
  // Helper: reload branch list from IndexedDB
  // ------------------------------------------------------------
  const reloadBranches = useCallback(async () => {
    const branches = await getBranchesForRepo(repoGraphId)
    dispatch({ type: 'BRANCHES_UPDATED', branches })
    return branches
  }, [repoGraphId])

  // ------------------------------------------------------------
  // setActiveBranch
  // ------------------------------------------------------------
  const setActiveBranch = useCallback(async (branchId: string | null) => {
    const resolvedGraph = await resolveBranch(baseGraphRef.current, branchId)
    dispatch({ type: 'SET_ACTIVE', branchId, resolvedGraph })
  }, [])

  // ------------------------------------------------------------
  // createNewBranch
  // ------------------------------------------------------------
  const createNewBranch = useCallback(async (params: {
    name: string
    description?: string
    color?: string
    parentBranchId: string | null
  }): Promise<Branch> => {
    const branch = await createBranch({ ...params, repoGraphId })
    await reloadBranches()
    return branch
  }, [repoGraphId, reloadBranches])

  // ------------------------------------------------------------
  // updateBranch
  // ------------------------------------------------------------
  const updateBranch = useCallback(async (
    branchId: string,
    patch: Partial<Pick<Branch, 'name' | 'description' | 'color'>>
  ) => {
    const branches = await getBranchesForRepo(repoGraphId)
    const branch = branches.find(b => b.id === branchId)
    if (!branch) return
    await saveBranch({ ...branch, ...patch, updatedAt: new Date().toISOString() })
    await reloadBranches()
  }, [repoGraphId, reloadBranches])

  // ------------------------------------------------------------
  // removeBranch
  // Deletes the branch and all of its descendants recursively.
  // If the deleted branch (or a descendant) is currently active,
  // fall back to the base graph.
  // ------------------------------------------------------------
  const removeBranch = useCallback(async (branchId: string) => {
    const branches = await getBranchesForRepo(repoGraphId)

    // Collect IDs to delete (the branch + all descendants)
    const toDelete = collectDescendants(branchId, branches)

    await Promise.all(toDelete.map(id => deleteBranch(id)))

    const remainingBranches = await reloadBranches()

    // If active branch was deleted, fall back to base graph
    if (state.activeBranchId && toDelete.includes(state.activeBranchId)) {
      const resolvedGraph = await resolveBranch(baseGraphRef.current, null)
      dispatch({ type: 'SET_ACTIVE', branchId: null, resolvedGraph })
    } else {
      dispatch({ type: 'BRANCHES_UPDATED', branches: remainingBranches })
    }
  }, [repoGraphId, reloadBranches, state.activeBranchId])

  // ------------------------------------------------------------
  // addNode
  // ------------------------------------------------------------
  const addNode = useCallback(async (params: {
    label: string
    type: BranchNode['type']
    parentId: string | null
    depth: number
    description?: string
    metadata?: BranchNode['metadata']
  }): Promise<BranchNode> => {
    if (!state.activeBranchId) {
      throw new Error('Cannot add a node: no active branch. Create or select a branch first.')
    }

    const node: BranchNode = {
      id:          newBranchNodeId(params.label, params.type),
      label:       params.label,
      type:        params.type,
      parentId:    params.parentId,
      depth:       params.depth,
      files:       [],
      description: params.description,
      metadata:    params.metadata,
    }

    await addNodeToBranch(state.activeBranchId, node)
    await reResolveActive()
    return node
  }, [state.activeBranchId, reResolveActive])

  // ------------------------------------------------------------
  // removeNode
  // ------------------------------------------------------------
  const removeNode = useCallback(async (nodeId: string) => {
    if (!state.activeBranchId) return
    await removeNodeFromBranch(state.activeBranchId, nodeId)
    await reResolveActive()
  }, [state.activeBranchId, reResolveActive])

  // ------------------------------------------------------------
  // addEdge
  // ------------------------------------------------------------
  const addEdge = useCallback(async (params: {
    source: string
    target: string
    edgeType: BranchEdge['edgeType']
    strength: BranchEdge['strength']
    label?: string
    confidence: BranchEdge['confidence']
  }): Promise<BranchEdge> => {
    if (!state.activeBranchId) {
      throw new Error('Cannot add an edge: no active branch.')
    }

    const edge: BranchEdge = {
      id:         newBranchEdgeId(params.source, params.target),
      source:     params.source,
      target:     params.target,
      edgeType:   params.edgeType,
      strength:   params.strength,
      label:      params.label,
      confidence: params.confidence,
    }

    await addEdgeToBranch(state.activeBranchId, edge)
    await reResolveActive()
    return edge
  }, [state.activeBranchId, reResolveActive])

  // ------------------------------------------------------------
  // removeEdge
  // ------------------------------------------------------------
  const removeEdge = useCallback(async (edgeId: string) => {
    if (!state.activeBranchId) return
    await removeEdgeFromBranch(state.activeBranchId, edgeId)
    await reResolveActive()
  }, [state.activeBranchId, reResolveActive])

  // ------------------------------------------------------------
  // addFictionalFileToNode
  // ------------------------------------------------------------
  const addFictionalFileToNode = useCallback(async (params: {
    nodeId: string
    name: string
    description?: string
    pseudocode?: string
  }): Promise<FictionalFile> => {
    if (!state.activeBranchId) {
      throw new Error('Cannot add a fictional file: no active branch.')
    }

    const file: FictionalFile = {
      id:          newFictionalFileId(),
      name:        params.name,
      description: params.description,
      pseudocode:  params.pseudocode,
      addedAt:     new Date().toISOString(),
    }

    await addFictionalFile(state.activeBranchId, params.nodeId, file)
    await reResolveActive()
    return file
  }, [state.activeBranchId, reResolveActive])

  // ------------------------------------------------------------
  // removeFictionalFileFromNode
  // ------------------------------------------------------------
  const removeFictionalFileFromNode = useCallback(async (
    nodeId: string,
    fileId: string
  ) => {
    if (!state.activeBranchId) return
    await removeFictionalFile(state.activeBranchId, nodeId, fileId)
    await reResolveActive()
  }, [state.activeBranchId, reResolveActive])

  // ------------------------------------------------------------
  // Derived helpers (stable, memoized)
  // ------------------------------------------------------------

  const isOnBranch = state.activeBranchId !== null

  const canDeleteNode = useCallback((nodeId: string): boolean => {
    if (!state.activeBranchId || !state.resolvedGraph) return false
    const node = state.resolvedGraph.nodes.find(n => n.id === nodeId)
    if (!node) return false
    return isNodeFromBranch(node, state.activeBranchId)
  }, [state.activeBranchId, state.resolvedGraph])

  const canDeleteEdge = useCallback((edgeId: string): boolean => {
    if (!state.activeBranchId || !state.resolvedGraph) return false
    const edge = state.resolvedGraph.edges.find(e => e.id === edgeId)
    if (!edge) return false
    return isEdgeFromBranch(edge, state.activeBranchId)
  }, [state.activeBranchId, state.resolvedGraph])

  const childrenOf = useCallback((parentId: string | null): Branch[] => {
    return state.branches.filter(b => b.parentBranchId === parentId)
  }, [state.branches])

  // ------------------------------------------------------------
  // Context value (stable reference via useMemo)
  // ------------------------------------------------------------
  const value = useMemo<BranchContextValue>(() => ({
    ...state,
    setActiveBranch,
    createNewBranch,
    updateBranch,
    removeBranch,
    addNode,
    removeNode,
    addEdge,
    removeEdge,
    addFictionalFileToNode,
    removeFictionalFileFromNode,
    isOnBranch,
    canDeleteNode,
    canDeleteEdge,
    childrenOf,
  }), [
    state,
    setActiveBranch,
    createNewBranch,
    updateBranch,
    removeBranch,
    addNode,
    removeNode,
    addEdge,
    removeEdge,
    addFictionalFileToNode,
    removeFictionalFileFromNode,
    isOnBranch,
    canDeleteNode,
    canDeleteEdge,
    childrenOf,
  ])

  return (
    <BranchContext.Provider value={value}>
      {children}
    </BranchContext.Provider>
  )
}

// ------------------------------------------------------------
// Consumer hook
// ------------------------------------------------------------

export function useBranches(): BranchContextValue {
  const ctx = useContext(BranchContext)
  if (!ctx) {
    throw new Error('useBranches must be used inside <BranchProvider>')
  }
  return ctx
}

// ------------------------------------------------------------
// Utility: collect a branch + all its descendants (for deletion)
// ------------------------------------------------------------
function collectDescendants(rootId: string, allBranches: Branch[]): string[] {
  const result: string[] = [rootId]
  const queue = [rootId]

  while (queue.length > 0) {
    const current = queue.shift()!
    const children = allBranches.filter(b => b.parentBranchId === current)
    for (const child of children) {
      result.push(child.id)
      queue.push(child.id)
    }
  }

  return result
}