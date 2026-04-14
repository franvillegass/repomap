'use client'

import { useState, useMemo, useRef } from 'react'
import type { RepoGraph, Node } from '@/lib/pipeline/schemas/graph'

// ─────────────────────────────────────────────────────────────
// Types & routing
// ─────────────────────────────────────────────────────────────

export type ViewType = 'graph' | 'onion' | 'layers' | 'clusters' | 'pipeline'

const LAYOUT_TO_VIEW: Record<string, ViewType> = {
  concentric_rings:        'onion',
  horizontal_three_column: 'layers',
  cluster:                 'clusters',
  vertical_layers:         'layers',
  grid_clusters:           'clusters',
  left_right_flow:         'pipeline',
  force_directed:          'graph',
}

export function recommendedView(layout: string): ViewType {
  return LAYOUT_TO_VIEW[layout] ?? 'graph'
}

// ─────────────────────────────────────────────────────────────
// ViewSwitcher
// ─────────────────────────────────────────────────────────────

const VIEWS: { id: ViewType; icon: string; label: string }[] = [
  { id: 'graph',    icon: '◉', label: 'Node graph'  },
  { id: 'onion',    icon: '⊙', label: 'Onion rings' },
  { id: 'layers',   icon: '≡', label: 'Layer stack' },
  { id: 'clusters', icon: '⊞', label: 'Clusters'    },
  { id: 'pipeline', icon: '→', label: 'Pipeline'    },
]

