export { default as GraphRenderer } from './components/graph/GraphRenderer'
export { default as ManualEditor } from './components/graph/ManualEditor'
export { BranchPanel } from './branches/BranchPanel'
export { useBranches } from './branches/UseBranches'
export { BranchProvider } from './branches/UseBranches'

export type { RepoGraph, GraphMeta, Node, Edge, Overlay, NodeOverride, EdgeOverride, NodeType, EdgeType, EdgeConfidence, ComplexityLevel, DetectedPattern, LayoutTemplate, StatusTag, EstimatedSize } from './lib/pipeline/schemas/graph'
export type { ResolvedGraph, Branch, BranchDelta } from './branches/types'

export { recommendedView, type ViewType } from './components/graph/AlternativeViews'