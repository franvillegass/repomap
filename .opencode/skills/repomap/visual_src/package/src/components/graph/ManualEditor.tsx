'use client'

// ============================================================
// RepoMap — ManualEditor
//
// A standalone React Flow canvas for creating architecture
// graphs by hand — no AI required.
//
// Also used as the "edit mode" overlay when viewing an
// AI-generated graph (pass mode="edit" + initialGraph).
//
// Outputs a valid RepoGraph when the user clicks "Done".
//
// Usage:
//   <ManualEditor onComplete={(graph) => setGraph(graph)} />
//   <ManualEditor mode="edit" initialGraph={graph} onComplete={...} onCancel={...} />
// ============================================================

import {
  useCallback,
  useState,
  useRef,
  useMemo,
  useEffect,
} from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  MiniMap,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type {
  RepoGraph,
  Node,
  Edge,
  NodeType,
  EdgeType,
  LayoutTemplate,
} from '../../lib/pipeline/schemas/graph'
import { nodeTypes, edgeTypes } from './GraphNodes'
import type { RFNodeData, RFEdgeData } from './graphLayout'

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────

export interface ManualEditorProps {
  /** 'create' = blank canvas (default). 'edit' = start from existing graph. */
  mode?:         'create' | 'edit'
  initialGraph?: RepoGraph
  lockedNodeIds?: string[]
  lockedEdgeIds?: string[]
  contextLabel?:  string
  onComplete:    (graph: RepoGraph) => void
  onCancel?:     () => void
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const NODE_TYPES_LIST: { type: NodeType; label: string; color: string; depth: number }[] = [
  { type: 'layer',     label: 'Layer',     color: '#60a5fa', depth: 0 },
  { type: 'module',    label: 'Module',    color: '#a78bfa', depth: 1 },
  { type: 'file',      label: 'File',      color: '#34d399', depth: 2 },
  { type: 'component', label: 'Component', color: '#fb923c', depth: 3 },
]

const EDGE_TYPES_LIST: { type: EdgeType; label: string; color: string }[] = [
  { type: 'engineering',  label: 'Runtime call',    color: '#60a5fa' },
  { type: 'architecture', label: 'Design structure', color: '#c084fc' },
  { type: 'both',         label: 'Mixed',            color: '#f472b6' },
]

const LAYOUT_OPTIONS: { value: LayoutTemplate; label: string }[] = [
  { value: 'vertical_layers',         label: 'Vertical layers'     },
  { value: 'horizontal_three_column', label: 'Three columns'       },
  { value: 'concentric_rings',        label: 'Concentric rings'    },
  { value: 'left_right_flow',         label: 'Pipeline flow'       },
  { value: 'grid_clusters',           label: 'Grid clusters'       },
  { value: 'force_directed',          label: 'Free (force-dir.)'   },
]

function makeNodeId(type: NodeType, label: string): string {
  const slug = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'node'
  return `${type}__${slug}__${Date.now()}`
}

function makeEdgeId(source: string, target: string): string {
  return `edge__${source}__${target}__${Date.now()}`
}

function emptyGraph(meta: Partial<RepoGraph['meta']> = {}): RepoGraph {
  return {
    meta: {
      repoUrl:           meta.repoUrl           ?? 'manual://untitled',
      repoName:          meta.repoName          ?? 'Untitled diagram',
      analysisVersion:   'manual',
      analyzedAt:        new Date().toISOString(),
      detectedPattern:   meta.detectedPattern   ?? 'unknown',
      layoutTemplate:    meta.layoutTemplate    ?? 'force_directed',
      patternConfidence: 0,
    },
    nodes:   [],
    edges:   [],
    overlay: {
      version:       0,
      nodeOverrides: {},
      edgeOverrides: {},
      manualNodes:   [],
      manualEdges:   [],
    },
  }
}

// ─────────────────────────────────────────────────────────────
// Convert RepoGraph ↔ React Flow
// ─────────────────────────────────────────────────────────────

function graphToRF(graph: RepoGraph): {
  nodes: RFNode<RFNodeData>[]
  edges: RFEdge<RFEdgeData>[]
} {
  const allNodes = [...graph.nodes, ...graph.overlay.manualNodes]
  const allEdges = [...graph.edges, ...graph.overlay.manualEdges]

  const rfNodes: RFNode<RFNodeData>[] = allNodes.map((n, i) => {
    const ov  = graph.overlay.nodeOverrides[n.id]
    const col = Math.ceil(Math.sqrt(allNodes.length))
    return {
      id:   n.id,
      type: 'repoNode',
      position: ov?.position ?? {
        x: (i % col) * 280,
        y: Math.floor(i / col) * 140,
      },
      data: {
        label:        ov?.customLabel ?? n.label,
        nodeType:     n.type,
        detectedRole: n.detectedRole,
        patterns:     n.patterns,
        fileCount:    n.files.length,
        files:        n.files,
        complexity:   n.metadata.complexity,
        depth:        n.depth,
        parentId:     n.parentId,
        statusTag:    ov?.statusTag ?? n.metadata.statusTag,
      },
    }
  })

  const rfEdges: RFEdge<RFEdgeData>[] = allEdges
    .filter((e) => !graph.overlay.edgeOverrides[e.id]?.hidden)
    .map((e) => ({
      id:     e.id,
      source: e.source,
      target: e.target,
      type:   'repoEdge',
      label:  e.label,
      data: {
        edgeType:   e.edgeType,
        confidence: e.confidence,
        strength:   e.strength,
      },
    }))

  return { nodes: rfNodes, edges: rfEdges }
}

function rfToGraph(
  rfNodes: RFNode<RFNodeData>[],
  rfEdges: RFEdge<RFEdgeData>[],
  meta:    RepoGraph['meta'],
): RepoGraph {
  const nodes: Node[] = rfNodes.map((n) => ({
    id:           n.id,
    label:        (n.data.label as string),
    type:         n.data.nodeType,
    parentId:     (n.data.parentId as string | null | undefined) ?? null,
    depth:        n.data.depth ?? 0,
    files:        (n.data.files as string[]) ?? [],
    detectedRole: (n.data.detectedRole as string) ?? '',
    patterns:     (n.data.patterns as string[]) ?? [],
    metadata: {
      complexity: n.data.complexity,
      statusTag:  n.data.statusTag,
    },
  }))

  const edges: Edge[] = rfEdges.map((e) => ({
    id:         e.id,
    source:     e.source,
    target:     e.target,
    edgeType:   (e.data?.edgeType   ?? 'engineering') as EdgeType,
    strength:   (e.data?.strength   ?? 3) as 1|2|3|4|5,
    confidence: (e.data?.confidence ?? 'high') as 'high'|'medium'|'uncertain',
    label:      typeof e.label === 'string' ? e.label : undefined,
  }))

  // Also persist node positions in overlay
  const nodeOverrides: RepoGraph['overlay']['nodeOverrides'] = {}
  rfNodes.forEach((n) => {
    nodeOverrides[n.id] = { position: n.position }
  })

  return {
    meta,
    nodes,
    edges,
    overlay: {
      version:       1,
      nodeOverrides,
      edgeOverrides: {},
      manualNodes:   [],
      manualEdges:   [],
    },
  }
}

// ─────────────────────────────────────────────────────────────
// Panel subcomponent
// ─────────────────────────────────────────────────────────────

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background:    '#080e1a',
      border:        '1px solid #1e293b',
      borderRadius:  10,
      padding:       '14px 16px',
      fontFamily:    '"JetBrains Mono", monospace',
      fontSize:      11,
      color:         '#94a3b8',
      ...style,
    }}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Add-node form state