export function ViewSwitcher({ current, recommended, onChange }: {
  current:     ViewType
  recommended: ViewType
  onChange:    (v: ViewType) => void
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 9, color: '#334155', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>
        visualisation
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {VIEWS.map(({ id, icon, label }) => {
          const active = current === id
          const rec    = recommended === id && !active
          return (
            <button key={id} onClick={() => onChange(id)}
              title={label + (rec ? ' — recommended for this pattern' : '')}
              style={{
                background:   active ? 'rgba(99,102,241,0.3)' : rec ? 'rgba(99,102,241,0.1)' : 'transparent',
                border:       `1px solid ${active ? 'rgba(99,102,241,0.7)' : rec ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 5,
                color:        active ? '#a5b4fc' : rec ? '#6366f1' : '#475569',
                cursor:       'pointer',
                flex:         1,
                fontSize:     12,
                fontFamily:   'inherit',
                padding:      '4px 0',
                transition:   'all 0.15s',
              }}
            >{icon}</button>
          )
        })}
      </div>
      {recommended !== current && (
        <div style={{ fontSize: 9, color: '#334155', marginTop: 4 }}>
          ⊙ = recommended for {recommended === 'onion' ? 'this pattern' : recommended}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────────

const NCOLORS: Record<string, { bg: string; stroke: string; text: string }> = {
  layer:     { bg: 'rgba(96,165,250,0.12)',  stroke: '#60a5fa', text: '#93c5fd' },
  module:    { bg: 'rgba(167,139,250,0.12)', stroke: '#a78bfa', text: '#c4b5fd' },
  file:      { bg: 'rgba(52,211,153,0.12)',  stroke: '#34d399', text: '#6ee7b7' },
  component: { bg: 'rgba(251,146,60,0.12)',  stroke: '#fb923c', text: '#fdba74' },
}
const nc = (type: string) => NCOLORS[type] ?? NCOLORS.module

function HoverCard({ node }: { node: Node }) {
  const col = nc(node.type)
  return (
    <div style={{
      position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(8,14,26,0.97)', border: '1px solid #1e293b', borderRadius: 8,
      padding: '8px 14px', fontSize: 11, fontFamily: '"JetBrains Mono",monospace',
      pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 20,
      display: 'flex', gap: 8, alignItems: 'center',
    }}>
      <span style={{ color: col.text, fontWeight: 700 }}>{node.label}</span>
      <span style={{ color: '#334155' }}>·</span>
      <span style={{ color: '#475569' }}>{node.type}</span>
      {node.detectedRole && node.detectedRole !== 'unknown' && (
        <><span style={{ color: '#334155' }}>·</span>
        <span style={{ color: '#334155' }}>{node.detectedRole}</span></>
      )}
      {node.files.length > 0 && (
        <><span style={{ color: '#334155' }}>·</span>
        <span style={{ color: '#334155' }}>{node.files.length} files</span></>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ONION VIEW — concentric rings by depth
// ─────────────────────────────────────────────────────────────

const RINGS = [
  { inner: 0,   outer: 62  },
  { inner: 78,  outer: 142 },
  { inner: 158, outer: 214 },
  { inner: 230, outer: 278 },
]
const RING_STROKE = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c']

function arcPath(cx: number, cy: number, ri: number, ro: number, a1: number, a2: number): string {
  const gap = Math.min(0.035, (a2 - a1) * 0.07)
  const s   = a1 + gap, e = a2 - gap
  if (e <= s) return ''
  const lg = (e - s) > Math.PI ? 1 : 0
  const C  = Math.cos, S = Math.sin
  if (ri <= 1) {
    return `M ${cx} ${cy} L ${cx+ro*C(s)} ${cy+ro*S(s)} A ${ro} ${ro} 0 ${lg} 1 ${cx+ro*C(e)} ${cy+ro*S(e)} Z`
  }
  return `M ${cx+ro*C(s)} ${cy+ro*S(s)} A ${ro} ${ro} 0 ${lg} 1 ${cx+ro*C(e)} ${cy+ro*S(e)} L ${cx+ri*C(e)} ${cy+ri*S(e)} A ${ri} ${ri} 0 ${lg} 0 ${cx+ri*C(s)} ${cy+ri*S(s)} Z`
}

export function OnionView({ graph, onNodeClick }: { graph: RepoGraph; onNodeClick?: (node: Node) => void }) {
  const [hovered, setHovered]     = useState<string | null>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const dragging = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)
  const isDragging = useRef(false)
  const CX = 290, CY = 295

  const byDepth = useMemo(() => {
    const m: Record<number, Node[]> = {}
    graph.nodes.forEach((n) => {
      const d = Math.min(n.depth, 3)
      ;(m[d] ??= []).push(n)
    })
    return m
  }, [graph.nodes])

  const depths  = Object.keys(byDepth).map(Number).sort()
  const hovNode = hovered ? graph.nodes.find((n) => n.id === hovered) ?? null : null

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setTransform((t) => ({ ...t, scale: Math.min(4, Math.max(0.25, t.scale * delta)) }))
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('[data-node]')) return
    isDragging.current = false
    dragging.current = { startX: e.clientX, startY: e.clientY, ox: transform.x, oy: transform.y }
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - dragging.current.startX
    const dy = e.clientY - dragging.current.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging.current = true
    setTransform((t) => ({
      ...t,
      x: dragging.current!.ox + dx,
      y: dragging.current!.oy + dy,
    }))
  }

  const onMouseUp = () => { dragging.current = null }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        style={{ flex: 1, position: 'relative', cursor: dragging.current ? 'grabbing' : 'grab', overflow: 'hidden' }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <svg
          width="100%" height="100%"
          viewBox="0 0 580 590"
          style={{
            display: 'block',
            transformOrigin: 'center center',
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          {/* Background guide rings */}
          {depths.map((d) => {
            const r = RINGS[d]
            if (!r) return null
            return (
              <circle key={'bg'+d} cx={CX} cy={CY} r={r.outer}
                fill="none" stroke={RING_STROKE[d]}
                strokeWidth={0.4} strokeOpacity={0.2} strokeDasharray="4 4"
              />
            )
          })}

          {/* Segments */}
          {depths.flatMap((d) => {
            const nodes  = byDepth[d] ?? []
            const ring   = RINGS[d]
            if (!ring || !nodes.length) return []
            const angle  = (2 * Math.PI) / nodes.length
            const start  = -Math.PI / 2
            const stroke = RING_STROKE[d]

            return nodes.map((node, i) => {
              const a1     = start + i * angle, a2 = a1 + angle
              const mid    = (a1 + a2) / 2
              const midR   = ring.inner <= 1 ? ring.outer * 0.56 : (ring.inner + ring.outer) / 2
              const lx     = CX + midR * Math.cos(mid)
              const ly     = CY + midR * Math.sin(mid)
              const path   = arcPath(CX, CY, ring.inner, ring.outer, a1, a2)
              const col    = nc(node.type)
              const hov    = hovered === node.id
              const arcLen = midR * angle
              const maxCh  = Math.max(3, Math.floor(arcLen / 7))
              const lbl    = node.label.length > maxCh ? node.label.slice(0, maxCh - 1) + '…' : node.label
              let rot      = (mid * 180) / Math.PI
              if (rot > 90 && rot < 270) rot += 180

              return (
                <g key={node.id} data-node="1"
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => { if (!isDragging.current) onNodeClick?.(node) }}
                  style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
                >
                  <path d={path}
                    fill={hov ? col.bg.replace('0.12', '0.32') : col.bg}
                    stroke={stroke}
                    strokeWidth={hov ? 1.4 : 0.5}
                    strokeOpacity={hov ? 0.9 : 0.55}
                    style={{ transition: 'fill 0.12s' }}
                  />
                  {arcLen > 30 && (
                    <text x={lx} y={ly}
                      textAnchor="middle" dominantBaseline="central"
                      transform={`rotate(${rot},${lx},${ly})`}
                      style={{
                        fill:          col.text,
                        fontSize:      Math.min(11, Math.max(7, (ring.outer - ring.inner) * 0.22)),
                        fontFamily:    '"JetBrains Mono",monospace',
                        opacity:       hov ? 1 : 0.85,
                        pointerEvents: 'none',
                      }}
                    >{lbl}</text>
                  )}
                </g>
              )
            })
          })}

          {/* Ring depth labels */}
          {depths.map((d) => {
            const r = RINGS[d]
            if (!r) return null
            return (
              <text key={'dlbl'+d}
                x={CX + r.outer + 14}
                y={CY + (d - depths.length / 2 + 0.5) * 16}
                dominantBaseline="central"
                style={{ fill: RING_STROKE[d], fontSize: 9, fontFamily: '"JetBrains Mono",monospace', opacity: 0.55 }}
              >
                depth {d} · {byDepth[d]?.length ?? 0}
              </text>
            )
          })}
        </svg>

        {/* Zoom controls */}
        <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {([['＋', 1.2], ['－', 0.8], ['⊙', 'reset']] as const).map(([icon, action]) => (
            <button key={String(icon)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => action === 'reset'
                ? setTransform({ x: 0, y: 0, scale: 1 })
                : setTransform((t) => ({ ...t, scale: Math.min(4, Math.max(0.25, t.scale * (action as number))) }))}
              style={{
                background: 'rgba(15,23,42,0.9)', border: '1px solid #1e293b', borderRadius: 5,
                color: '#475569', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
                width: 28, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >{icon}</button>
          ))}
        </div>

        {hovNode && <HoverCard node={hovNode} />}
      </div>

      {/* Footer legend */}
      <div style={{ borderTop: '1px solid #1e293b', display: 'flex', gap: 20, padding: '8px 20px', flexShrink: 0, flexWrap: 'wrap' }}>
        {depths.map((d) => (
          <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: RING_STROKE[d], opacity: 0.7 }} />
            <span style={{ fontSize: 10, color: '#475569', fontFamily: '"JetBrains Mono",monospace' }}>
              {d === 0 ? 'core' : d === 1 ? 'modules' : d === 2 ? 'files' : 'components'} ({byDepth[d]?.length ?? 0})
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// LAYER STACK VIEW — horizontal bands
// ─────────────────────────────────────────────────────────────

export function LayerStackView({ graph, onNodeClick }: { graph: RepoGraph; onNodeClick?: (node: Node) => void }) {
  const [hovered, setHovered] = useState<string | null>(null)

  const bands = useMemo(() => {
    const layerNodes = graph.nodes.filter((n) => n.type === 'layer')
    if (layerNodes.length > 0) {
      return layerNodes.map((ln) => ({
        id:       ln.id,
        label:    ln.label,
        role:     ln.detectedRole,
        nodeType: ln.type,
        children: graph.nodes.filter((n) => n.parentId === ln.id),
      }))
    }
    const depths = [...new Set(graph.nodes.map((n) => n.depth))].sort()
    return depths.map((d) => ({
      id:       'depth-' + d,
      label:    d === 0 ? 'Layer / Core' : d === 1 ? 'Modules' : d === 2 ? 'Files' : 'Components',
      role:     '',
      nodeType: d === 0 ? 'layer' : d === 1 ? 'module' : 'file',
      children: graph.nodes.filter((n) => n.depth === d),
    }))
  }, [graph.nodes])

  const edgeCounts = useMemo(() => {
    const nodeToGroup: Record<string, string> = {}
    bands.forEach((b) => {
      nodeToGroup[b.id] = b.id
      b.children.forEach((c) => { nodeToGroup[c.id] = b.id })
    })
    const counts: Record<string, Record<string, number>> = {}
    graph.edges.forEach((e) => {
      const sg = nodeToGroup[e.source], tg = nodeToGroup[e.target]
      if (!sg || !tg || sg === tg) return
      ;((counts[sg] ??= {})[tg] ??= 0)
      counts[sg][tg]++
    })
    return counts
  }, [graph.edges, bands])

  return (
    <div style={{
      width: '100%', height: '100%', overflowY: 'auto',
      padding: '0 24px 20px', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      {bands.map((band, bi) => {
        const col       = nc(band.nodeType)
        const nextBand  = bands[bi + 1]
        const connCount = nextBand ? (edgeCounts[band.id]?.[nextBand.id] ?? 0) : 0

        return (
          <div key={band.id}>
            {/* Band */}
            <div style={{
              background:   col.bg,
              border:       `1px solid ${col.stroke}55`,
              borderLeft:   `3px solid ${col.stroke}`,
              borderRadius: 8,
              padding:      '12px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: band.children.length > 0 ? 10 : 0 }}>
                <span style={{ color: col.text, fontSize: 12, fontWeight: 700, fontFamily: '"JetBrains Mono",monospace' }}>
                  {band.label}
                </span>
                {band.role && band.role !== 'unknown' && (
                  <span style={{ color: '#475569', fontSize: 10, fontFamily: '"JetBrains Mono",monospace' }}>· {band.role}</span>
                )}
                <span style={{ marginLeft: 'auto', color: '#334155', fontSize: 10, fontFamily: '"JetBrains Mono",monospace' }}>
                  {band.children.length} nodes
                </span>
              </div>

              {band.children.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {band.children.map((child) => {
                    const cc  = nc(child.type)
                    const hov = hovered === child.id
                    return (
                      <div key={child.id}
                        onMouseEnter={() => setHovered(child.id)}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => onNodeClick?.(child)}
                        title={child.detectedRole !== 'unknown' ? child.detectedRole : child.id}
                        style={{
                          background:   hov ? cc.bg.replace('0.12', '0.3') : cc.bg,
                          border:       `1px solid ${cc.stroke}${hov ? '' : '88'}`,
                          borderRadius: 5,
                          color:        cc.text,
                          cursor:       onNodeClick ? 'pointer' : 'default',
                          fontSize:     10,
                          fontFamily:   '"JetBrains Mono",monospace',
                          padding:      '3px 8px',
                          transition:   'all 0.12s',
                        }}
                      >
                        {child.label}
                        {child.files.length > 1 && (
                          <span style={{ color: '#475569', marginLeft: 4, fontSize: 9 }}>({child.files.length})</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Connector between bands */}
            {bi < bands.length - 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 20px' }}>
                <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, #1e293b, #334155)' }} />
                <span style={{ color: '#334155', fontSize: 10, fontFamily: '"JetBrains Mono",monospace', flexShrink: 0 }}>
                  {connCount > 0 ? `${connCount} connection${connCount !== 1 ? 's' : ''}` : '—'}
                </span>
                <div style={{ flex: 1, height: 1, background: 'linear-gradient(to left, #1e293b, #334155)' }} />
                <span style={{ color: '#334155', fontSize: 11 }}>↓</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// CLUSTER VIEW — card grid per module
// ─────────────────────────────────────────────────────────────

export function ClusterView({ graph, onNodeClick }: { graph: RepoGraph; onNodeClick?: (node: Node) => void }) {
  const [hovered, setHovered] = useState<string | null>(null)

  const clusters = useMemo(() => {
    const topIds = new Set(
      graph.nodes.filter((n) => n.parentId === null || n.depth <= 1).map((n) => n.id)
    )
    const tops = graph.nodes.filter((n) => topIds.has(n.id) && (!n.parentId || !topIds.has(n.parentId)))

    return tops.map((n) => {
      const children = graph.nodes.filter((c) => c.parentId === n.id)
      const allIds   = new Set([n.id, ...children.map((c) => c.id)])
      return {
        node:     n,
        children,
        edgesOut: graph.edges.filter((e) => allIds.has(e.source) && !allIds.has(e.target)).length,
        edgesIn:  graph.edges.filter((e) => allIds.has(e.target) && !allIds.has(e.source)).length,
      }
    })
  }, [graph.nodes, graph.edges])

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto', padding: '0 24px 24px', boxSizing: 'border-box' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {clusters.map(({ node, children, edgesOut, edgesIn }) => {
          const col = nc(node.type)
          const hov = hovered === node.id
          return (
            <div key={node.id}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onNodeClick?.(node)}
              style={{
                background:    hov ? col.bg.replace('0.12', '0.24') : col.bg,
                border:        `1px solid ${col.stroke}${hov ? '' : '66'}`,
                borderRadius:  10,
                cursor:        onNodeClick ? 'pointer' : 'default',
                display:       'flex',
                flexDirection: 'column',
                overflow:      'hidden',
                transition:    'all 0.15s',
              }}
            >
              {/* Header */}
              <div style={{ borderBottom: `1px solid ${col.stroke}33`, padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ color: col.text, fontFamily: '"JetBrains Mono",monospace', fontSize: 11, fontWeight: 700, lineHeight: 1.35 }}>
                    {node.label}
                  </div>
                  <span style={{
                    background: col.bg, border: `1px solid ${col.stroke}66`, borderRadius: 4,
                    color: col.text, flexShrink: 0, fontSize: 8, fontFamily: '"JetBrains Mono",monospace',
                    padding: '2px 5px', marginTop: 1,
                  }}>
                    {node.type}
                  </span>
                </div>
                {node.detectedRole && node.detectedRole !== 'unknown' && (
                  <div style={{ color: '#475569', fontFamily: '"JetBrains Mono",monospace', fontSize: 9, marginTop: 3 }}>
                    {node.detectedRole}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
                  <span title="Incoming connections" style={{ color: '#334155', fontSize: 9, fontFamily: '"JetBrains Mono",monospace' }}>↓{edgesIn}</span>
                  <span title="Outgoing connections" style={{ color: '#334155', fontSize: 9, fontFamily: '"JetBrains Mono",monospace' }}>↑{edgesOut}</span>
                  {node.files.length > 0 && (
                    <span style={{ color: '#334155', fontSize: 9, fontFamily: '"JetBrains Mono",monospace' }}>{node.files.length} files</span>
                  )}
                </div>
              </div>

              {/* Children list */}
              {children.length > 0 && (
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 130, overflowY: 'auto' }}>
                  {children.slice(0, 7).map((child) => {
                    const cc = nc(child.type)
                    return (
                      <div key={child.id}
                        onClick={(e) => { e.stopPropagation(); onNodeClick?.(child) }}
                        style={{ alignItems: 'center', display: 'flex', gap: 6, cursor: onNodeClick ? 'pointer' : 'default' }}
                      >
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: cc.stroke, flexShrink: 0 }} />
                        <span style={{
                          color: '#64748b', fontFamily: '"JetBrains Mono",monospace', fontSize: 9,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {child.label}
                        </span>
                      </div>
                    )
                  })}
                  {children.length > 7 && (
                    <div style={{ color: '#334155', fontSize: 9, fontFamily: '"JetBrains Mono",monospace', paddingLeft: 11 }}>
                      +{children.length - 7} more
                    </div>
                  )}
                </div>
              )}

              {/* Patterns */}
              {node.patterns?.length > 0 && (
                <div style={{ borderTop: `1px solid ${col.stroke}22`, padding: '6px 12px', display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {node.patterns.slice(0, 2).map((p) => (
                    <span key={p} style={{
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 3, color: '#334155', fontSize: 8, fontFamily: '"JetBrains Mono",monospace',
                      padding: '1px 5px',
                    }}>
                      {p.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PIPELINE VIEW — columns by depth, left → right
// ─────────────────────────────────────────────────────────────

const COL_LABELS: Record<number, string> = {
  0: 'layers',
  1: 'modules',
  2: 'files',
  3: 'components',
}

export function PipelineView({ graph, onNodeClick }: { graph: RepoGraph; onNodeClick?: (node: Node) => void }) {
  const [hovered, setHovered] = useState<string | null>(null)

  const CARD_W = 158, CARD_H = 54, COL_GAP = 72, ROW_GAP = 8, PAD = 24

  const columns = useMemo(() => {
    const depths = [...new Set(graph.nodes.map((n) => n.depth))].sort()
    return depths.map((d) => ({ depth: d, nodes: graph.nodes.filter((n) => n.depth === d) }))
  }, [graph.nodes])

  const positions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {}
    columns.forEach((col, ci) => {
      col.nodes.forEach((n, ni) => {
        pos[n.id] = { x: PAD + ci * (CARD_W + COL_GAP), y: PAD + 28 + ni * (CARD_H + ROW_GAP) }
      })
    })
    return pos
  }, [columns])

  const VW = PAD * 2 + columns.length * (CARD_W + COL_GAP) - COL_GAP
  const VH = PAD * 2 + 28 + Math.max(...columns.map((c) => c.nodes.length)) * (CARD_H + ROW_GAP)

  const crossEdges = useMemo(() =>
    graph.edges.filter((e) => {
      const sn = graph.nodes.find((n) => n.id === e.source)
      const tn = graph.nodes.find((n) => n.id === e.target)
      return sn && tn && sn.depth !== tn.depth
    }).slice(0, 80)
  , [graph])

  const hovNode = hovered ? graph.nodes.find((n) => n.id === hovered) ?? null : null

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', position: 'relative' }}>
      <svg width={Math.max(VW, 400)} height={Math.max(VH, 300)} style={{ display: 'block' }}>

        {/* Column headers */}
        {columns.map((col, ci) => {
          const x = PAD + ci * (CARD_W + COL_GAP)
          return (
            <g key={'hdr'+ci}>
              <rect x={x} y={8} width={CARD_W} height={18} rx={4}
                fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}
              />
              <text x={x + CARD_W / 2} y={17}
                textAnchor="middle" dominantBaseline="central"
                style={{ fill: '#334155', fontSize: 9, fontFamily: '"JetBrains Mono",monospace', letterSpacing: '0.07em' }}
              >{COL_LABELS[col.depth] ?? 'depth ' + col.depth}</text>
            </g>
          )
        })}

        {/* Curved edges */}
        {crossEdges.map((edge) => {
          const sp = positions[edge.source], tp = positions[edge.target]
          if (!sp || !tp) return null
          const x1 = sp.x + CARD_W, y1 = sp.y + CARD_H / 2
          const x2 = tp.x,          y2 = tp.y + CARD_H / 2
          const mx = (x1 + x2) / 2
          const col  = edge.edgeType === 'architecture' ? '#a78bfa' : edge.edgeType === 'both' ? '#f472b6' : '#60a5fa'
          const dash = edge.confidence === 'uncertain' ? '3,3' : edge.confidence === 'medium' ? '5,3' : undefined
          return (
            <path key={edge.id}
              d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
              fill="none" stroke={col}
              strokeWidth={Math.max(0.7, edge.strength * 0.35)}
              strokeDasharray={dash}
              opacity={0.4}
            />
          )
        })}

        {/* Node cards */}
        {graph.nodes.map((node) => {
          const p = positions[node.id]
          if (!p) return null
          const col = nc(node.type)
          const hov = hovered === node.id
          const lbl  = node.label.length > 20 ? node.label.slice(0, 19) + '…' : node.label
          const role = node.detectedRole && node.detectedRole !== 'unknown'
            ? (node.detectedRole.length > 22 ? node.detectedRole.slice(0, 21) + '…' : node.detectedRole)
            : null

          return (
            <g key={node.id}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onNodeClick?.(node)}
              style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
            >
              <rect x={p.x} y={p.y} width={CARD_W} height={CARD_H} rx={6}
                fill={hov ? col.bg.replace('0.12', '0.3') : col.bg}
                stroke={col.stroke}
                strokeWidth={hov ? 1.2 : 0.5}
                strokeOpacity={hov ? 1 : 0.6}
                style={{ transition: 'fill 0.12s' }}
              />
              <text x={p.x + 10} y={p.y + 19}
                style={{ fill: col.text, fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700 }}
              >{lbl}</text>
              {role && (
                <text x={p.x + 10} y={p.y + 35}
                  style={{ fill: '#475569', fontSize: 9, fontFamily: '"JetBrains Mono",monospace' }}
                >{role}</text>
              )}
              {node.files.length > 0 && (
                <text x={p.x + CARD_W - 7} y={p.y + CARD_H - 7}
                  textAnchor="end"
                  style={{ fill: '#334155', fontSize: 8, fontFamily: '"JetBrains Mono",monospace' }}
                >{node.files.length}f</text>
              )}
            </g>
          )
        })}
      </svg>

      {hovNode && <HoverCard node={hovNode} />}
    </div>
  )
}