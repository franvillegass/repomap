'use client'

import { memo, useState } from 'react'
import { Handle, Position, BaseEdge, getSmoothStepPath } from '@xyflow/react'
import type { NodeProps, EdgeProps } from '@xyflow/react'
import type { RFNodeData, RFEdgeData } from './graphLayout'

// ------------------------------------------------------------
// Colors
// ------------------------------------------------------------

const TYPE_COLORS: Record<string, { border: string; bg: string; badge: string }> = {
  layer:     { border: '#60a5fa', bg: 'rgba(96,165,250,0.08)',  badge: '#1d4ed8' },
  module:    { border: '#a78bfa', bg: 'rgba(167,139,250,0.08)', badge: '#6d28d9' },
  file:      { border: '#34d399', bg: 'rgba(52,211,153,0.08)',  badge: '#065f46' },
  component: { border: '#fb923c', bg: 'rgba(251,146,60,0.08)',  badge: '#9a3412' },
}

const STATUS_TAG_COLORS: Record<string, { stripe: string; badge: string; label: string }> = {
  legacy:      { stripe: '#f59e0b', badge: 'rgba(245,158,11,0.15)',  label: '#f59e0b' },
  in_refactor: { stripe: '#3b82f6', badge: 'rgba(59,130,246,0.15)',  label: '#60a5fa' },
  stable:      { stripe: '#10b981', badge: 'rgba(16,185,129,0.15)',  label: '#34d399' },
  deprecated:  { stripe: '#ef4444', badge: 'rgba(239,68,68,0.15)',   label: '#f87171' },
}

const EDGE_COLORS: Record<string, string> = {
  engineering:  '#60a5fa',
  architecture: '#c084fc',
  both:         '#f472b6',
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high:      'solid',
  medium:    'dashed',
  uncertain: 'dotted',
}

// ------------------------------------------------------------
// NODE
// ------------------------------------------------------------