// ─────────────────────────────────────────────────────────────

interface NewNodeForm {
  label:      string
  type:       NodeType
  role:       string
}

interface NewEdgeState {
  active:      boolean
  sourceId:    string | null
  edgeType:    EdgeType
  strength:    1|2|3|4|5
  label:       string
}

// ─────────────────────────────────────────────────────────────
// ManualEditor
// ─────────────────────────────────────────────────────────────

export default function ManualEditor({
  mode         = 'create',
  initialGraph,
  lockedNodeIds = [],
  lockedEdgeIds = [],
  contextLabel,
  onComplete,
  onCancel,
}: ManualEditorProps) {
  const baseGraph = useMemo(
    () => initialGraph ?? emptyGraph(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const { nodes: initRFNodes, edges: initRFEdges } = useMemo(
    () => graphToRF(baseGraph),
    [baseGraph],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<any>(initRFNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>(initRFEdges)

  // Graph-level meta
  const [diagramName, setDiagramName] = useState(baseGraph.meta.repoName)
  const [layout, setLayout]           = useState<LayoutTemplate>(baseGraph.meta.layoutTemplate)

  // UI state
  const [selectedNodeId, setSelectedNodeId]   = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId]   = useState<string | null>(null)
  const [tab, setTab]                         = useState<'add' | 'inspect' | 'settings'>('add')

  // Add node form
  const [newNode, setNewNode] = useState<NewNodeForm>({
    label: '', type: 'module', role: '',
  })

  // Edge drawing mode
  const [edgeState, setEdgeState] = useState<NewEdgeState>({
    active: false, sourceId: null,
    edgeType: 'engineering', strength: 3, label: '',
  })

  const reactFlowRef = useRef<HTMLDivElement>(null)

  // ── Selected node data ──
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )
  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId],
  )
  const lockedNodeSet = useMemo(() => new Set(lockedNodeIds), [lockedNodeIds])
  const lockedEdgeSet = useMemo(() => new Set(lockedEdgeIds), [lockedEdgeIds])

  const highlightedEdges = useMemo(() => edges.map((e) => {
    if (!selectedNodeId) return e
    if (e.source !== selectedNodeId && e.target !== selectedNodeId) return e
    return { ...e, data: { ...e.data, highlighted: true } }
  }) as RFEdge<RFEdgeData>[], [edges, selectedNodeId])
  const selectedNodeLocked = selectedNodeId ? lockedNodeSet.has(selectedNodeId) : false
  const selectedEdgeLocked = selectedEdgeId ? lockedEdgeSet.has(selectedEdgeId) : false

  // ── Node click handler ──
  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    if (edgeState.active) {
      // In edge-drawing mode: first click = source, second click = target
      if (!edgeState.sourceId) {
        setEdgeState((s) => ({ ...s, sourceId: node.id }))
      } else if (edgeState.sourceId !== node.id) {
        const id = makeEdgeId(edgeState.sourceId, node.id)
        const newEdge: RFEdge<RFEdgeData> = {
          id,
          source: edgeState.sourceId,
          target: node.id,
          type:   'repoEdge',
          label:  edgeState.label || undefined,
          data: {
            edgeType:   edgeState.edgeType,
            confidence: 'high',
            strength:   edgeState.strength,
          },
        }
        setEdges((es) => [...es, newEdge])
        // Stay in edge mode, reset source for next edge
        setEdgeState((s) => ({ ...s, sourceId: null, label: '' }))
      }
      return
    }
    setSelectedNodeId(node.id)
    setSelectedEdgeId(null)
    setTab('inspect')
  }, [edgeState, setEdges])

  const onEdgeClick: EdgeMouseHandler = useCallback((_, edge) => {
    if (edgeState.active) return
    setSelectedEdgeId(edge.id)
    setSelectedNodeId(null)
    setTab('inspect')
  }, [edgeState.active])

  // ── Add node ──
  function handleAddNode() {
    if (!newNode.label.trim()) return
    const id    = makeNodeId(newNode.type, newNode.label)
    const depth = NODE_TYPES_LIST.find((t) => t.type === newNode.type)?.depth ?? 1
    const count = nodes.length
    const col   = Math.max(1, Math.ceil(Math.sqrt(count + 1)))

    const rfNode: RFNode<RFNodeData> = {
      id,
      type:     'repoNode',
      position: {
        x: (count % col) * 280 + Math.random() * 40 - 20,
        y: Math.floor(count / col) * 160 + Math.random() * 40 - 20,
      },
      data: {
        label:        newNode.label.trim(),
        nodeType:     newNode.type,
        detectedRole: newNode.role.trim(),
        patterns:     [],
        fileCount:    0,
        files:        [],
        depth,
      },
    }
    setNodes((ns) => [...ns, rfNode])
    setNewNode((f) => ({ ...f, label: '' }))
    setSelectedNodeId(id)
    setTab('inspect')
  }

  // ── Delete selected ──
  function handleDeleteSelected() {
    if (selectedNodeId) {
      setNodes((ns) => ns.filter((n) => n.id !== selectedNodeId))
      setEdges((es) => es.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId))
      setSelectedNodeId(null)
    }
    if (selectedEdgeId) {
      setEdges((es) => es.filter((e) => e.id !== selectedEdgeId))
      setSelectedEdgeId(null)
    }
  }

  // ── Update selected node inline ──
  function updateSelectedNode(patch: Partial<RFNodeData>) {
    if (!selectedNodeId) return
    if (lockedNodeSet.has(selectedNodeId)) return
    setNodes((ns) => ns.map((n) =>
      n.id === selectedNodeId ? { ...n, data: { ...n.data, ...patch } } : n
    ))
  }

  // ── Update selected edge inline ──
  function updateSelectedEdge(patch: Partial<RFEdgeData & { label?: string }>) {
    if (!selectedEdgeId) return
    if (lockedEdgeSet.has(selectedEdgeId)) return
    const { label, ...dataPatch } = patch
    setEdges((es) => es.map((e) => {
      if (e.id !== selectedEdgeId) return e
      return {
        ...e,
        label:  label !== undefined ? label : e.label,
        data:   { ...(e.data ?? {}), ...dataPatch } as RFEdgeData,
      }
    }))
  }

  // ── Connect via React Flow's built-in connector ──
  const onConnect = useCallback((params: Connection) => {
    setEdges((es) => addEdge({
      ...params,
      type: 'repoEdge',
      data: {
        edgeType:   edgeState.edgeType,
        confidence: 'high',
        strength:   edgeState.strength,
      } satisfies RFEdgeData,
    }, es))
  }, [setEdges, edgeState.edgeType, edgeState.strength])

  // ── Keyboard: Delete key removes selected ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
          !(e.target instanceof HTMLInputElement) &&
          !(e.target instanceof HTMLTextAreaElement)) {
        handleDeleteSelected()
      }
      if (e.key === 'Escape') {
        setEdgeState((s) => ({ ...s, active: false, sourceId: null }))
        setSelectedNodeId(null)
        setSelectedEdgeId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── Done: build RepoGraph and call onComplete ──
  function handleDone() {
    const graph = rfToGraph(nodes, edges, {
      repoUrl:           `manual://${diagramName.toLowerCase().replace(/\s+/g, '-')}`,
      repoName:          diagramName,
      analysisVersion:   'manual',
      analyzedAt:        new Date().toISOString(),
      detectedPattern:   'unknown',
      layoutTemplate:    layout,
      patternConfidence: 0,
    })
    onComplete(graph)
  }

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────

  const isEdgeMode  = edgeState.active
  const hasSelected = selectedNodeId !== null || selectedEdgeId !== null

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: '#0b0f1a', fontFamily: '"Inter", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif' }}>

      {/* ── Left sidebar ── */}
      <div style={{
        width: 240, flexShrink: 0,
        background: '#080e1a', borderRight: '1px solid #1e293b',
        display: 'flex', flexDirection: 'column',
        padding: '16px 14px', gap: 16, overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, color: '#3b82f6', fontWeight: 700, letterSpacing: '0.08em' }}>
            {'{'}<span style={{ color: '#a78bfa' }}>repo</span>map{'}'}
          </div>
          <div style={{ fontSize: 9, color: mode === 'edit' ? '#a78bfa' : '#475569', background: mode === 'edit' ? 'rgba(167,139,250,0.1)' : 'rgba(71,85,105,0.1)', border: `1px solid ${mode === 'edit' ? 'rgba(167,139,250,0.3)' : '#1e293b'}`, borderRadius: 4, padding: '2px 6px' }}>
            {mode === 'edit' ? '✎ edit mode' : '✦ manual'}
          </div>
        </div>

        {/* Diagram name */}
        <div>
          <div style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>Diagram name</div>
          <input
            value={diagramName}
            onChange={(e) => setDiagramName(e.target.value)}
            style={inputStyle}
            placeholder="My architecture"
          />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e293b' }}>
          {(['add', 'inspect', 'settings'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, background: 'none', border: 'none',
                borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
                padding: '7px 2px', fontSize: 9, cursor: 'pointer',
                color: tab === t ? '#93c5fd' : '#475569',
                fontFamily: 'inherit', letterSpacing: '0.04em',
              }}
            >
              {t === 'add' ? '＋ add' : t === 'inspect' ? '◎ node' : '⚙ settings'}
            </button>
          ))}
        </div>

        {/* ── Add tab ── */}
        {tab === 'add' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <SectionTitle>Node type</SectionTitle>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {NODE_TYPES_LIST.map(({ type, label, color }) => (
                  <button
                    key={type}
                    onClick={() => setNewNode((f) => ({ ...f, type }))}
                    style={{
                      background:   newNode.type === type ? `rgba(${hexToRgb(color)},0.15)` : 'transparent',
                      border:       `1px solid ${newNode.type === type ? color : '#1e293b'}`,
                      borderRadius: 5,
                      color:        newNode.type === type ? color : '#475569',
                      fontSize:     10,
                      padding:      '5px 9px',
                      cursor:       'pointer',
                      fontFamily:   'inherit',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <SectionTitle>Label</SectionTitle>
              <input
                autoFocus
                value={newNode.label}
                onChange={(e) => setNewNode((f) => ({ ...f, label: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && handleAddNode()}
                style={inputStyle}
                placeholder={`e.g. "Auth module"`}
              />
            </div>

            <div>
              <SectionTitle>Role (optional)</SectionTitle>
              <input
                value={newNode.role}
                onChange={(e) => setNewNode((f) => ({ ...f, role: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && handleAddNode()}
                style={inputStyle}
                placeholder={`e.g. "authentication"`}
              />
            </div>

            <button
              onClick={handleAddNode}
              disabled={!newNode.label.trim()}
              style={{
                ...actionBtnStyle,
                opacity: newNode.label.trim() ? 1 : 0.4,
                cursor:  newNode.label.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              ＋ Add {newNode.type}
            </button>

            {/* Edge drawing mode */}
            <div style={{ borderTop: '1px solid #1e293b', paddingTop: 12, marginTop: 4 }}>
              <SectionTitle>Connect nodes</SectionTitle>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {EDGE_TYPES_LIST.map(({ type, label, color }) => (
                  <button
                    key={type}
                    onClick={() => setEdgeState((s) => ({ ...s, edgeType: type }))}
                    style={{
                      display:      'flex',
                      alignItems:   'center',
                      gap:          8,
                      background:   edgeState.edgeType === type ? `rgba(${hexToRgb(color)},0.1)` : 'transparent',
                      border:       `1px solid ${edgeState.edgeType === type ? color : '#1e293b'}`,
                      borderRadius: 5,
                      padding:      '6px 9px',
                      cursor:       'pointer',
                      color:        edgeState.edgeType === type ? color : '#475569',
                      fontSize:     10,
                      fontFamily:   'inherit',
                    }}
                  >
                    <svg width={18} height={8}><line x1={0} y1={4} x2={18} y2={4} stroke={color} strokeWidth={1.5} strokeDasharray={type === 'architecture' ? '5,3' : undefined} /></svg>
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: '#334155', marginBottom: 4 }}>Strength: {edgeState.strength}</div>
                <input
                  type="range" min={1} max={5} step={1}
                  value={edgeState.strength}
                  onChange={(e) => setEdgeState((s) => ({ ...s, strength: Number(e.target.value) as 1|2|3|4|5 }))}
                  style={{ width: '100%', accentColor: '#3b82f6' }}
                />
              </div>

              <button
                onClick={() => setEdgeState((s) => ({
                  ...s,
                  active:   !s.active,
                  sourceId: null,
                }))}
                style={{
                  ...actionBtnStyle,
                  background:  isEdgeMode ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.08)',
                  borderColor: isEdgeMode ? '#3b82f6' : '#1e293b',
                  color:       isEdgeMode ? '#93c5fd' : '#475569',
                  width:       '100%',
                }}
              >
                {isEdgeMode
                  ? edgeState.sourceId
                    ? `▸ click target node…`
                    : `▸ click source node…`
                  : '⟵ draw connection'}
              </button>
              {isEdgeMode && (
                <div style={{ fontSize: 9, color: '#334155', marginTop: 5, lineHeight: 1.5 }}>
                  Click two nodes to connect them. Press Esc to exit.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Inspect tab ── */}
        {tab === 'inspect' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!hasSelected ? (
              <div style={{ fontSize: 11, color: '#334155' }}>Click a node or edge to inspect.</div>
            ) : selectedNode ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedNode.data.label as string}
                </div>
                {selectedNodeLocked && (
                  <div style={{ background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.14)', borderRadius: 6, color: '#64748b', fontSize: 10, lineHeight: 1.5, padding: '6px 8px' }}>
                    This node belongs to the base graph or a parent branch. You can connect to it, but edits are saved only for this branch's own nodes.
                  </div>
                )}

                <div>
                  <SectionTitle>Label</SectionTitle>
                  <input
                    value={(selectedNode.data.label as string) ?? ''}
                    onChange={(e) => updateSelectedNode({ label: e.target.value })}
                    style={inputStyle}
                    disabled={selectedNodeLocked}
                  />
                </div>

                <div>
                  <SectionTitle>Type</SectionTitle>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {NODE_TYPES_LIST.map(({ type, label, color, depth }) => (
                      <button
                        key={type}
                        onClick={() => updateSelectedNode({ nodeType: type, depth })}
                        disabled={selectedNodeLocked}
                        style={{
                          background:   selectedNode.data.nodeType === type ? `rgba(${hexToRgb(color)},0.15)` : 'transparent',
                          border:       `1px solid ${selectedNode.data.nodeType === type ? color : '#1e293b'}`,
                          borderRadius: 5,
                          color:        selectedNode.data.nodeType === type ? color : '#475569',
                          fontSize:     10,
                          padding:      '4px 8px',
                          cursor:       'pointer',
                          fontFamily:   'inherit',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <SectionTitle>Role</SectionTitle>
                  <input
                    value={(selectedNode.data.detectedRole as string) ?? ''}
                    onChange={(e) => updateSelectedNode({ detectedRole: e.target.value })}
                    style={inputStyle}
                    disabled={selectedNodeLocked}
                    placeholder="e.g. authentication"
                  />
                </div>

                <div>
                  <SectionTitle>Status tag</SectionTitle>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {([undefined, 'stable', 'legacy', 'in_refactor', 'deprecated'] as const).map((tag) => (
                      <button
                        key={tag ?? 'none'}
                        onClick={() => updateSelectedNode({ statusTag: tag })}
                        disabled={selectedNodeLocked}
                        style={{
                          background:   selectedNode.data.statusTag === tag ? 'rgba(99,102,241,0.15)' : 'transparent',
                          border:       `1px solid ${selectedNode.data.statusTag === tag ? '#6366f1' : '#1e293b'}`,
                          borderRadius: 5,
                          color:        selectedNode.data.statusTag === tag ? '#a5b4fc' : '#475569',
                          fontSize:     9,
                          padding:      '3px 7px',
                          cursor:       'pointer',
                          fontFamily:   'inherit',
                        }}
                      >
                        {tag ?? 'none'}
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={handleDeleteSelected} disabled={selectedNodeLocked} style={{ ...deleteBtnStyle, opacity: selectedNodeLocked ? 0.35 : 1, cursor: selectedNodeLocked ? 'not-allowed' : 'pointer' }}>
                  ✕ Delete node
                </button>
              </>
            ) : selectedEdge ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
                  Edge
                </div>
                <div style={{ fontSize: 10, color: '#475569' }}>
                  {selectedEdge.source} → {selectedEdge.target}
                </div>

                <div>
                  <SectionTitle>Label</SectionTitle>
                  <input
                    value={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''}
                    onChange={(e) => updateSelectedEdge({ label: e.target.value })}
                    style={inputStyle}
                    placeholder="e.g. calls, implements…"
                  />
                </div>

                <div>
                  <SectionTitle>Type</SectionTitle>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {EDGE_TYPES_LIST.map(({ type, label, color }) => (
                      <button
                        key={type}
                        onClick={() => updateSelectedEdge({ edgeType: type })}
                        style={{
                          display:      'flex',
                          alignItems:   'center',
                          gap:          8,
                          background:   selectedEdge.data?.edgeType === type ? `rgba(${hexToRgb(color)},0.1)` : 'transparent',
                          border:       `1px solid ${selectedEdge.data?.edgeType === type ? color : '#1e293b'}`,
                          borderRadius: 5,
                          padding:      '5px 9px',
                          cursor:       'pointer',
                          color:        selectedEdge.data?.edgeType === type ? color : '#475569',
                          fontSize:     10,
                          fontFamily:   'inherit',
                        }}
                      >
                        <svg width={18} height={8}><line x1={0} y1={4} x2={18} y2={4} stroke={color} strokeWidth={1.5} strokeDasharray={type === 'architecture' ? '5,3' : undefined} /></svg>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <SectionTitle>Strength: {selectedEdge.data?.strength ?? 3}</SectionTitle>
                  <input
                    type="range" min={1} max={5} step={1}
                    value={selectedEdge.data?.strength ?? 3}
                    onChange={(e) => updateSelectedEdge({ strength: Number(e.target.value) as 1|2|3|4|5 })}
                    style={{ width: '100%', accentColor: '#3b82f6' }}
                  />
                </div>

                <button onClick={handleDeleteSelected} style={deleteBtnStyle}>
                  ✕ Delete edge
                </button>
              </>
            ) : null}
          </div>
        )}

        {/* ── Settings tab ── */}
        {tab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <SectionTitle>Layout</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {LAYOUT_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setLayout(value)}
                    style={{
                      background:   layout === value ? 'rgba(99,102,241,0.15)' : 'transparent',
                      border:       `1px solid ${layout === value ? '#6366f1' : '#1e293b'}`,
                      borderRadius: 5,
                      color:        layout === value ? '#a5b4fc' : '#475569',
                      fontSize:     10,
                      padding:      '7px 10px',
                      cursor:       'pointer',
                      fontFamily:   'inherit',
                      textAlign:    'left',
                    }}
                  >
                    {layout === value ? '▸ ' : '  '}{label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid #1e293b', paddingTop: 12 }}>
              <SectionTitle>Stats</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <Stat label="Nodes"       value={nodes.length} />
                <Stat label="Connections" value={edges.length} />
                <Stat label="Layers"      value={nodes.filter((n) => n.data.nodeType === 'layer').length} />
                <Stat label="Modules"     value={nodes.filter((n) => n.data.nodeType === 'module').length} />
              </div>
            </div>
          </div>
        )}

        {/* ── Bottom actions ── */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {nodes.length === 0 && (
            <div style={{ fontSize: 10, color: '#1e3a5f', textAlign: 'center', padding: '8px 0' }}>
              Add at least one node to save
            </div>
          )}
          <button
            onClick={handleDone}
            disabled={nodes.length === 0}
            style={{
              ...actionBtnStyle,
              background:  nodes.length > 0 ? '#1d4ed8' : '#0f1f35',
              borderColor: nodes.length > 0 ? '#2563eb' : '#1e293b',
              color:       nodes.length > 0 ? '#eff6ff' : '#1e3a5f',
              cursor:      nodes.length > 0 ? 'pointer' : 'not-allowed',
              fontWeight:  600,
              fontSize:    12,
              padding:     '11px 0',
            }}
          >
            {mode === 'edit' ? '✓ Save changes' : '✓ Create diagram'}
          </button>

          {onCancel && (
            <button onClick={onCancel} style={{ ...actionBtnStyle, background: 'transparent', color: '#334155', borderColor: '#1e293b' }}>
              ✕ Cancel
            </button>
          )}
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={reactFlowRef}
        style={{
          flex:     1,
          position: 'relative',
          cursor:   isEdgeMode ? 'crosshair' : 'default',
        }}
      >
        {/* Edge mode overlay hint */}
        {isEdgeMode && (
          <div style={{
            position:      'absolute',
            top:           12,
            left:          '50%',
            transform:     'translateX(-50%)',
            zIndex:        20,
            background:    'rgba(15,23,42,0.92)',
            border:        '1px solid #3b82f6',
            borderRadius:  8,
            padding:       '7px 16px',
            fontSize:      11,
            color:         '#93c5fd',
            backdropFilter: 'blur(6px)',
            pointerEvents: 'none',
          }}>
            {edgeState.sourceId
              ? `▸ Now click the target node`
              : `▸ Click the source node`}
            {' · '}
            <span style={{ color: '#475569' }}>Esc to cancel</span>
          </div>
        )}

        {/* Empty state hint */}
        {nodes.length === 0 && (
          <div style={{
            position:      'absolute',
            top:           '50%',
            left:          '50%',
            transform:     'translate(-50%, -50%)',
            zIndex:        5,
            textAlign:     'center',
            pointerEvents: 'none',
            color:         '#1e293b',
            fontFamily:    '"JetBrains Mono", monospace',
          }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>⬡</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Empty canvas</div>
            <div style={{ fontSize: 11 }}>Add your first node from the sidebar →</div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={highlightedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          nodeTypes={nodeTypes as any}
          edgeTypes={edgeTypes as any}
              fitView
              minZoom={0.25}
              maxZoom={2}
              onlyRenderVisibleElements
              fitViewOptions={{ padding: 0.3 }}
          deleteKeyCode={null}    // we handle Delete ourselves
          style={{ background: '#0b0f1a' }}
          defaultEdgeOptions={{
            type: 'repoEdge',
            data: { edgeType: 'engineering', confidence: 'high', strength: 3 } satisfies RFEdgeData,
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#1e2a3a" />
          <Controls style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }} />
          <MiniMap
            style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
            nodeColor={(n) => {
              const t = (n.data as RFNodeData).nodeType
              return t === 'layer' ? '#60a5fa' : t === 'module' ? '#a78bfa' : t === 'file' ? '#34d399' : '#fb923c'
            }}
            maskColor="rgba(0,0,0,0.6)"
          />
        </ReactFlow>

        {/* Keyboard hint */}
        <div style={{
          position: 'absolute', bottom: 14, right: 14,
          fontSize: 9, color: '#1e3a5f',
          fontFamily: '"JetBrains Mono", monospace',
          lineHeight: 1.8,
          textAlign: 'right',
          pointerEvents: 'none',
        }}>
          Delete / Backspace → remove selected<br />
          Drag node handles → connect nodes<br />
          Esc → deselect / exit edge mode
        </div>
      </div>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Mini helpers
// ─────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
      <span style={{ color: '#334155' }}>{label}</span>
      <span style={{ color: '#60a5fa', fontWeight: 700 }}>{value}</span>
    </div>
  )
}

/** Convert hex color #rrggbb to "r,g,b" for rgba() */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width:       '100%',
  background:  '#0f172a',
  border:      '1px solid #1e293b',
  borderRadius: 6,
  padding:     '7px 10px',
  color:       '#e2e8f0',
  fontSize:    12,
  fontFamily:  'inherit',
  outline:     'none',
  boxSizing:   'border-box',
}

const actionBtnStyle: React.CSSProperties = {
  width:        '100%',
  background:   'rgba(59,130,246,0.08)',
  border:       '1px solid #1e293b',
  borderRadius: 7,
  padding:      '9px 0',
  color:        '#60a5fa',
  fontSize:     12,
  fontFamily:   'inherit',
  cursor:       'pointer',
  textAlign:    'center',
}

const deleteBtnStyle: React.CSSProperties = {
  ...actionBtnStyle,
  background:  'rgba(239,68,68,0.06)',
  borderColor: 'rgba(239,68,68,0.2)',
  color:       '#f87171',
}
