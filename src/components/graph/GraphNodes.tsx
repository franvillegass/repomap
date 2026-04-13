'use client'

import { memo } from 'react'
import { Handle, Position, BaseEdge, getSmoothStepPath } from '@xyflow/react'
import type { NodeProps, EdgeProps } from '@xyflow/react'
import type { RFNodeData, RFEdgeData } from './graphLayout'

// ------------------------------------------------------------
// Color palette (CSS variable-compatible for light/dark)
// ------------------------------------------------------------

const TYPE_COLORS: Record<string, { border: string; bg: string; badge: string }> = {
  layer: {
    border: '#60a5fa',   // blue-400
    bg:     'rgba(96,165,250,0.08)',
    badge:  '#1d4ed8',
  },
  module: {
    border: '#a78bfa',   // violet-400
    bg:     'rgba(167,139,250,0.08)',
    badge:  '#6d28d9',
  },
  file: {
    border: '#34d399',   // emerald-400
    bg:     'rgba(52,211,153,0.08)',
    badge:  '#065f46',
  },
  component: {
    border: '#fb923c',   // orange-400
    bg:     'rgba(251,146,60,0.08)',
    badge:  '#9a3412',
  },
}

const EDGE_COLORS: Record<string, string> = {
  engineering: '#60a5fa',   // blue
  architecture: '#c084fc',  // purple
  both:         '#f472b6',  // pink
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high:      'solid',
  medium:    'dashed',
  uncertain: 'dotted',
}

// ------------------------------------------------------------
// RepoNode — single custom node for all types
// ------------------------------------------------------------

export const RepoNode = memo(function RepoNode({ data, selected }: NodeProps<RFNodeData>) {
  const colors = TYPE_COLORS[data.nodeType] ?? TYPE_COLORS.module

  return (
    <div
      style={{
        background:   colors.bg,
        border:       `1.5px ${selected ? 'solid' : 'solid'} ${selected ? '#f9fafb' : colors.border}`,
        borderRadius: 10,
        padding:      '10px 14px',
        minWidth:     180,
        maxWidth:     220,
        boxShadow:    selected
          ? `0 0 0 2px ${colors.border}, 0 4px 20px rgba(0,0,0,0.4)`
          : '0 2px 8px rgba(0,0,0,0.25)',
        cursor:       'grab',
        fontFamily:   '"JetBrains Mono", "Fira Mono", monospace',
        transition:   'box-shadow 0.15s ease',
      }}
    >
      {/* Top row: type badge + file count */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span
          style={{
            fontSize:     10,
            fontWeight:   700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            background:   colors.badge,
            color:        '#f8fafc',
            padding:      '2px 7px',
            borderRadius: 4,
          }}
        >
          {data.nodeType}
        </span>
        {data.fileCount > 0 && (
          <span style={{ fontSize: 10, color: '#94a3b8' }}>
            {data.fileCount} {data.fileCount === 1 ? 'file' : 'files'}
          </span>
        )}
      </div>

      {/* Label */}
      <div
        style={{
          fontSize:     13,
          fontWeight:   600,
          color:        '#f1f5f9',
          lineHeight:   1.3,
          marginBottom: data.detectedRole ? 4 : 0,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}
        title={data.label}
      >
        {data.label}
      </div>

      {/* Detected role */}
      {data.detectedRole && data.detectedRole !== 'unknown' && (
        <div
          style={{
            fontSize:  10,
            color:     '#94a3b8',
            overflow:  'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={data.detectedRole}
        >
          {data.detectedRole}
        </div>
      )}

      {/* Complexity dot */}
      {data.complexity && (
        <div
          style={{
            position:   'absolute',
            top:        10,
            right:      10,
            width:      7,
            height:     7,
            borderRadius: '50%',
            background: data.complexity === 'high'
              ? '#f87171'
              : data.complexity === 'medium'
              ? '#fbbf24'
              : '#4ade80',
          }}
          title={`Complexity: ${data.complexity}`}
        />
      )}

      <Handle type="target" position={Position.Top}    style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left}   style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right}  style={{ opacity: 0 }} />
    </div>
  )
})

// ------------------------------------------------------------
// RepoEdge — styled edge by type + confidence
// ------------------------------------------------------------

export const RepoEdge = memo(function RepoEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data, markerEnd,
}: EdgeProps<RFEdgeData>) {
  const [edgePath] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  })

  if (!data) return null

  const color     = EDGE_COLORS[data.edgeType] ?? '#64748b'
  const dashStyle = CONFIDENCE_STYLE[data.confidence] ?? 'solid'
  const opacity   = data.confidence === 'uncertain' ? 0.45 : 0.8
  const width     = Math.max(1, data.strength * 0.6)

  const strokeDasharray =
    dashStyle === 'dashed' ? '6,4' :
    dashStyle === 'dotted' ? '2,4' :
    undefined

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke:           color,
        strokeWidth:      width,
        strokeDasharray,
        opacity,
      }}
    />
  )
})

// ------------------------------------------------------------
// nodeTypes / edgeTypes maps for React Flow
// ------------------------------------------------------------

export const nodeTypes = { repoNode: RepoNode } as const
export const edgeTypes = { repoEdge: RepoEdge } as const