export const RepoNode = memo(function RepoNode(props: NodeProps<RFNodeData>) {
  const { data, selected } = props
  const [expanded,          setExpanded]          = useState(false)
  const [fictionalExpanded, setFictionalExpanded] = useState(false)

  const colors         = TYPE_COLORS[data.nodeType] ?? TYPE_COLORS.module
  const statusTag      = data.statusTag as string | undefined
  const status         = statusTag ? STATUS_TAG_COLORS[statusTag] : null
  const isBranch       = data.isBranchNode === true
  const fictionalFiles = data.fictionalFiles ?? []
  const hasFictional   = fictionalFiles.length > 0

  const canExpand =
    (data.nodeType === 'module' || data.nodeType === 'layer') &&
    Array.isArray(data.files) &&
    data.files.length > 0

  // Left border: status stripe > branch dashed > normal
  const borderLeft = status
    ? `3.5px solid ${status.stripe}`
    : isBranch
    ? `3px dashed ${colors.border}`
    : `1.5px solid ${colors.border}`

  const borderMain = selected
    ? '1.5px solid #f9fafb'
    : isBranch
    ? `1.5px dashed ${colors.border}`
    : `1.5px solid ${colors.border}`

  return (
    <div
      style={{
        background:   colors.bg,
        border:       borderMain,
        borderLeft,
        borderRadius: 10,
        padding:      '10px 14px',
        minWidth:     180,
        maxWidth:     260,
        position:     'relative',
        fontFamily:   '"JetBrains Mono", monospace',
        cursor:       'grab',
        boxShadow:    isBranch ? '0 0 0 1px rgba(96,165,250,0.12)' : undefined,
      }}
    >
      {/* Branch badge */}
      {isBranch && (
        <div
          title="Added in branch"
          style={{
            position:      'absolute',
            top:           -8,
            right:         8,
            fontSize:      8,
            fontWeight:    700,
            background:    '#1e3a5f',
            color:         '#60a5fa',
            border:        '1px solid #2a4a7f',
            borderRadius:  3,
            padding:       '1px 5px',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            lineHeight:    1.6,
            pointerEvents: 'none',
          }}
        >
          branch
        </div>
      )}

      {/* Branch node description */}
      {isBranch && data.description && (
        <div
          title={data.description}
          style={{
            fontSize:     9,
            color:        '#60a5fa',
            opacity:      0.7,
            marginBottom: 4,
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
          }}
        >
          {data.description}
        </div>
      )}

      {/* Header: type badge + file count */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize:      10,
            fontWeight:    700,
            textTransform: 'uppercase',
            background:    colors.badge,
            color:         '#fff',
            padding:       '2px 6px',
            borderRadius:  4,
          }}
        >
          {data.nodeType}
        </span>

        {canExpand ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((p) => !p) }}
            style={{
              fontSize:     10,
              color:        expanded ? colors.border : '#94a3b8',
              background:   expanded ? colors.bg : 'transparent',
              border:       `1px solid ${expanded ? colors.border : '#334155'}`,
              borderRadius: 4,
              padding:      '2px 6px',
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              gap:          3,
            }}
          >
            <span style={{ fontSize: 9 }}>{expanded ? '▲' : '▼'}</span>
            {data.fileCount} files
          </button>
        ) : (
          <span style={{ fontSize: 10, color: '#94a3b8' }}>{data.fileCount} files</span>
        )}
      </div>

      {/* Label */}
      <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600 }}>{data.label}</div>

      {/* Detected role */}
      {data.detectedRole && (
        <div style={{ fontSize: 10, color: '#94a3b8' }}>{data.detectedRole}</div>
      )}

      {/* Status tag badge */}
      {status && (
        <div
          style={{
            display:      'inline-flex',
            alignItems:   'center',
            gap:          4,
            marginTop:    5,
            background:   status.badge,
            borderRadius: 4,
            padding:      '1px 6px',
          }}
        >
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: status.stripe, flexShrink: 0 }} />
          <span style={{ fontSize: 9, color: status.label, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {statusTag?.replace('_', ' ')}
          </span>
        </div>
      )}

      {/* Complexity dot */}
      {data.complexity && (
        <div
          style={{
            position:     'absolute',
            top:          10,
            right:        10,
            width:        7,
            height:       7,
            borderRadius: '50%',
            background:
              data.complexity === 'high'   ? '#f87171' :
              data.complexity === 'medium' ? '#fbbf24' : '#4ade80',
          }}
        />
      )}

      {/* Real files list */}
      {expanded && canExpand && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${colors.border}30`, paddingTop: 6 }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(data.files as string[]).map((file) => (
              <li
                key={file}
                title={file}
                style={{
                  fontSize:     9,
                  color:        '#94a3b8',
                  padding:      '2px 4px',
                  borderRadius: 3,
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace:   'nowrap',
                  background:   'rgba(255,255,255,0.03)',
                }}
              >
                {'› '}{file.split('/').pop()}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Fictional files */}
      {hasFictional && (
        <div style={{ marginTop: 8, borderTop: '1px solid rgba(96,165,250,0.12)', paddingTop: 5 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setFictionalExpanded((p) => !p) }}
            style={{
              display:      'flex',
              alignItems:   'center',
              gap:          5,
              background:   'none',
              border:       'none',
              cursor:       'pointer',
              padding:      0,
              color:        '#60a5fa',
              fontSize:     9,
              fontFamily:   'inherit',
              letterSpacing: '0.06em',
            }}
          >
            <span style={{ opacity: 0.6 }}>{fictionalExpanded ? '▲' : '▼'}</span>
            {fictionalFiles.length} planned file{fictionalFiles.length !== 1 ? 's' : ''}
          </button>

          {fictionalExpanded && (
            <ul style={{ listStyle: 'none', margin: '5px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {fictionalFiles.map((f) => (
                <li
                  key={f.id}
                  style={{
                    fontSize:     9,
                    background:   'rgba(96,165,250,0.06)',
                    border:       '1px dashed rgba(96,165,250,0.2)',
                    borderRadius: 4,
                    padding:      '3px 6px',
                  }}
                >
                  <div style={{ color: '#93c5fd', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ✦ {f.name}
                  </div>
                  {f.description && (
                    <div style={{ color: '#4b5563', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.description}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Handle type="target" position={Position.Top}    style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
})

// ------------------------------------------------------------
// EDGE
// ------------------------------------------------------------

export const RepoEdge = memo(function RepoEdge(props: EdgeProps<RFEdgeData>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props

  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  })

  if (!data) return null

  const color           = EDGE_COLORS[data.edgeType] ?? '#64748b'
  const dashStyle       = CONFIDENCE_STYLE[data.confidence] ?? 'solid'
  const baseDash        = dashStyle === 'dashed' ? '6,4' : dashStyle === 'dotted' ? '2,4' : undefined
  const strokeDasharray = data.isBranchEdge ? (baseDash ?? '8,3') : baseDash
  const strokeWidth     = Math.max(1, data.strength * 0.6) * (data.isBranchEdge ? 1.3 : 1)
  const opacity         = data.confidence === 'uncertain' ? 0.45 : data.isBranchEdge ? 1 : 0.8

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke:          color,
        strokeWidth,
        strokeDasharray,
        opacity,
        filter: data.isBranchEdge ? `drop-shadow(0 0 3px ${color}55)` : undefined,
      }}
    />
  )
})

// ------------------------------------------------------------
// exports
// ------------------------------------------------------------

export const nodeTypes = { repoNode: RepoNode } as const
export const edgeTypes = { repoEdge: RepoEdge } as const