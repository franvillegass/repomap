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
import { buildReactFlowGraph } from './graphLayout'
import { nodeTypes, edgeTypes } from './GraphNodes'
import { ChatPanel } from './ChatPanel'
import {
  OnionView, LayerStackView, ClusterView, PipelineView,
  ViewSwitcher, recommendedView,
  type ViewType,
} from './AlternativeViews'

interface GraphRendererProps {
  graph: RepoGraph
  onOverlayChange?: (patch: Partial<RepoGraph['overlay']>) => void
}

type StatusTag = 'none' | 'legacy' | 'in_refactor' | 'stable' | 'deprecated'

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

const STATUS_COLORS: Record<StatusTag, string> = {
  none:        'transparent',
  legacy:      '#f87171',
  in_refactor: '#fbbf24',
  stable:      '#34d399',
  deprecated:  '#64748b',
}

const DEFAULT_FILTERS: Filters = {
  showEngineering:  true,
  showArchitecture: true,
  showBoth:         true,
  showUncertain:    true,
  minStrength:      1,
}

export default function GraphRenderer({ graph, onOverlayChange }: GraphRendererProps) {
  const [filters,     setFilters]     = useState<Filters>(DEFAULT_FILTERS)
  const [annotations, setAnnotations] = useState<Record<string, NodeAnnotation>>({})
  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [sidebarTab,  setSidebarTab]  = useState<'filters' | 'node' | 'export'>('filters')
  const [chatOpen,    setChatOpen]    = useState(false)
  const [chatWidth,   setChatWidth]   = useState(340)
  const [viewType,    setViewType]    = useState<ViewType>(() => recommendedView(graph.meta.layoutTemplate))

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = chatWidth
    function onMove(ev: MouseEvent) {
      // drag left = panel grows, drag right = panel shrinks
      const newW = Math.max(260, Math.min(580, startW - (ev.clientX - startX)))
      setChatWidth(newW)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor      = ''
      document.body.style.userSelect  = ''
    }
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildReactFlowGraph(graph),
    [graph],
  )

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const visibleEdges = useMemo(() => edges.filter((e) => {
    const d          = e.data as { edgeType?: string; confidence?: string; strength?: number } | undefined
    const type       = d?.edgeType   ?? 'engineering'
    const confidence = d?.confidence ?? 'high'
    const strength   = d?.strength   ?? 1
    if (!filters.showEngineering  && type === 'engineering')       return false
    if (!filters.showArchitecture && type === 'architecture')      return false
    if (!filters.showBoth         && type === 'both')              return false
    if (!filters.showUncertain    && confidence === 'uncertain')   return false
    if (strength < filters.minStrength)                            return false
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
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' })
    download(blob, `${graph.meta.repoName.replace('/', '_')}.svg`)
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

  // Count visible edges by type for the filter summary
  const edgeCounts = useMemo(() => {
    const counts = { engineering: 0, architecture: 0, both: 0, uncertain: 0 }
    edges.forEach((e) => {
      const d    = e.data as { edgeType?: string; confidence?: string } | undefined
      const type = d?.edgeType ?? 'engineering'
      const conf = d?.confidence ?? 'high'
      if (type === 'engineering')  counts.engineering++
      if (type === 'architecture') counts.architecture++
      if (type === 'both')         counts.both++
      if (conf === 'uncertain')    counts.uncertain++
    })
    return counts
  }, [edges])

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: '#0b0f1a', fontFamily: '"JetBrains Mono", "Fira Mono", monospace' }}>

      {/* ── Sidebar ── */}
      <div style={sidebarStyle}>

        <div style={{ fontSize: 11, color: '#3b82f6', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 14 }}>
          {'{'}<span style={{ color: '#a78bfa' }}>repo</span>map{'}'}
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', marginBottom: 16 }}>
          {(['filters', 'node', 'export'] as const).map((tab) => (
            <button key={tab} onClick={() => setSidebarTab(tab)} style={{
              ...tabBtnStyle,
              color:        sidebarTab === tab ? '#93c5fd' : '#475569',
              borderBottom: sidebarTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
            }}>
              {tab === 'filters' ? '⚙' : tab === 'node' ? '◎' : '↗'}{' '}{tab}
            </button>
          ))}
        </div>

        {/* ── Filters tab ── */}
        {sidebarTab === 'filters' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            <Section title="Connection types" subtitle="show or hide lines between nodes">
              {([
                ['showEngineering',  'Runtime calls',    '#60a5fa', edgeCounts.engineering,  'direct calls, data passing'],
                ['showArchitecture', 'Design structure', '#c084fc', edgeCounts.architecture, 'inheritance, interfaces'],
                ['showBoth',         'Mixed',            '#f472b6', edgeCounts.both,         'both simultaneously'],
                ['showUncertain',    'Uncertain',        '#64748b', edgeCounts.uncertain,    'low confidence edges'],
              ] as [keyof Filters, string, string, number, string][]).map(([key, label, color, count, hint]) => (
                <div key={key} style={{ marginBottom: 10 }}>
                  <ToggleRow
                    label={label}
                    color={color}
                    count={count}
                    value={filters[key] as boolean}
                    onChange={(v) => setFilters((f) => ({ ...f, [key]: v }))}
                  />
                  <div style={{ fontSize: 9, color: '#334155', marginLeft: 18, marginTop: 2 }}>{hint}</div>
                </div>
              ))}
            </Section>

            <Section
              title={`Minimum importance: ${filters.minStrength}/5`}
              subtitle="hide weak or optional connections"
            >
              <input type="range" min={1} max={5} value={filters.minStrength}
                onChange={(e) => setFilters((f) => ({ ...f, minStrength: +e.target.value }))}
                style={{ width: '100%', accentColor: '#3b82f6', marginBottom: 4 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#334155' }}>
                <span>1 — optional</span>
                <span>5 — critical</span>
              </div>
              <div style={{ fontSize: 9, color: '#475569', marginTop: 6 }}>
                {visibleEdges.length} of {edges.length} connections visible
              </div>
            </Section>

            <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 9, color: '#475569', marginBottom: 4 }}>ℹ note</div>
              <div style={{ fontSize: 9, color: '#334155', lineHeight: 1.5 }}>
                Filters only affect connections (lines). Nodes (boxes) are always visible.
              </div>
            </div>

            <button onClick={() => setFilters(DEFAULT_FILTERS)} style={ghostBtn}>
              reset filters
            </button>
          </div>
        )}

        {/* ── Node tab ── */}
        {sidebarTab === 'node' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!selectedNode ? (
              <div style={{ textAlign: 'center', marginTop: 32 }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>◎</div>
                <div style={{ fontSize: 11, color: '#334155' }}>click any node in the graph to inspect and annotate it</div>
              </div>
            ) : (
              <>
                <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 7, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                    {String((selectedNode.data as {nodeType?: string}).nodeType ?? 'node')}
                  </div>
                  <div style={{ fontSize: 12, color: '#f1f5f9', fontWeight: 600 }}>
                    {String(selectedNode.data.label)}
                  </div>
                  {(selectedNode.data as {detectedRole?: string}).detectedRole && (
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>
                      role: {String((selectedNode.data as {detectedRole?: string}).detectedRole)}
                    </div>
                  )}
                </div>

                <FieldGroup label="Custom label">
                  <input
                    type="text"
                    value={selectedAnn.customLabel ?? ''}
                    placeholder={String(selectedNode.data.label)}
                    onChange={(e) => updateAnnotation(selectedId!, { customLabel: e.target.value || undefined })}
                    style={sidebarInputStyle}
                  />
                </FieldGroup>

                <FieldGroup label="Annotation / note">
                  <textarea
                    value={selectedAnn.annotation ?? ''}
                    placeholder="Add context, decisions, or TODOs..."
                    rows={3}
                    onChange={(e) => updateAnnotation(selectedId!, { annotation: e.target.value || undefined })}
                    style={{ ...sidebarInputStyle, resize: 'vertical', minHeight: 72 }}
                  />
                </FieldGroup>

                <FieldGroup label="Status tag">
                  <div style={{ fontSize: 9, color: '#334155', marginBottom: 6 }}>
                    mark the current state of this component
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {(['none', 'stable', 'legacy', 'in_refactor', 'deprecated'] as StatusTag[]).map((tag) => {
                      const active = (selectedAnn.statusTag ?? 'none') === tag
                      return (
                        <button key={tag} onClick={() => updateAnnotation(selectedId!, { statusTag: tag })}
                          style={{
                            padding: '4px 10px', borderRadius: 5, fontSize: 10,
                            cursor: 'pointer', fontFamily: 'inherit', border: '1px solid',
                            borderColor: active ? STATUS_COLORS[tag] : '#1e293b',
                            background:  active ? STATUS_COLORS[tag] + '22' : 'transparent',
                            color:       active ? STATUS_COLORS[tag] : '#475569',
                          }}
                        >
                          {tag === 'none' ? '— none' : tag.replace('_', ' ')}
                        </button>
                      )
                    })}
                  </div>
                </FieldGroup>

                {selectedAnn.annotation && (
                  <div style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 6, padding: '8px 10px', fontSize: 10, color: '#93c5fd', lineHeight: 1.5 }}>
                    📝 {selectedAnn.annotation}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Export tab ── */}
        {sidebarTab === 'export' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, color: '#334155', marginBottom: 4, lineHeight: 1.5 }}>
              exports the current viewport — filters and annotations are reflected in the output.
            </div>
            <ExportBtn label="Export SVG" sub="vector · scales to any size · best for docs" onClick={handleExportSVG} />
            <ExportBtn label="Export PNG" sub="raster · 2× resolution · best for slides"   onClick={handleExportPNG} />
          </div>
        )}
      </div>

      {/* ── Graph canvas ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Header badge — siempre visible sobre cualquier vista */}
        <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(15,23,42,0.9)', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 14px', backdropFilter: 'blur(8px)', zIndex: 10 }}>
          <div style={{ fontSize: 11, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {graph.meta.detectedPattern.replace(/_/g, ' ')}
          </div>
          <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600, marginTop: 2 }}>{graph.meta.repoName}</div>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
            confidence {Math.round(graph.meta.patternConfidence * 100)}%
          </div>
          <ViewSwitcher
            current={viewType}
            recommended={recommendedView(graph.meta.layoutTemplate)}
            onChange={setViewType}
          />
          {/* ── Chat toggle ── */}
          <button
            onClick={() => setChatOpen((o) => !o)}
            style={{
              marginTop:     8,
              width:         '100%',
              background:    chatOpen ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.1)',
              border:        `1px solid ${chatOpen ? 'rgba(99,102,241,0.6)' : 'rgba(99,102,241,0.25)'}`,
              borderRadius:  5,
              color:         chatOpen ? '#a5b4fc' : '#6366f1',
              cursor:        'pointer',
              fontSize:      10,
              fontWeight:    700,
              fontFamily:    'inherit',
              letterSpacing: '0.06em',
              padding:       '5px 0',
              textTransform: 'uppercase',
              transition:    'all 0.15s',
            }}
          >
            {chatOpen ? '✕ close chat' : '✦ ask AI'}
          </button>
        </div>

        {/* ── Node graph (React Flow) ── */}
        {viewType === 'graph' && (
          <>
            <ReactFlow
              nodes={annotatedNodes}
              edges={visibleEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.1}
              maxZoom={2.5}
              defaultEdgeOptions={{ type: 'repoEdge' }}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#1e2a3a" />
              <Controls style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }} />
              <MiniMap
                style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                nodeColor={(n) => {
                  const type = (n.data as { nodeType?: string }).nodeType
                  return type === 'layer' ? '#60a5fa' : type === 'module' ? '#a78bfa' : type === 'file' ? '#34d399' : '#fb923c'
                }}
                maskColor="rgba(0,0,0,0.6)"
              />
            </ReactFlow>
            <Legend />
          </>
        )}

        {/* ── Alternative views — start below the badge (~220px) ── */}
        {viewType !== 'graph' && (
          <div style={{ position: 'absolute', inset: 0, paddingTop: 220, boxSizing: 'border-box' }}>
            {viewType === 'onion' && (
  <OnionView
    graph={graph}
    onNodeClick={(n) => {
      setSelectedId(n.id)
      setSidebarTab('node')
    }}
  />
)}

{viewType === 'layers' && (
  <LayerStackView
    graph={graph}
    onNodeClick={(n) => {
      setSelectedId(n.id)
      setSidebarTab('node')
    }}
  />
)}

{viewType === 'clusters' && (
  <ClusterView
    graph={graph}
    onNodeClick={(n) => {
      setSelectedId(n.id)
      setSidebarTab('node')
    }}
  />
)}

{viewType === 'pipeline' && (
  <PipelineView
    graph={graph}
    onNodeClick={(n) => {
      setSelectedId(n.id)
      setSidebarTab('node')
    }}
  />
)}
          </div>
        )}
      </div>

      {/* ── Resize handle + Chat panel ── */}
      {chatOpen && (
        <>
          {/* Drag handle — sits between canvas and chat */}
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            style={{
              width:      5,
              flexShrink: 0,
              background: '#1e293b',
              cursor:     'col-resize',
              transition: 'background 0.15s',
              zIndex:     20,
            }}
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

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
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
      <button onClick={() => onChange(!value)} style={{
        width: 32, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer',
        background: value ? '#1d4ed8' : '#1e293b', position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: 3, width: 12, height: 12, borderRadius: '50%',
          background: value ? '#93c5fd' : '#475569',
          left: value ? 17 : 3, transition: 'left 0.2s',
        }} />
      </button>
    </div>
  )
}

function ExportBtn({ label, sub, onClick }: { label: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
      padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
    }}>
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
  padding: '8px 4px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
  letterSpacing: '0.05em',
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