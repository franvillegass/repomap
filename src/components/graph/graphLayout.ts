'use client'

import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react'
import type {
  RepoGraph,
  Node,
  Edge,
  LayoutTemplate,
} from '@/lib/pipeline/schemas/graph'
import type { ResolvedGraph } from '@/branches/types'

// ------------------------------------------------------------
// React Flow Data Types
// ------------------------------------------------------------

export interface RFNodeData {
  label: string
  nodeType: 'layer' | 'module' | 'file' | 'component'
  detectedRole: string
  patterns: string[]
  fileCount: number
  files?: string[]
  complexity?: 'low' | 'medium' | 'high'
  depth: number
  statusTag?: 'legacy' | 'in_refactor' | 'stable' | 'deprecated'
  // Branch-specific fields
  isBranchNode?: boolean
  branchOrigin?: string
  description?: string
  fictionalFiles?: import('@/branches/types').FictionalFile[]
}

export interface RFEdgeData {
  edgeType: 'engineering' | 'architecture' | 'both'
  confidence: 'high' | 'medium' | 'uncertain'
  strength: number
  isBranchEdge?: boolean
}

// ------------------------------------------------------------
// Build from base RepoGraph (no branch active)
// ------------------------------------------------------------

export function buildReactFlowGraph(graph: RepoGraph): {
  nodes: RFNode<RFNodeData>[]
  edges: RFEdge<RFEdgeData>[]
} {
  const { nodes, edges, overlay, meta } = graph

  const mergedNodes: Node[] = nodes.map((n) => {
    const ov = overlay.nodeOverrides[n.id]
    return ov ? { ...n, label: ov.customLabel ?? n.label } : n
  })

  const allNodes = [...mergedNodes, ...overlay.manualNodes]
  const allEdges = [...edges, ...overlay.manualEdges]

  const visibleEdges = allEdges.filter(
    (e) => !overlay.edgeOverrides[e.id]?.hidden
  )

  const positions = computePositions(allNodes, meta.layoutTemplate)

  const rfNodes: RFNode<RFNodeData>[] = allNodes.map((node) => ({
    id: node.id,
    type: 'repoNode',
    position: positions[node.id] ?? { x: 0, y: 0 },
    data: {
      label:        node.label,
      nodeType:     node.type,
      detectedRole: node.detectedRole,
      patterns:     node.patterns,
      fileCount:    node.files.length,
      files:        node.files,
      complexity:   node.metadata.complexity,
      depth:        node.depth,
    },
  }))

  const rfEdges: RFEdge<RFEdgeData>[] = visibleEdges.map((edge) => {
    const ov = overlay.edgeOverrides[edge.id]
    return {
      id:     edge.id,
      source: edge.source,
      target: edge.target,
      type:   'repoEdge',
      label:  ov?.customLabel ?? edge.label,
      data: {
        edgeType:   (ov?.customEdgeType ?? edge.edgeType),
        confidence: edge.confidence,
        strength:   edge.strength,
      },
    }
  })

  return { nodes: rfNodes, edges: rfEdges }
}

// ------------------------------------------------------------
// Build from ResolvedGraph (branch active)
// Nodes/edges that came from a branch get visual markers.
// ------------------------------------------------------------

export function buildReactFlowGraphFromResolved(
  resolved: ResolvedGraph,
  layoutTemplate: LayoutTemplate
): {
  nodes: RFNode<RFNodeData>[]
  edges: RFEdge<RFEdgeData>[]
} {
  // ResolvedNode satisfies the shape Node needs for layout
  const layoutNodes: Node[] = resolved.nodes.map((n) => ({
    id:           n.id,
    label:        n.label,
    type:         n.type,
    parentId:     n.parentId,
    depth:        n.depth,
    files:        n.files,
    detectedRole: n.detectedRole,
    patterns:     n.patterns,
    metadata:     n.metadata,
  }))

  const positions = computePositions(layoutNodes, layoutTemplate)

  const rfNodes: RFNode<RFNodeData>[] = resolved.nodes.map((node) => ({
    id:   node.id,
    type: 'repoNode',
    position: positions[node.id] ?? { x: 0, y: 0 },
    data: {
      label:         node.label,
      nodeType:      node.type,
      detectedRole:  node.detectedRole,
      patterns:      node.patterns,
      fileCount:     node.files.length,
      files:         node.files,
      complexity:    node.metadata?.complexity,
      depth:         node.depth,
      description:   node.description,
      fictionalFiles: node.fictionalFiles,
      // Visual markers for branch-added nodes
      isBranchNode:  node.origin !== 'base',
      branchOrigin:  node.origin !== 'base' ? node.origin : undefined,
    },
  }))

  const rfEdges: RFEdge<RFEdgeData>[] = resolved.edges.map((edge) => ({
    id:     edge.id,
    source: edge.source,
    target: edge.target,
    type:   'repoEdge',
    label:  edge.label,
    data: {
      edgeType:     edge.edgeType,
      confidence:   edge.confidence,
      strength:     edge.strength,
      isBranchEdge: edge.origin !== 'base',
    },
  }))

  return { nodes: rfNodes, edges: rfEdges }
}

// ------------------------------------------------------------
// Layouts
// ------------------------------------------------------------

const NODE_WIDTH  = 200
const NODE_HEIGHT = 80
const H_GAP       = 60
const V_GAP       = 80

