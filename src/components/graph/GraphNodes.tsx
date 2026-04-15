'use client'

import { memo } from 'react'
import {
  Handle,
  Position,
  BaseEdge,
  getSmoothStepPath,
} from '@xyflow/react'

import type { NodeProps, EdgeProps } from '@xyflow/react'
import type { RFNodeData, RFEdgeData } from './graphLayout'

// ------------------------------------------------------------
// Colors
// ------------------------------------------------------------

const TYPE_COLORS: Record<
  string,
  { border: string; bg: string; badge: string }
> = {
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

const STATUS_TAG_COLORS: Record<
  string,
  { stripe: string; badge: string; label: string }
> = {
  legacy: {
    stripe: '#f59e0b',
    badge: 'rgba(245,158,11,0.15)',
    label: '#f59e0b',
  },
  in_refactor: {
    stripe: '#3b82f6',
    badge: 'rgba(59,130,246,0.15)',
    label: '#60a5fa',
  },
  stable: {
    stripe: '#10b981',
    badge: 'rgba(16,185,129,0.15)',
    label: '#34d399',
  },
  deprecated: {
    stripe: '#ef4444',
    badge: 'rgba(239,68,68,0.15)',
    label: '#f87171',
  },
}

const STATUS_TAG_LABELS: Record<string, string> = {
  legacy: 'legacy',
  in_refactor: 'refactor',
  stable: 'stable',
  deprecated: 'deprecated',
}

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
// NODE
// ------------------------------------------------------------

export const RepoNode = memo(function RepoNode(
  props: NodeProps<RFNodeData>
) {
  const { data, selected } = props

  const colors = TYPE_COLORS[data.nodeType] ?? TYPE_COLORS.module

  const statusTag = data.statusTag as string | undefined
  const status = statusTag ? STATUS_TAG_COLORS[statusTag] : null

  return (
    <div
      style={{
        background: colors.bg,
        border: `1.5px solid ${
          selected ? '#f9fafb' : colors.border
        }`,
        borderLeft: status
          ? `3.5px solid ${status.stripe}`
          : `1.5px solid ${colors.border}`,
        borderRadius: 10,
        padding: '10px 14px',
        minWidth: 180,
        maxWidth: 220,
        position: 'relative',
        fontFamily: '"JetBrains Mono", monospace',
        cursor: 'grab',
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            background: colors.badge,
            color: '#fff',
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          {data.nodeType}
        </span>

        <span style={{ fontSize: 10, color: '#94a3b8' }}>
          {data.fileCount} files
        </span>
      </div>

      {/* label */}
      <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600 }}>
        {data.label}
      </div>

      {/* role */}
      {data.detectedRole && (
        <div style={{ fontSize: 10, color: '#94a3b8' }}>
          {data.detectedRole}
        </div>
      )}

      {/* complexity dot */}
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
    </div>
  )
})

// ------------------------------------------------------------
// EDGE
// ------------------------------------------------------------

export const RepoEdge = memo(function RepoEdge(
  props: EdgeProps<RFEdgeData>
) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    markerEnd,
  } = props

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
  const style = CONFIDENCE_STYLE[data.confidence] ?? 'solid'

  const strokeDasharray =
    style === 'dashed'
      ? '6,4'
      : style === 'dotted'
      ? '2,4'
      : undefined

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke: color,
        strokeWidth: Math.max(1, data.strength * 0.6),
        strokeDasharray,
        opacity: data.confidence === 'uncertain' ? 0.45 : 0.8,
      }}
    />
  )
})

// ------------------------------------------------------------
// exports
// ------------------------------------------------------------

export const nodeTypes = { repoNode: RepoNode } as const
export const edgeTypes = { repoEdge: RepoEdge } as const