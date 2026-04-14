'use client'

import { memo } from 'react'
import { Handle, Position, BaseEdge, getSmoothStepPath } from '@xyflow/react'
import type { NodeProps, EdgeProps } from '@xyflow/react'
import type { RFNodeData, RFEdgeData } from './graphLayout'
import type { Node } from '@xyflow/react'
import type { Edge } from '@xyflow/react'

// ------------------------------------------------------------
// Color palette
// ------------------------------------------------------------

const TYPE_COLORS: Record<string, { border: string; bg: string; badge: string }> = {
  layer: {
    border: '#60a5fa',
    bg: 'rgba(96,165,250,0.08)',
    badge: '#1d4ed8',
  },
  module: {
    border: '#a78bfa',
    bg: 'rgba(167,139,250,0.08)',
    badge: '#6d28d9',
  },
  file: {
    border: '#34d399',
    bg: 'rgba(52,211,153,0.08)',
    badge: '#065f46',
  },
  component: {
    border: '#fb923c',
    bg: 'rgba(251,146,60,0.08)',
    badge: '#9a3412',
  },
}

// ------------------------------------------------------------
// Status tags
// ------------------------------------------------------------

const STATUS_TAG_COLORS: Record<string, { stripe: string; badge: string; label: string }> = {
  legacy: { stripe: '#f59e0b', badge: 'rgba(245,158,11,0.15)', label: '#f59e0b' },
  in_refactor: { stripe: '#3b82f6', badge: 'rgba(59,130,246,0.15)', label: '#60a5fa' },
  stable: { stripe: '#10b981', badge: 'rgba(16,185,129,0.15)', label: '#34d399' },
  deprecated: { stripe: '#ef4444', badge: 'rgba(239,68,68,0.15)', label: '#f87171' },
}

const STATUS_TAG_LABELS: Record<string, string> = {
  legacy: 'legacy',
  in_refactor: 'refactor',
  stable: 'stable',
  deprecated: 'deprecated',
}

// ------------------------------------------------------------
// Edge styles
// ------------------------------------------------------------

const EDGE_COLORS: Record<string, string> = {
  engineering: '#60a5fa',
  architecture: '#c084fc',
  both: '#f472b6',
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: 'solid',
  medium: 'dashed',
  uncertain: 'dotted',
}

// ------------------------------------------------------------
// RepoNode
// ------------------------------------------------------------

export const RepoNode = memo(function RepoNode(
  { data, selected }: NodeProps<Node<RFNodeData>>
) {
  const colors = TYPE_COLORS[data.nodeType] ?? TYPE_COLORS.module

  const statusTag = data.statusTag
  const status = statusTag ? STATUS_TAG_COLORS[statusTag] : null

  return (
    <div
      style={{
        background: colors.bg,
        border: `1.5px solid ${selected ? '#f9fafb' : colors.border}`,
        borderLeft: status
          ? `3.5px solid ${status.stripe}`
          : `1.5px solid ${selected ? '#f9fafb' : colors.border}`,
        borderRadius: 10,
        padding: '10px 14px',
        paddingLeft: status ? 12 : 14,
        minWidth: 180,
        maxWidth: 220,
        boxShadow: selected
          ? `0 0 0 2px ${colors.border}, 0 4px 20px rgba(0,0,0,0.4)`
          : '0 2px 8px rgba(0,0,0,0.25)',
        cursor: 'grab',
        fontFamily: '"JetBrains Mono", monospace',
        position: 'relative',
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            background: colors.badge,
            color: '#f8fafc',
            padding: '2px 7px',
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#f1f5f9',
            flex: 1,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
          title={data.label}
        >
          {data.label}
        </div>

        {status && statusTag && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase',
              background: status.badge,
              color: status.label,
              padding: '1px 5px',
              borderRadius: 3,
              border: `1px solid ${status.stripe}`,
            }}
          >
            {STATUS_TAG_LABELS[statusTag] ?? statusTag}
          </span>
        )}
      </div>

      {/* Role */}
      {data.detectedRole && data.detectedRole !== 'unknown' && (
        <div style={{ fontSize: 10, color: '#94a3b8' }}>
          {data.detectedRole}
        </div>
      )}

      {/* Complexity */}
      {data.complexity && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background:
              data.complexity === 'high'
                ? '#f87171'
                : data.complexity === 'medium'
                ? '#fbbf24'
                : '#4ade80',
          }}
        />
      )}

      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
})

// ------------------------------------------------------------
// RepoEdge
// ------------------------------------------------------------

export const RepoEdge = memo(function RepoEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<Edge<RFEdgeData>>) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  })

  if (!data) return null

  const color = EDGE_COLORS[data.edgeType] ?? '#64748b'
  const dashStyle = CONFIDENCE_STYLE[data.confidence]
  const opacity = data.confidence === 'uncertain' ? 0.45 : 0.8
  const width = Math.max(1, data.strength * 0.6)

  const strokeDasharray =
    dashStyle === 'dashed'
      ? '6,4'
      : dashStyle === 'dotted'
      ? '2,4'
      : undefined

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke: color,
        strokeWidth: width,
        strokeDasharray,
        opacity,
      }}
    />
  )
})

// ------------------------------------------------------------
// exports
// ------------------------------------------------------------

export const nodeTypes = { repoNode: RepoNode } as const
export const edgeTypes = { repoEdge: RepoEdge } as const