function computePositions(
  nodes: Node[],
  layout: LayoutTemplate
): Record<string, { x: number; y: number }> {
  switch (layout) {
    case 'vertical_layers':         return verticalLayers(nodes)
    case 'horizontal_three_column': return horizontalThreeColumn(nodes)
    case 'concentric_rings':        return concentricRings(nodes)
    case 'left_right_flow':         return leftRightFlow(nodes)
    case 'grid_clusters':
    case 'cluster':                 return gridClusters(nodes)
    default:                        return forceDirectedSeed(nodes)
  }
}

function verticalLayers(nodes: Node[]): Record<string, { x: number; y: number }> {
  const byDepth: Record<number, Node[]> = {}
  for (const n of nodes) { (byDepth[n.depth] ??= []).push(n) }
  const result: Record<string, { x: number; y: number }> = {}
  for (const [depthStr, group] of Object.entries(byDepth)) {
    const depth  = Number(depthStr)
    const totalW = group.length * (NODE_WIDTH + H_GAP) - H_GAP
    const startX = -totalW / 2
    group.forEach((n, i) => {
      result[n.id] = {
        x: startX + i * (NODE_WIDTH + H_GAP),
        y: depth * (NODE_HEIGHT + V_GAP) * 2,
      }
    })
  }
  return result
}

function horizontalThreeColumn(nodes: Node[]): Record<string, { x: number; y: number }> {
  const col0 = nodes.filter((n) => n.depth === 0)
  const col1 = nodes.filter((n) => n.depth === 1)
  const col2 = nodes.filter((n) => n.depth >= 2)
  const result: Record<string, { x: number; y: number }> = {}
  const colX = [0, NODE_WIDTH + H_GAP * 4, (NODE_WIDTH + H_GAP * 4) * 2]
  ;[col0, col1, col2].forEach((group, col) => {
    group.forEach((n, i) => {
      result[n.id] = { x: colX[col], y: i * (NODE_HEIGHT + V_GAP) }
    })
  })
  return result
}

function concentricRings(nodes: Node[]): Record<string, { x: number; y: number }> {
  const byDepth: Record<number, Node[]> = {}
  for (const n of nodes) { (byDepth[n.depth] ??= []).push(n) }
  const result: Record<string, { x: number; y: number }> = {}
  const RING_RADIUS = 260
  for (const [depthStr, group] of Object.entries(byDepth)) {
    const depth  = Number(depthStr)
    const radius = depth === 0 ? 0 : depth * RING_RADIUS
    if (depth === 0 && group.length === 1) {
      result[group[0].id] = { x: 0, y: 0 }
      continue
    }
    const step = (2 * Math.PI) / group.length
    group.forEach((n, i) => {
      result[n.id] = {
        x: Math.round(radius * Math.cos(i * step - Math.PI / 2)),
        y: Math.round(radius * Math.sin(i * step - Math.PI / 2)),
      }
    })
  }
  return result
}

function leftRightFlow(nodes: Node[]): Record<string, { x: number; y: number }> {
  const byDepth: Record<number, Node[]> = {}
  for (const n of nodes) { (byDepth[n.depth] ??= []).push(n) }
  const result: Record<string, { x: number; y: number }> = {}
  for (const [depthStr, group] of Object.entries(byDepth)) {
    const depth  = Number(depthStr)
    const totalH = group.length * (NODE_HEIGHT + V_GAP) - V_GAP
    const startY = -totalH / 2
    group.forEach((n, i) => {
      result[n.id] = {
        x: depth * (NODE_WIDTH + H_GAP * 3),
        y: startY + i * (NODE_HEIGHT + V_GAP),
      }
    })
  }
  return result
}

function gridClusters(nodes: Node[]): Record<string, { x: number; y: number }> {
  const modules = nodes.filter((n) => n.depth <= 1)
  const files   = nodes.filter((n) => n.depth >= 2)
  const COLS    = Math.ceil(Math.sqrt(modules.length))
  const CELL_W  = NODE_WIDTH  * 3
  const CELL_H  = NODE_HEIGHT * 5
  const result: Record<string, { x: number; y: number }> = {}
  const modulePos: Record<string, { x: number; y: number }> = {}
  modules.forEach((n, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    modulePos[n.id] = { x: col * CELL_W, y: row * CELL_H }
    result[n.id]    = modulePos[n.id]
  })
  const childrenByParent: Record<string, Node[]> = {}
  for (const f of files) { (childrenByParent[f.parentId ?? '__root'] ??= []).push(f) }
  for (const [parentId, children] of Object.entries(childrenByParent)) {
    const origin = modulePos[parentId] ?? { x: 0, y: 0 }
    children.forEach((n, i) => {
      result[n.id] = {
        x: origin.x + (i % 3) * (NODE_WIDTH + H_GAP),
        y: origin.y + NODE_HEIGHT + V_GAP + Math.floor(i / 3) * (NODE_HEIGHT + V_GAP),
      }
    })
  }
  return result
}

function forceDirectedSeed(nodes: Node[]): Record<string, { x: number; y: number }> {
  const COLS = Math.ceil(Math.sqrt(nodes.length))
  const result: Record<string, { x: number; y: number }> = {}
  nodes.forEach((n, i) => {
    result[n.id] = {
      x: (i % COLS) * (NODE_WIDTH + H_GAP * 2),
      y: Math.floor(i / COLS) * (NODE_HEIGHT + V_GAP * 2),
    }
  })
  return result
}