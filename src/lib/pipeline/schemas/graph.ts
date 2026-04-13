// ============================================================
// RepoMap — JSON Graph Schema v1.0
// Every product feature depends on this schema being correct.
// Do not change field names without updating all pipeline passes.
// ============================================================

export type NodeType = 'layer' | 'module' | 'file' | 'component'

export type EdgeType = 'engineering' | 'architecture' | 'both'

export type EdgeConfidence = 'high' | 'medium' | 'uncertain'

export type ComplexityLevel = 'low' | 'medium' | 'high'

export type EstimatedSize = 'small' | 'medium' | 'large'

export type StatusTag = 'legacy' | 'in_refactor' | 'stable' | 'deprecated'

export type DetectedPattern =
  | 'clean_architecture'
  | 'hexagonal'
  | 'mvc'
  | 'microservices'
  | 'layered_monolith'
  | 'feature_modules'
  | 'pipeline_etl'
  | 'unknown'

export type LayoutTemplate =
  | 'concentric_rings'
  | 'horizontal_three_column'
  | 'cluster'
  | 'vertical_layers'
  | 'grid_clusters'
  | 'left_right_flow'
  | 'force_directed'

// ------------------------------------------------------------
// Node
// ID format: layer__name | module__name | file__path | component__name
// ------------------------------------------------------------
export interface Node {
  id: string
  label: string
  type: NodeType
  parentId: string | null   // null = top-level root node
  depth: number             // 0=layer, 1=module, 2=file, 3=component (explicit for renderer)
  files: string[]           // actual file paths included in this node
  detectedRole: string      // e.g. "authentication", "data_access", "api_gateway"
  patterns: string[]        // e.g. ["repository_pattern", "dependency_injection"]
  metadata: {
    language?: string
    lineCount?: number
    complexity?: ComplexityLevel
  }
}

// ------------------------------------------------------------
// Edge
// ------------------------------------------------------------
export interface Edge {
  id: string
  source: string            // Node.id
  target: string            // Node.id
  edgeType: EdgeType
  strength: 1 | 2 | 3 | 4 | 5  // 1=weak/occasional, 5=critical/central
  label?: string            // e.g. "calls", "implements", "depends on"
  confidence: EdgeConfidence
}

// ------------------------------------------------------------
// GraphMeta
// ------------------------------------------------------------
export interface GraphMeta {
  repoUrl: string
  repoName: string
  analysisVersion: string   // hash of file tree at analysis time
  analyzedAt: string        // ISO timestamp
  detectedPattern: DetectedPattern
  layoutTemplate: LayoutTemplate
  patternConfidence: number // 0-1; below 0.6 → force_directed override
}

// ------------------------------------------------------------
// Overlay — user edits, never merged into base nodes/edges
// ------------------------------------------------------------
export interface NodeOverride {
  customLabel?: string
  position?: { x: number; y: number }
  statusTag?: StatusTag
  annotation?: string
  customParentId?: string   // for manual regrouping
}

export interface EdgeOverride {
  hidden?: boolean
  customLabel?: string
  annotation?: string
  customEdgeType?: EdgeType
}

export interface Overlay {
  version: number           // increments on every user edit
  nodeOverrides: Record<string, NodeOverride>
  edgeOverrides: Record<string, EdgeOverride>
  manualNodes: Node[]       // nodes added manually by the user
  manualEdges: Edge[]       // edges added manually by the user
}

// ------------------------------------------------------------
// RepoGraph — the full persisted document (stored in IndexedDB)
// ------------------------------------------------------------
export interface RepoGraph {
  meta: GraphMeta
  nodes: Node[]
  edges: Edge[]
  overlay: Overlay
}

// ------------------------------------------------------------
// Pipeline intermediate types
// ------------------------------------------------------------

// Pass 1 output
export interface Pass1Output {
  relevantFiles: string[]
  ignoredReasons: Record<string, string>  // path → reason (for debugging only)
  tentativeModules: {
    id: string              // module__<name>
    label: string
    filePaths: string[]
    description: string     // one-line summary
  }[]
  detectedLanguages: string[]
  estimatedSize: EstimatedSize
}

// Pass 2 output
export interface Pass2Output {
  nodes: Omit<Node, 'detectedRole' | 'patterns'>[]
  edges: Edge[]
}

// Pass 3 output
export interface Pass3Output {
  meta: Omit<GraphMeta, 'repoUrl' | 'repoName' | 'analysisVersion' | 'analyzedAt'>
  nodeEnrichments: Record<string, {
    detectedRole: string
    patterns: string[]
  }>
}
