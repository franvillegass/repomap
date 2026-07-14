'use client'

import { useMemo, useCallback, useState, useEffect, memo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type NodeMouseHandler,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { RepoGraph } from '../../lib/pipeline/schemas/graph'
import { buildReactFlowGraph, buildReactFlowGraphFromResolved, type RFEdgeData } from './graphLayout'
import { nodeTypes, edgeTypes } from './GraphNodes'
import {
  OnionView, LayerStackView, ClusterView, PipelineView,
  ViewSwitcher, recommendedView,
  type ViewType,
} from './AlternativeViews'
import { BranchPanel } from '../../branches/BranchPanel'
import { useBranches }  from '../../branches/UseBranches'
import type { ResolvedGraph } from '../../branches/types'

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

interface GraphRendererProps {
  graph: RepoGraph
  onOverlayChange?: (patch: Partial<RepoGraph['overlay']>) => void
}

type StatusTag   = 'none' | 'legacy' | 'in_refactor' | 'stable' | 'deprecated'
type SidebarTab  = 'filters' | 'node' | 'export' | 'branches'

interface NodeAnnotation {
  customLabel?: string
  annotation?:  string
  statusTag?:   StatusTag
}

interface Filters {
  showEngineering:  boolean
  showArchitecture: boolean
  showBoth:         boolean
  showUncertain:    boolean
  minStrength:      number
}

const DEFAULT_FILTERS: Filters = {
  showEngineering:  true,
  showArchitecture: true,
  showBoth:         true,
  showUncertain:    true,
  minStrength:      1,
}

// ------------------------------------------------------------
// GraphRenderer — must be rendered inside <BranchProvider>
// ------------------------------------------------------------

export default function GraphRenderer({ graph, onOverlayChange }: GraphRendererProps) {
  const {
    isOnBranch,
    resolvedGraph,
    activeBranchId,
    branches,
    replaceActiveBranchGraph,
  } = useBranches()

  const [filters,     setFilters]     = useState<Filters>(DEFAULT_FILTERS)
  const [annotations, setAnnotations] = useState<Record<string, NodeAnnotation>>({})
  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [sidebarTab,  setSidebarTab]  = useState<SidebarTab>('filters')
  const [viewType,    setViewType]    = useState<ViewType>(
    () => recommendedView(graph.meta.layoutTemplate)
  )
  const [newNodeForm, setNewNodeForm] = useState({ type: 'module' as string, label: '' })
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null)

  // ── Git branch diff state ──
  const [diffBranch, setDiffBranch] = useState<string | null>(null)
  const [diffFiles, setDiffFiles] = useState<Array<{ path: string; status: string }> | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  const handleSelectGitBranch = useCallback(async (branchName: string | null) => {
    setDiffBranch(branchName)
    if (!branchName) { setDiffFiles(null); return }

    setDiffLoading(true)
    try {
      const res = await fetch(`/api/diff?to=${encodeURIComponent(branchName)}`)
      if (!res.ok) { setDiffFiles(null); return }
      const data = await res.json()
      setDiffFiles(data.files ?? [])
    } catch {
      setDiffFiles(null)
    } finally {
      setDiffLoading(false)
    }
  }, [])

  // ── Graph source: resolved branch graph or base graph ──
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (isOnBranch && resolvedGraph) {
      return buildReactFlowGraphFromResolved(resolvedGraph, graph.meta.layoutTemplate)
    }
    return buildReactFlowGraph(graph)
  }, [isOnBranch, resolvedGraph, graph])

  // key forces React Flow to re-mount when branch changes (re-reads initialNodes/Edges)
  const flowKey      = activeBranchId ?? '__base__'
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [flowKey, initialNodes, initialEdges, setNodes, setEdges])

  // Escape cancels connection mode
  useEffect(() => {
    if (!connectingFromId) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setConnectingFromId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [connectingFromId])

  // Pre-compute edge data arrays for faster filtering
  const edgeDataArray = useMemo(() => 
    edges.map(e => ({
      edge: e,
      type: (e.data as { edgeType?: string; confidence?: string; strength?: number } | undefined)?.edgeType ?? 'engineering',
      conf: (e.data as { edgeType?: string; confidence?: string; strength?: number } | undefined)?.confidence ?? 'high',
      str:  (e.data as { edgeType?: string; confidence?: string; strength?: number } | undefined)?.strength ?? 1,
    })),
  [edges])

  const visibleEdges = useMemo(() => {
    return edgeDataArray
      .filter(({ type, conf, str }) => {
        if (!filters.showEngineering  && type === 'engineering')   return false
        if (!filters.showArchitecture && type === 'architecture')  return false
        if (!filters.showBoth         && type === 'both')          return false
        if (!filters.showUncertain    && conf === 'uncertain')     return false
        if (str < filters.minStrength)                             return false
        return true
      })
      .map(({ edge }) => edge)
  }, [edgeDataArray, filters])

  const highlightedEdges = useMemo(() => visibleEdges.map((e) => {
    if (!selectedId) return e
    if (e.source !== selectedId && e.target !== selectedId) return e
    return { ...e, data: { ...e.data, highlighted: true } }
  }) as Edge<RFEdgeData>[], [visibleEdges, selectedId])

  // Build a set of file paths that changed in the diff for fast lookup
  const diffFileSet = useMemo(() => {
    if (!diffFiles) return null
    const map = new Map<string, string>()
    for (const f of diffFiles) map.set(f.path, f.status)
    return map
  }, [diffFiles])

  const annotatedNodes = useMemo(() => nodes.map((n) => {
    const ann = annotations[n.id]

    // Check if this node's files match any diff entry
    let diffStatus: string | undefined
    if (diffFileSet && n.data?.files) {
      const filePaths: string[] = n.data.files
      for (const fp of filePaths) {
        const status = diffFileSet.get(fp)
        if (status) { diffStatus = status; break }
      }
    }

    return {
      ...n,
      data: {
        ...n.data,
        label:          ann?.customLabel ?? n.data.label,
        statusTag:      ann?.statusTag !== 'none' ? ann?.statusTag : undefined,
        diffStatus,    // 'added' | 'modified' | 'deleted'
      },
    }
  }), [nodes, annotations, diffFileSet])

  // Build node lookup Map for O(1) access
  const nodeMap = useMemo(() => {
    const map = new Map()
    for (const n of nodes) map.set(n.id, n)
    return map
  }, [nodes])

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, type: 'repoEdge' }, eds)),
    [setEdges],
  )

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    if (connectingFromId && connectingFromId !== node.id) {
      if (!isOnBranch || !resolvedGraph || !activeBranch || !graph) return
      const current = resolvedToRepoGraph(graph, resolvedGraph, activeBranch.name)
      const edgeId = `edge__manual__${connectingFromId}__${node.id}__${Date.now()}`
      current.edges.push({
        id: edgeId,
        source: connectingFromId,
        target: node.id,
        edgeType: 'engineering',
        strength: 3,
        confidence: 'high',
        label: '',
      })
      replaceActiveBranchGraph(current)
      setConnectingFromId(null)
      return
    }
    setSelectedId(node.id)
    setSidebarTab('node')
  }, [connectingFromId, isOnBranch, resolvedGraph, activeBranch, graph, replaceActiveBranchGraph])

  function handleDeleteSelectedNode() {
    if (!selectedId || !isOnBranch || !resolvedGraph || !activeBranch || !graph) return
    const current = resolvedToRepoGraph(graph, resolvedGraph, activeBranch.name)
    current.nodes = current.nodes.filter(n => n.id !== selectedId)
    current.edges = current.edges.filter(e => e.source !== selectedId && e.target !== selectedId)
    replaceActiveBranchGraph(current)
    setSelectedId(null)
  }

  function handleAddNode() {
    if (!newNodeForm.label.trim() || !isOnBranch || !resolvedGraph || !activeBranch || !graph) return
    const slug = newNodeForm.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'node'
    const newNode = {
      id: `manual__${newNodeForm.type}__${slug}__${Date.now()}`,
      label: newNodeForm.label.trim(),
      type: newNodeForm.type as 'layer' | 'module' | 'file',
      parentId: null,
      depth: newNodeForm.type === 'layer' ? 0 : newNodeForm.type === 'module' ? 1 : 2,
      files: [],
      detectedRole: '',
      patterns: [],
      metadata: {},
    }
    const current = resolvedToRepoGraph(graph, resolvedGraph, activeBranch.name)
    replaceActiveBranchGraph({ ...current, nodes: [...current.nodes, newNode] })
    setNewNodeForm((f) => ({ ...f, label: '' }))
    setSelectedId(null)
  }

  function handleDeleteEdge(edgeId: string) {
    if (!isOnBranch || !resolvedGraph || !activeBranch || !graph) return
    const current = resolvedToRepoGraph(graph, resolvedGraph, activeBranch.name)
    current.edges = current.edges.filter(e => e.id !== edgeId)
    replaceActiveBranchGraph(current)
  }

  // O(1) node lookup instead of O(n) array.find
  const connectedEdges = useMemo(() => {
    if (!selectedId) return []
    return edges
      .filter(e => e.source === selectedId || e.target === selectedId)
      .map(e => {
        const otherId = e.source === selectedId ? e.target : e.source
        const otherNode = nodeMap.get(otherId)
        return { edgeId: e.id, otherId, otherLabel: (otherNode?.data as any)?.label ?? otherId, otherType: (otherNode?.data as any)?.nodeType ?? '?' }
      })
  }, [edges, nodeMap, selectedId])

  const selectedNode = useMemo(
    () => nodeMap.get(selectedId ?? '') ?? null,
    [nodeMap, selectedId],
  )
  const selectedAnn = selectedId ? (annotations[selectedId] ?? {}) : {}

  function updateAnnotation(id: string, patch: Partial<NodeAnnotation>) {
    setAnnotations((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  function handleExportSVG() {
    const svg = document.querySelector('.react-flow__renderer svg') as SVGElement | null
    if (!svg) return
    download(new Blob([svg.outerHTML], { type: 'image/svg+xml' }), `${graph.meta.repoName.replace('/', '_')}.svg`)
  }

  function handleExportPNG() {
    const svg = document.querySelector('.react-flow__renderer svg') as SVGElement | null
    if (!svg) return
    const svgData = new XMLSerializer().serializeToString(svg)
    const canvas  = document.createElement('canvas')
    const bbox    = svg.getBoundingClientRect()
    canvas.width  = bbox.width  * 2
    canvas.height = bbox.height * 2
    const ctx = canvas.getContext('2d')!
    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = '#0b0f1a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((b) => b && download(b, `${graph.meta.repoName.replace('/', '_')}.png`))
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
  }

  // Single-pass edge counting
  const edgeCounts = useMemo(() => {
    const c = { engineering: 0, architecture: 0, both: 0, uncertain: 0 }
    for (const e of edges) {
      const d    = e.data as { edgeType?: string; confidence?: string } | undefined
      const type = d?.edgeType   ?? 'engineering'
      const conf = d?.confidence ?? 'high'
      if (type === 'engineering')  c.engineering++
      if (type === 'architecture') c.architecture++
      if (type === 'both')         c.both++
      if (conf === 'uncertain')    c.uncertain++
    }
    return c
  }, [edges])

  // Single-pass node counting
  const nodeCounts = useMemo(() => {
    const c = { layer: 0, module: 0, file: 0, component: 0 }
    for (const n of nodes) {
      const type = (n.data as { nodeType?: keyof typeof c }).nodeType
      if (type && type in c) c[type]++
    }
    return c
  }, [nodes])

  // ── Render ──
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: '#0b0f1a', fontFamily: '"Inter", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif' }}>

      {/* ── Sidebar ── */}
      <div style={sidebarStyle}>

        <div style={{ fontSize: 11, color: '#3b82f6', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 14 }}>
          {'{'}<span style={{ color: '#a78bfa' }}>repo</span>map{'}'}
        </div>

        {/* Tab bar — 4 tabs now */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', marginBottom: 16 }}>
          {(['filters', 'node', 'export', 'branches'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSidebarTab(tab)}
              style={{
                ...tabBtnStyle,
                color:        sidebarTab === tab ? '#93c5fd' : '#475569',
                borderBottom: sidebarTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
                position:     'relative',
              }}
            >
              {tab === 'filters' ? '⚙' : tab === 'node' ? '◎' : tab === 'export' ? '↗' : '⑂'}{' '}{tab}
              {/* Active branch dot indicator */}
              {tab === 'branches' && isOnBranch && (
                <span style={{
                  position: 'absolute', top: 4, right: 2,
                  width: 5, height: 5, borderRadius: '50%',
                  background: activeBranch?.color ?? '#60a5fa',
                  display: 'block',
                }} />
              )}
            </button>
          ))}
        </div>

        {/* ── Filters ── */}
        {sidebarTab === 'filters' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Section title="Connection type" subtitle="Toggle edge layers">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ToggleRow label="Runtime calls"    color="#60a5fa" count={edgeCounts.engineering}  value={filters.showEngineering}  onChange={(v) => setFilters((f) => ({ ...f, showEngineering:  v }))} />
                <ToggleRow label="Design structure" color="#c084fc" count={edgeCounts.architecture} value={filters.showArchitecture} onChange={(v) => setFilters((f) => ({ ...f, showArchitecture: v }))} />
                <ToggleRow label="Mixed"            color="#f472b6" count={edgeCounts.both}         value={filters.showBoth}         onChange={(v) => setFilters((f) => ({ ...f, showBoth:         v }))} />
                <ToggleRow label="Uncertain"        color="#64748b" count={edgeCounts.uncertain}    value={filters.showUncertain}    onChange={(v) => setFilters((f) => ({ ...f, showUncertain:    v }))} />
              </div>
            </Section>
            <Section title="Min strength">
              <input
                type="range" min={1} max={5} step={1}
                value={filters.minStrength}
                onChange={(e) => setFilters((f) => ({ ...f, minStrength: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: '#3b82f6' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#334155', marginTop: 2 }}>
                {[1,2,3,4,5].map((v) => <span key={v} style={{ color: filters.minStrength === v ? '#93c5fd' : undefined }}>{v}</span>)}
              </div>
            </Section>
            <Section title="View">
              <ViewSwitcher current={viewType} recommended={recommendedView(graph.meta.layoutTemplate)} onChange={setViewType} />
            </Section>

            {isOnBranch && (
              <Section title="Add node">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['layer', 'module', 'file'].map((type) => (
                      <button
                        key={type}
                        onClick={() => setNewNodeForm((f) => ({ ...f, type }))}
                        style={{
                          flex: 1, fontSize: 10, fontFamily: 'inherit',
                          background:   newNodeForm.type === type ? 'rgba(59,130,246,0.15)' : 'transparent',
                          border:       `1px solid ${newNodeForm.type === type ? '#3b82f6' : '#1e293b'}`,
                          borderRadius: 5, color: newNodeForm.type === type ? '#93c5fd' : '#475569',
                          padding: '5px 4px', cursor: 'pointer',
                        }}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      value={newNodeForm.label}
                      onChange={(e) => setNewNodeForm((f) => ({ ...f, label: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddNode()}
                      style={{ flex: 1, ...sidebarInputStyle }}
                      placeholder="Node name…"
                    />
                    <button
                      onClick={handleAddNode}
                      disabled={!newNodeForm.label.trim()}
                      style={{
                        background:   newNodeForm.label.trim() ? 'rgba(59,130,246,0.15)' : 'transparent',
                        border:       `1px solid ${newNodeForm.label.trim() ? '#3b82f6' : '#1e293b'}`,
                        borderRadius: 5, color: newNodeForm.label.trim() ? '#93c5fd' : '#475569',
                        padding: '0 10px', cursor: newNodeForm.label.trim() ? 'pointer' : 'not-allowed',
                        fontFamily: 'inherit', fontSize: 11, whiteSpace: 'nowrap',
                      }}
                    >
                      ➕
                    </button>
                  </div>
                </div>
              </Section>
            )}
          </div>
        )}

        {/* ── Node inspection ── */}
        {sidebarTab === 'node' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!selectedNode ? (
              <div style={{ fontSize: 11, color: '#334155', paddingTop: 8 }}>Click a node to inspect it.</div>
            ) : (
              <>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{selectedNode.data.label as string}</div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{selectedNode.id}</div>
                </div>

                {(selectedNode.data as { isBranchNode?: boolean; branchOrigin?: string }).isBranchNode && (
                  <div style={{ fontSize: 10, color: '#60a5fa', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 6, padding: '6px 10px' }}>
                    ⑂ Added in branch
                  </div>
                )}

                <Section title="Custom label">
                  <input style={sidebarInputStyle} placeholder={selectedNode.data.label as string} value={selectedAnn.customLabel ?? ''} onChange={(e) => updateAnnotation(selectedNode.id, { customLabel: e.target.value || undefined })} />
                </Section>

                <Section title="Annotation">
                  <textarea style={{ ...sidebarInputStyle, resize: 'vertical', minHeight: 60 }} placeholder="Add a note…" value={selectedAnn.annotation ?? ''} onChange={(e) => updateAnnotation(selectedNode.id, { annotation: e.target.value || undefined })} />
                </Section>

                <Section title="Status tag">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(['none', 'stable', 'in_refactor', 'legacy', 'deprecated'] as StatusTag[]).map((tag) => (
                      <button
                        key={tag}
                        onClick={() => updateAnnotation(selectedNode.id, { statusTag: tag })}
                        style={{
                          ...ghostBtn,
                          color:       (selectedAnn.statusTag === tag || (!selectedAnn.statusTag && tag === 'none')) ? '#93c5fd' : '#475569',
                          borderColor: (selectedAnn.statusTag === tag || (!selectedAnn.statusTag && tag === 'none')) ? '#3b82f6' : '#1e293b',
                        }}
                      >
                        {tag === 'none' ? 'none' : tag.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </Section>

                {isOnBranch && (
                  <button
                    onClick={handleDeleteSelectedNode}
                    style={{
                      ...ghostBtn,
                      background:   'rgba(239,68,68,0.1)',
                      borderColor:  '#ef4444',
                      color:        '#f87171',
                      marginTop:    8,
                      width:        '100%',
                      textAlign:    'center',
                    }}
                  >
                    ✕ Delete node
                  </button>
                )}

                {isOnBranch && (
                  <Section title={connectingFromId ? `Connecting ${selectedNode.data.label}…` : "Connections"}>
                    {connectingFromId ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 10, color: '#60a5fa', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 6, padding: '6px 10px' }}>
                          Click the target node in the graph, or press Esc to cancel.
                        </div>
                        <button onClick={() => setConnectingFromId(null)} style={{ ...ghostBtn, width: '100%', textAlign: 'center', fontSize: 10, color: '#94a3b8' }}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setConnectingFromId(selectedNode.id)}
                          style={{ ...ghostBtn, width: '100%', textAlign: 'center', fontSize: 10, color: '#93c5fd', borderColor: '#3b82f6', marginBottom: 8 }}
                        >
                          ⟷ Create connection
                        </button>
                        {connectedEdges.length === 0 ? (
                          <div style={{ fontSize: 10, color: '#334155' }}>No connections yet.</div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {connectedEdges.map((ce) => (
                              <div key={ce.edgeId} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                                <span style={{ color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                  <span style={{ color: '#94a3b8' }}>{ce.otherLabel}</span>
                                  <span style={{ color: '#334155', marginLeft: 4 }}>({ce.otherType})</span>
                                </span>
                                <button
                                  onClick={() => handleDeleteEdge(ce.edgeId)}
                                  title="Delete connection"
                                  style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: '#ef4444', fontSize: 12, padding: '2px 4px',
                                    fontFamily: 'inherit', flexShrink: 0,
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </Section>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Export ── */}
        {sidebarTab === 'export' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Section title="Export graph">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <ExportBtn label="Export SVG" sub="Vector, scalable"    onClick={handleExportSVG} />
                <ExportBtn label="Export PNG" sub="Raster, 2× density"  onClick={handleExportPNG} />
              </div>
            </Section>
            {isOnBranch && activeBranch && (
              <Section title="Branch note">
                <div style={{ fontSize: 10, color: '#60a5fa', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)', borderRadius: 6, padding: '8px 10px' }}>
                  Exporting <strong>{activeBranch.name}</strong> — branch nodes included.
                </div>
              </Section>
            )}
          </div>
        )}

        {/* ── Branches ── */}
        {sidebarTab === 'branches' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: '0 -14px', overflow: 'hidden' }}>
            <BranchPanel
              graph={graph}
              activeGitBranch={diffBranch}
              onSelectGitBranch={handleSelectGitBranch}
            />
          </div>
        )}

      </div>

      {/* ── Canvas ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

        {/* Git branch diff banner */}
        {diffBranch && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
            background: 'rgba(15,23,42,0.92)',
            borderBottom: '2px solid #f87171',
            padding: '5px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
            backdropFilter: 'blur(6px)',
            fontSize: 12, fontFamily: 'inherit',
          }}>
            <span style={{ color: '#f87171', fontWeight: 700 }}>⑂ {diffBranch}</span>
            <span style={{ color: '#9ca3af', fontSize: 11 }}>
              {diffLoading ? 'Loading diff...' : `Showing file diff (${diffFiles?.length ?? 0} files changed)`}
            </span>
            <span style={{
              marginLeft: 'auto', fontSize: 10, color: '#d97706',
              background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.25)',
              borderRadius: 4, padding: '2px 8px',
            }}>
              Diff only — ask agent for full analysis
            </span>
            <button
              onClick={() => handleSelectGitBranch(null)}
              style={{ background: 'none', border: '1px solid #475569', borderRadius: 4, color: '#9ca3af', fontSize: 10, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Branch active banner */}
        {isOnBranch && activeBranch && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
            background: 'rgba(15,23,42,0.92)',
            borderBottom: `2px solid ${activeBranch.color ?? '#60a5fa'}`,
            padding: '5px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
            backdropFilter: 'blur(6px)',
            fontSize: 12, fontFamily: 'inherit',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: activeBranch.color ?? '#60a5fa', flexShrink: 0, display: 'inline-block' }} />
            <span style={{ color: '#60a5fa', fontWeight: 700 }}>⑂ {activeBranch.name}</span>
            {activeBranch.description && (
              <span style={{ color: '#374151', borderLeft: '1px solid #1e293b', paddingLeft: 10 }}>{activeBranch.description}</span>
            )}
            <button
              onClick={() => setSidebarTab('branches')}
              style={{ marginLeft: 'auto', background: 'none', border: '1px solid #1e293b', borderRadius: 4, color: '#475569', fontSize: 10, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              manage
            </button>
          </div>
        )}

        {viewType === 'graph' && (
          <>
            <ReactFlow
              key={flowKey}
              nodes={annotatedNodes}
              edges={highlightedEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes as any}
              edgeTypes={edgeTypes as any}
              fitView
              minZoom={0.25}
              maxZoom={2}
              onlyRenderVisibleElements
              style={{ background: '#0b0f1a', paddingTop: isOnBranch || diffBranch ? 36 : 0 }}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#1e2a3a" />
              <Controls style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }} />
              <MiniMap
                style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                nodeColor={(n) => {
                  const t = (n.data as { nodeType?: string }).nodeType
                  return t === 'layer' ? '#60a5fa' : t === 'module' ? '#a78bfa' : t === 'file' ? '#34d399' : '#fb923c'
                }}
                maskColor="rgba(0,0,0,0.6)"
              />
            </ReactFlow>
            <Legend nodeCounts={nodeCounts} edgeCounts={edgeCounts} />
          </>
        )}

        {viewType !== 'graph' && (
          <div style={{ position: 'absolute', inset: 0, paddingTop: isOnBranch || diffBranch ? 256 : 220, boxSizing: 'border-box' }}>
            {viewType === 'onion'    && <OnionView    graph={graph} onNodeClick={(n) => { setSelectedId(n.id); setSidebarTab('node') }} />}
            {viewType === 'layers'   && <LayerStackView graph={graph} onNodeClick={(n) => { setSelectedId(n.id); setSidebarTab('node') }} />}
            {viewType === 'clusters' && <ClusterView  graph={graph} onNodeClick={(n) => { setSelectedId(n.id); setSidebarTab('node') }} />}
            {viewType === 'pipeline' && <PipelineView graph={graph} onNodeClick={(n) => { setSelectedId(n.id); setSidebarTab('node') }} />}
          </div>
        )}


      </div>



    </div>
  )
}

// ------------------------------------------------------------
// Small components (memoized)
// ------------------------------------------------------------

const Section = memo(function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ animation: 'fadeUp 0.25s ease both' }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 10, color: '#475569', marginBottom: 8 }}>{subtitle}</div>}
      {children}
    </div>
  )
})

const ToggleRow = memo(function ToggleRow({ label, color, count, value, onChange }: {
  label: string; color: string; count: number; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: value ? 1 : 0.25, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: value ? '#cbd5e1' : '#475569' }}>{label}</span>
        <span style={{ fontSize: 9, color: '#334155', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '1px 5px' }}>{count}</span>
      </div>
      <button onClick={() => onChange(!value)} style={{ width: 32, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer', background: value ? '#1d4ed8' : '#1e293b', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 3, width: 12, height: 12, borderRadius: '50%', background: value ? '#93c5fd' : '#475569', left: value ? 17 : 3, transition: 'left 0.2s' }} />
      </button>
    </div>
  )
})

const ExportBtn = memo(function ExportBtn({ label, sub, onClick }: { label: string; sub: string; onClick: () => void }) {
  return (
    <button className="repo-control" onClick={onClick} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}>
      <div style={{ fontSize: 13, color: '#93c5fd', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{sub}</div>
    </button>
  )
})

const Legend = memo(function Legend({
  nodeCounts,
  edgeCounts,
}: {
  nodeCounts: Record<'layer' | 'module' | 'file' | 'component', number>
  edgeCounts: Record<'engineering' | 'architecture' | 'both' | 'uncertain', number>
}) {
  const nodeItems = [
    { key: 'layer', label: 'Layer', color: '#60a5fa' },
    { key: 'module', label: 'Module', color: '#a78bfa' },
    { key: 'file', label: 'File', color: '#34d399' },
    { key: 'component', label: 'Component', color: '#fb923c' },
  ].filter((item) => nodeCounts[item.key as keyof typeof nodeCounts] > 0)

  const edgeItems = [
    { key: 'engineering', label: 'Runtime calls', color: '#60a5fa', dash: undefined },
    { key: 'architecture', label: 'Design structure', color: '#c084fc', dash: undefined },
    { key: 'both', label: 'Mixed', color: '#f472b6', dash: undefined },
    { key: 'uncertain', label: 'Uncertain', color: '#64748b', dash: '4,3' },
  ].filter((item) => edgeCounts[item.key as keyof typeof edgeCounts] > 0)

  return (
    <div style={{ position: 'absolute', bottom: 16, left: 16, background: 'rgba(15,23,42,0.9)', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 14px', backdropFilter: 'blur(8px)', zIndex: 10, display: 'flex', gap: 20 }}>
      {nodeItems.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Nodes</div>
          {nodeItems.map(({ key, label, color }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.9 }} />
              <span style={{ fontSize: 10, color: '#94a3b8' }}>{label}</span>
              <span style={{ fontSize: 9, color: '#475569' }}>{nodeCounts[key as keyof typeof nodeCounts]}</span>
            </div>
          ))}
        </div>
      )}
      {edgeItems.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Connections</div>
          {edgeItems.map(({ key, label, color, dash }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <svg width={22} height={10}><line x1={0} y1={5} x2={22} y2={5} stroke={color} strokeWidth={1.5} strokeDasharray={dash} /></svg>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>{label}</span>
              <span style={{ fontSize: 9, color: '#475569' }}>{edgeCounts[key as keyof typeof edgeCounts]}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #1e293b', color: '#475569', fontSize: 9, lineHeight: 1.5, marginTop: 6, paddingTop: 5 }}>
            solid high · dashed medium · dotted uncertain
          </div>
        </div>
      )}
    </div>
  )
})

function resolvedToRepoGraph(baseGraph: RepoGraph, resolved: ResolvedGraph, branchName: string): RepoGraph {
  return {
    meta: {
      ...baseGraph.meta,
      repoName: `${baseGraph.meta.repoName} / ${branchName}`,
      analyzedAt: new Date().toISOString(),
    },
    nodes: resolved.nodes.map((node) => ({
      id:           node.id,
      label:        node.label,
      type:         node.type,
      parentId:     node.parentId,
      depth:        node.depth,
      files:        node.files,
      detectedRole: node.detectedRole,
      patterns:     node.patterns,
      metadata:     node.metadata,
    })),
    edges: resolved.edges.map((edge) => ({
      id:         edge.id,
      source:     edge.source,
      target:     edge.target,
      edgeType:   edge.edgeType,
      strength:   edge.strength,
      label:      edge.label,
      confidence: edge.confidence,
    })),
    overlay: {
      version:       0,
      nodeOverrides: {},
      edgeOverrides: {},
      manualNodes:   [],
      manualEdges:   [],
    },
  }
}

// ------------------------------------------------------------
// Styles
// ------------------------------------------------------------

const sidebarStyle: React.CSSProperties = {
  width: 240, flexShrink: 0,
  background: '#080e1a', borderRight: '1px solid #1e293b',
  padding: '16px 14px', overflowY: 'auto',
  display: 'flex', flexDirection: 'column',
  animation: 'fadeUp 0.32s ease both',
}

const tabBtnStyle: React.CSSProperties = {
  flex: 1, background: 'none', border: 'none', borderBottom: '2px solid transparent',
  padding: '8px 2px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
  letterSpacing: '0.02em',
}

const ghostBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #1e293b', borderRadius: 6,
  padding: '6px 10px', fontSize: 11, color: '#64748b',
  cursor: 'pointer', fontFamily: 'inherit',
}

const sidebarInputStyle: React.CSSProperties = {
  width: '100%', background: '#0f172a', border: '1px solid #1e293b',
  borderRadius: 6, padding: '7px 10px', color: '#e2e8f0',
  fontSize: 12, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box',
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href    = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}