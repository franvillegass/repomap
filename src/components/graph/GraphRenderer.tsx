'use client'

import { useMemo, useCallback, useState } from 'react'
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { RepoGraph } from '@/lib/pipeline/schemas/graph'
import { buildReactFlowGraph, buildReactFlowGraphFromResolved } from './graphLayout'
import { nodeTypes, edgeTypes } from './GraphNodes'
import { ChatPanel } from './ChatPanel'
import {
  OnionView, LayerStackView, ClusterView, PipelineView,
  ViewSwitcher, recommendedView,
  type ViewType,
} from './AlternativeViews'
import { BranchPanel } from '../../branches/BranchPanel'
import { useBranches } from '../../branches/UseBranches'

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
  const { isOnBranch, resolvedGraph, activeBranchId, branches } = useBranches()

  const [filters,     setFilters]     = useState<Filters>(DEFAULT_FILTERS)
  const [annotations, setAnnotations] = useState<Record<string, NodeAnnotation>>({})
  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [sidebarTab,  setSidebarTab]  = useState<SidebarTab>('filters')
  const [chatOpen,    setChatOpen]    = useState(false)
  const [chatWidth,   setChatWidth]   = useState(340)
  const [viewType,    setViewType]    = useState<ViewType>(
    () => recommendedView(graph.meta.layoutTemplate)
  )

  // ── Chat panel resize ──
  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = chatWidth
    function onMove(ev: MouseEvent) {
      setChatWidth(Math.max(260, Math.min(580, startW - (ev.clientX - startX))))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',  onUp)
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',  onUp)
  }

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

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const visibleEdges = useMemo(() => edges.filter((e) => {
    const d    = e.data as { edgeType?: string; confidence?: string; strength?: number } | undefined
    const type = d?.edgeType   ?? 'engineering'
    const conf = d?.confidence ?? 'high'
    const str  = d?.strength   ?? 1
    if (!filters.showEngineering  && type === 'engineering')   return false
    if (!filters.showArchitecture && type === 'architecture')  return false
    if (!filters.showBoth         && type === 'both')          return false
    if (!filters.showUncertain    && conf === 'uncertain')     return false
    if (str < filters.minStrength)                             return false
    return true
  }), [edges, filters])

  const annotatedNodes = useMemo(() => nodes.map((n) => {
    const ann = annotations[n.id]
    if (!ann) return n
    return {
      ...n,
      data: {
        ...n.data,
        label:     ann.customLabel ?? n.data.label,
        statusTag: ann.statusTag !== 'none' ? ann.statusTag : undefined,
      },
    }
  }), [nodes, annotations])

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, type: 'repoEdge' }, eds)),
    [setEdges],
  )

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedId(node.id)
    setSidebarTab('node')
  }, [])

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
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

  const edgeCounts = useMemo(() => {
    const c = { engineering: 0, architecture: 0, both: 0, uncertain: 0 }
    edges.forEach((e) => {
      const d    = e.data as { edgeType?: string; confidence?: string } | undefined
      const type = d?.edgeType   ?? 'engineering'
      const conf = d?.confidence ?? 'high'
      if (type === 'engineering')  c.engineering++
      if (type === 'architecture') c.architecture++
      if (type === 'both')         c.both++
      if (conf === 'uncertain')    c.uncertain++
    })
    return c
  }, [edges])

  // ── Render ──
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: '#0b0f1a', fontFamily: '"JetBrains Mono", "Fira Mono", monospace' }}>

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
              <ViewSwitcher current={viewType} onChange={setViewType} />
            </Section>
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
            <BranchPanel />
          </div>
        )}

      </div>

      {/* ── Canvas ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

        {/* Branch active banner */}
        {isOnBranch && activeBranch && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
            background: 'rgba(15,23,42,0.92)',
            borderBottom: `2px solid ${activeBranch.color ?? '#60a5fa'}`,
            padding: '5px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
            backdropFilter: 'blur(6px)',
            fontSize: 11, fontFamily: '"JetBrains Mono", monospace',
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
              edges={visibleEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              style={{ background: '#0b0f1a', paddingTop: isOnBranch ? 36 : 0 }}
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
            <Legend />
          </>
        )}

        {viewType !== 'graph' && (
          <div style={{ position: 'absolute', inset: 0, paddingTop: isOnBranch ? 256 : 220, boxSizing: 'border-box' }}>
            {viewType === 'onion'    && <OnionView    graph={graph} onNodeClick={(n) => { setSelectedId(n.id); setSidebarTab('node') }} />}
            {viewType === 'layers'   && <LayerStackView graph={graph} onNodeClick={(n) => { setSelectedId(n.id); setSidebarTab('node') }} />}
            {viewType === 'clusters' && <ClusterView  graph={graph} onNodeClick={(n) => { setSelectedId(n.id); setSidebarTab('node') }} />}
            {viewType === 'pipeline' && <PipelineView graph={graph} onNodeClick={(n) => { setSelectedId(n.id); setSidebarTab('node') }} />}
          </div>
        )}

        {/* Chat toggle */}
        <button
          onClick={() => setChatOpen((p) => !p)}
          style={{
            position: 'absolute', bottom: 20, right: 20, zIndex: 30,
            background: chatOpen ? '#1d4ed8' : '#0f172a',
            border: '1px solid #1e293b', borderRadius: 10,
            color: chatOpen ? '#fff' : '#93c5fd',
            fontSize: 11, padding: '8px 14px',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {chatOpen ? '✕ close chat' : '✦ ask claude'}
        </button>
      </div>

      {/* ── Chat panel ── */}
      {chatOpen && (
        <>
          <div
            onMouseDown={startResize}
            style={{ width: 5, flexShrink: 0, background: '#1e293b', cursor: 'col-resize', transition: 'background 0.15s', zIndex: 20 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#3b82f6' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#1e293b' }}
          />
          <div style={{ width: chatWidth, flexShrink: 0 }}>
            <ChatPanel graph={graph} onClose={() => setChatOpen(false)} />
          </div>
        </>
      )}

    </div>
  )
}

// ------------------------------------------------------------
// Small components
// ------------------------------------------------------------

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 9, color: '#334155', marginBottom: 8 }}>{subtitle}</div>}
      {children}
    </div>
  )
}

