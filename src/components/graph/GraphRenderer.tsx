'use client'

import { useMemo, useCallback } from 'react'
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { RepoGraph } from '@/lib/pipeline/schemas/graph'
import { buildReactFlowGraph } from './graphLayout'
import { nodeTypes, edgeTypes } from './GraphNodes'

// ------------------------------------------------------------
// Props
// ------------------------------------------------------------

interface GraphRendererProps {
  graph: RepoGraph
  /** Called whenever the user makes a manual edit */
  onOverlayChange?: (patch: Partial<RepoGraph['overlay']>) => void
}

// ------------------------------------------------------------
// Component
// ------------------------------------------------------------

export default function GraphRenderer({ graph, onOverlayChange }: GraphRendererProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildReactFlowGraph(graph),
    [graph],
  )

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, type: 'repoEdge' }, eds))
    },
    [setEdges],
  )

  return (
    <div
      style={{
        width:      '100%',
        height:     '100%',
        background: '#0b0f1a',
        position:   'relative',
        fontFamily: '"JetBrains Mono", "Fira Mono", monospace',
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={2.5}
        defaultEdgeOptions={{ type: 'repoEdge' }}
        proOptions={{ hideAttribution: true }}
      >
        {/* Dot grid background */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.5}
          color="#1e2a3a"
        />

        {/* Pan/zoom controls */}
        <Controls
          style={{
            background:   '#0f172a',
            border:       '1px solid #1e293b',
            borderRadius: 8,
          }}
        />

        {/* Minimap */}
        <MiniMap
          style={{
            background:   '#0f172a',
            border:       '1px solid #1e293b',
            borderRadius: 8,
          }}
          nodeColor={(n) => {
            const type = (n.data as { nodeType?: string }).nodeType
            return type === 'layer'     ? '#60a5fa'
              : type === 'module'   ? '#a78bfa'
              : type === 'file'     ? '#34d399'
              : '#fb923c'
          }}
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>

      {/* Header badge */}
      <div
        style={{
          position:     'absolute',
          top:          16,
          left:         16,
          background:   'rgba(15,23,42,0.9)',
          border:       '1px solid #1e293b',
          borderRadius: 8,
          padding:      '8px 14px',
          backdropFilter: 'blur(8px)',
          zIndex:       10,
        }}
      >
        <div style={{ fontSize: 11, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {graph.meta.detectedPattern.replace(/_/g, ' ')}
        </div>
        <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600, marginTop: 2 }}>
          {graph.meta.repoName}
        </div>
        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
          confidence {Math.round(graph.meta.patternConfidence * 100)}%
        </div>
      </div>

      {/* Legend */}
      <Legend />
    </div>
  )
}

// ------------------------------------------------------------
// Legend
// ------------------------------------------------------------

function Legend() {
  return (
    <div
      style={{
        position:     'absolute',
        bottom:       16,
        left:         16,
        background:   'rgba(15,23,42,0.9)',
        border:       '1px solid #1e293b',
        borderRadius: 8,
        padding:      '10px 14px',
        backdropFilter: 'blur(8px)',
        zIndex:       10,
        display:      'flex',
        gap:          20,
      }}
    >
      {/* Node types */}
      <div>
        <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
          Nodes
        </div>
        {[
          { label: 'Layer',     color: '#60a5fa' },
          { label: 'Module',    color: '#a78bfa' },
          { label: 'File',      color: '#34d399' },
          { label: 'Component', color: '#fb923c' },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.9 }} />
            <span style={{ fontSize: 10, color: '#94a3b8' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Edge types */}
      <div>
        <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
          Edges
        </div>
        {[
          { label: 'Engineering',   color: '#60a5fa', dash: undefined },
          { label: 'Architecture',  color: '#c084fc', dash: undefined },
          { label: 'Both',          color: '#f472b6', dash: undefined },
          { label: 'Uncertain',     color: '#64748b', dash: '4,3'    },
        ].map(({ label, color, dash }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <svg width={22} height={10}>
              <line
                x1={0} y1={5} x2={22} y2={5}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray={dash}
              />
            </svg>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Complexity dots */}
      <div>
        <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
          Complexity
        </div>
        {[
          { label: 'Low',    color: '#4ade80' },
          { label: 'Medium', color: '#fbbf24' },
          { label: 'High',   color: '#f87171' },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
            <span style={{ fontSize: 10, color: '#94a3b8' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}