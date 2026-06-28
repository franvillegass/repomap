import * as react from 'react';
import { ReactNode } from 'react';

type NodeType = 'layer' | 'module' | 'file' | 'component';
type EdgeType = 'engineering' | 'architecture' | 'both';
type EdgeConfidence = 'high' | 'medium' | 'uncertain';
type ComplexityLevel = 'low' | 'medium' | 'high';
type EstimatedSize = 'small' | 'medium' | 'large';
type StatusTag = 'legacy' | 'in_refactor' | 'stable' | 'deprecated';
type DetectedPattern = 'clean_architecture' | 'hexagonal' | 'mvc' | 'microservices' | 'layered_monolith' | 'feature_modules' | 'pipeline_etl' | 'unknown';
type LayoutTemplate = 'concentric_rings' | 'horizontal_three_column' | 'cluster' | 'vertical_layers' | 'grid_clusters' | 'left_right_flow' | 'force_directed';
interface Node {
    id: string;
    label: string;
    type: NodeType;
    parentId: string | null;
    depth: number;
    files: string[];
    detectedRole: string;
    patterns: string[];
    metadata: {
        language?: string;
        lineCount?: number;
        complexity?: ComplexityLevel;
        statusTag?: 'legacy' | 'in_refactor' | 'stable' | 'deprecated';
    };
}
interface Edge {
    id: string;
    source: string;
    target: string;
    edgeType: EdgeType;
    strength: 1 | 2 | 3 | 4 | 5;
    label?: string;
    confidence: EdgeConfidence;
}
interface GraphMeta {
    repoUrl: string;
    repoName: string;
    analysisVersion: string;
    analyzedAt: string;
    detectedPattern: DetectedPattern;
    layoutTemplate: LayoutTemplate;
    patternConfidence: number;
}
interface NodeOverride {
    customLabel?: string;
    position?: {
        x: number;
        y: number;
    };
    statusTag?: StatusTag;
    annotation?: string;
    customParentId?: string;
}
interface EdgeOverride {
    hidden?: boolean;
    customLabel?: string;
    annotation?: string;
    customEdgeType?: EdgeType;
}
interface Overlay {
    version: number;
    nodeOverrides: Record<string, NodeOverride>;
    edgeOverrides: Record<string, EdgeOverride>;
    manualNodes: Node[];
    manualEdges: Edge[];
}
interface RepoGraph {
    meta: GraphMeta;
    nodes: Node[];
    edges: Edge[];
    overlay: Overlay;
}

interface GraphRendererProps {
    graph: RepoGraph;
    onOverlayChange?: (patch: Partial<RepoGraph['overlay']>) => void;
}
declare function GraphRenderer({ graph, onOverlayChange }: GraphRendererProps): react.JSX.Element;

interface ManualEditorProps {
    /** 'create' = blank canvas (default). 'edit' = start from existing graph. */
    mode?: 'create' | 'edit';
    initialGraph?: RepoGraph;
    lockedNodeIds?: string[];
    lockedEdgeIds?: string[];
    contextLabel?: string;
    onComplete: (graph: RepoGraph) => void;
    onCancel?: () => void;
}
declare function ManualEditor({ mode, initialGraph, lockedNodeIds, lockedEdgeIds, contextLabel, onComplete, onCancel, }: ManualEditorProps): react.JSX.Element;

declare function BranchPanel(): react.JSX.Element;

interface Branch {
    id: string;
    name: string;
    description?: string;
    parentBranchId: string | null;
    repoGraphId: string;
    createdAt: string;
    updatedAt: string;
    color?: string;
}
interface FictionalFile {
    id: string;
    name: string;
    description?: string;
    pseudocode?: string;
    addedAt: string;
}
interface BranchNode {
    id: string;
    label: string;
    type: 'layer' | 'module' | 'file' | 'component';
    parentId: string | null;
    depth: number;
    files: string[];
    description?: string;
    metadata?: {
        language?: string;
        complexity?: 'low' | 'medium' | 'high';
    };
}
interface BranchEdge {
    id: string;
    source: string;
    target: string;
    edgeType: 'engineering' | 'architecture' | 'both';
    strength: 1 | 2 | 3 | 4 | 5;
    label?: string;
    confidence: 'high' | 'medium' | 'uncertain';
}
interface BranchDelta {
    branchId: string;
    addedNodes: BranchNode[];
    addedEdges: BranchEdge[];
    fictionalFiles: Record<string, FictionalFile[]>;
}
interface ResolvedNode {
    id: string;
    label: string;
    type: 'layer' | 'module' | 'file' | 'component';
    parentId: string | null;
    depth: number;
    files: string[];
    detectedRole: string;
    patterns: string[];
    metadata: {
        language?: string;
        lineCount?: number;
        complexity?: 'low' | 'medium' | 'high';
    };
    description?: string;
    fictionalFiles: FictionalFile[];
    origin: 'base' | string;
}
interface ResolvedEdge {
    id: string;
    source: string;
    target: string;
    edgeType: 'engineering' | 'architecture' | 'both';
    strength: 1 | 2 | 3 | 4 | 5;
    label?: string;
    confidence: 'high' | 'medium' | 'uncertain';
    origin: 'base' | string;
}
interface ResolvedGraph {
    branchId: string | null;
    nodes: ResolvedNode[];
    edges: ResolvedEdge[];
}