function ToggleRow({ label, color, count, value, onChange }: {
  label: string; color: string; count: number; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: value ? 1 : 0.25, flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: value ? '#94a3b8' : '#334155' }}>{label}</span>
        <span style={{ fontSize: 9, color: '#334155', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '1px 5px' }}>{count}</span>
      </div>
      <button onClick={() => onChange(!value)} style={{ width: 32, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer', background: value ? '#1d4ed8' : '#1e293b', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 3, width: 12, height: 12, borderRadius: '50%', background: value ? '#93c5fd' : '#475569', left: value ? 17 : 3, transition: 'left 0.2s' }} />
      </button>
    </div>
  )
}

function ExportBtn({ label, sub, onClick }: { label: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' }}>
      <div style={{ fontSize: 12, color: '#93c5fd', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{sub}</div>
    </button>
  )
}

function Legend() {
  return (
    <div style={{ position: 'absolute', bottom: 16, left: 16, background: 'rgba(15,23,42,0.9)', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 14px', backdropFilter: 'blur(8px)', zIndex: 10, display: 'flex', gap: 20 }}>
      <div>
        <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Nodes</div>
        {[['Layer', '#60a5fa'], ['Module', '#a78bfa'], ['File', '#34d399'], ['Component', '#fb923c']].map(([label, color]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.9 }} />
            <span style={{ fontSize: 10, color: '#94a3b8' }}>{label}</span>
          </div>
        ))}
      </div>
      <div>
        <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Connections</div>
        {[['Runtime calls', '#60a5fa', undefined], ['Design structure', '#c084fc', undefined], ['Mixed', '#f472b6', undefined], ['Uncertain', '#64748b', '4,3']].map(([label, color, dash]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <svg width={22} height={10}><line x1={0} y1={5} x2={22} y2={5} stroke={color as string} strokeWidth={1.5} strokeDasharray={dash as string | undefined} /></svg>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Styles
// ------------------------------------------------------------

const sidebarStyle: React.CSSProperties = {
  width: 240, flexShrink: 0,
  background: '#080e1a', borderRight: '1px solid #1e293b',
  padding: '16px 14px', overflowY: 'auto',
  display: 'flex', flexDirection: 'column',
}

const tabBtnStyle: React.CSSProperties = {
  flex: 1, background: 'none', border: 'none', borderBottom: '2px solid transparent',
  padding: '8px 2px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit',
  letterSpacing: '0.04em',
}

const ghostBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #1e293b', borderRadius: 6,
  padding: '6px 10px', fontSize: 10, color: '#475569',
  cursor: 'pointer', fontFamily: 'inherit',
}

const sidebarInputStyle: React.CSSProperties = {
  width: '100%', background: '#0f172a', border: '1px solid #1e293b',
  borderRadius: 6, padding: '7px 10px', color: '#e2e8f0',
  fontSize: 11, fontFamily: 'inherit', outline: 'none',
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