interface BranchState {
    /** All branches for the current repo, sorted by createdAt */
    branches: Branch[];
    /** Currently active branch id — null means viewing the base graph */
    activeBranchId: string | null;
    /** The resolved graph for the active branch (or base graph) */
    resolvedGraph: ResolvedGraph | null;
    /** True while loading from IndexedDB or resolving the graph */
    loading: boolean;
    /** Any error that occurred during load/resolve */
    error: string | null;
}
interface BranchContextValue extends BranchState {
    /** Switch the active view to a branch (or null for base graph) */
    setActiveBranch: (branchId: string | null) => Promise<void>;
    /** Create a new branch. parentBranchId null = child of base graph */
    createNewBranch: (params: {
        name: string;
        description?: string;
        color?: string;
        parentBranchId: string | null;
    }) => Promise<Branch>;
    /** Rename or update color/description of a branch */
    updateBranch: (branchId: string, patch: Partial<Pick<Branch, 'name' | 'description' | 'color'>>) => Promise<void>;
    /** Delete a branch and all its descendants */
    removeBranch: (branchId: string) => Promise<void>;
    addNode: (params: {
        label: string;
        type: BranchNode['type'];
        parentId: string | null;
        depth: number;
        description?: string;
        metadata?: BranchNode['metadata'];
    }) => Promise<BranchNode>;
    removeNode: (nodeId: string) => Promise<void>;
    addEdge: (params: {
        source: string;
        target: string;
        edgeType: BranchEdge['edgeType'];
        strength: BranchEdge['strength'];
        label?: string;
        confidence: BranchEdge['confidence'];
    }) => Promise<BranchEdge>;
    removeEdge: (edgeId: string) => Promise<void>;
    /** Replace the active branch's added nodes/edges from an edited resolved graph. */
    replaceActiveBranchGraph: (graph: RepoGraph) => Promise<void>;
    addFictionalFileToNode: (params: {
        nodeId: string;
        name: string;
        description?: string;
        pseudocode?: string;
    }) => Promise<FictionalFile>;
    removeFictionalFileFromNode: (nodeId: string, fileId: string) => Promise<void>;
    /** True if there is an active branch selected (not viewing base graph) */
    isOnBranch: boolean;
    /** True if a node can be deleted (only branch-added nodes in the active branch) */
    canDeleteNode: (nodeId: string) => boolean;
    /** True if an edge can be deleted (only branch-added edges in the active branch) */
    canDeleteEdge: (edgeId: string) => boolean;
    /** Returns all direct children of a branch (for tree rendering) */
    childrenOf: (branchId: string | null) => Branch[];
}
interface BranchProviderProps {
    baseGraph: RepoGraph;
    children: ReactNode;
}
declare function BranchProvider({ baseGraph, children }: BranchProviderProps): react.JSX.Element;
declare function useBranches(): BranchContextValue;

type ViewType = 'graph' | 'onion' | 'layers' | 'clusters' | 'pipeline';
declare function recommendedView(layout: string): ViewType;

export { type Branch, type BranchDelta, BranchPanel, BranchProvider, type ComplexityLevel, type DetectedPattern, type Edge, type EdgeConfidence, type EdgeOverride, type EdgeType, type EstimatedSize, type GraphMeta, GraphRenderer, type LayoutTemplate, ManualEditor, type Node, type NodeOverride, type NodeType, type Overlay, type RepoGraph, type ResolvedGraph, type StatusTag, type ViewType, recommendedView, useBranches };
