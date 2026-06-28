import { memo, useState, createContext, useMemo, useRef, useCallback, useEffect, useReducer, useContext } from 'react';
import { Handle, Position, getSmoothStepPath, BaseEdge, useNodesState, useEdgesState, addEdge, ReactFlow, Background, BackgroundVariant, Controls, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { jsxs, jsx, Fragment } from 'react/jsx-runtime';
import { openDB } from 'idb';

// src/components/graph/GraphRenderer.tsx

// src/components/graph/graphLayout.ts
function buildReactFlowGraph(graph) {
  const { nodes, edges, overlay, meta } = graph;
  const mergedNodes = nodes.map((n) => {
    const ov = overlay.nodeOverrides[n.id];
    return ov ? { ...n, label: ov.customLabel ?? n.label } : n;
  });
  const allNodes = [...mergedNodes, ...overlay.manualNodes];
  const allEdges = [...edges, ...overlay.manualEdges];
  const visibleEdges = allEdges.filter(
    (e) => !overlay.edgeOverrides[e.id]?.hidden
  );
  const positions = computePositions(allNodes, meta.layoutTemplate);
  const rfNodes = allNodes.map((node) => ({
    id: node.id,
    type: "repoNode",
    position: positions[node.id] ?? { x: 0, y: 0 },
    data: {
      label: node.label,
      nodeType: node.type,
      detectedRole: node.detectedRole,
      patterns: node.patterns,
      fileCount: node.files.length,
      files: node.files,
      complexity: node.metadata.complexity,
      depth: node.depth
    }
  }));
  const rfEdges = visibleEdges.map((edge) => {
    const ov = overlay.edgeOverrides[edge.id];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "repoEdge",
      label: ov?.customLabel ?? edge.label,
      data: {
        edgeType: ov?.customEdgeType ?? edge.edgeType,
        confidence: edge.confidence,
        strength: edge.strength
      }
    };
  });
  return { nodes: rfNodes, edges: rfEdges };
}
function buildReactFlowGraphFromResolved(resolved, layoutTemplate) {
  const layoutNodes = resolved.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    parentId: n.parentId,
    depth: n.depth,
    files: n.files,
    detectedRole: n.detectedRole,
    patterns: n.patterns,
    metadata: n.metadata
  }));
  const positions = computePositions(layoutNodes, layoutTemplate);
  const rfNodes = resolved.nodes.map((node) => ({
    id: node.id,
    type: "repoNode",
    position: positions[node.id] ?? { x: 0, y: 0 },
    data: {
      label: node.label,
      nodeType: node.type,
      detectedRole: node.detectedRole,
      patterns: node.patterns,
      fileCount: node.files.length,
      files: node.files,
      complexity: node.metadata?.complexity,
      depth: node.depth,
      description: node.description,
      fictionalFiles: node.fictionalFiles,
      // Visual markers for branch-added nodes
      isBranchNode: node.origin !== "base",
      branchOrigin: node.origin !== "base" ? node.origin : void 0
    }
  }));
  const rfEdges = resolved.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "repoEdge",
    label: edge.label,
    data: {
      edgeType: edge.edgeType,
      confidence: edge.confidence,
      strength: edge.strength,
      isBranchEdge: edge.origin !== "base"
    }
  }));
  return { nodes: rfNodes, edges: rfEdges };
}
var NODE_WIDTH = 200;
var NODE_HEIGHT = 80;
var H_GAP = 60;
var V_GAP = 80;
function computePositions(nodes, layout) {
  switch (layout) {
    case "vertical_layers":
      return verticalLayers(nodes);
    case "horizontal_three_column":
      return horizontalThreeColumn(nodes);
    case "concentric_rings":
      return concentricRings(nodes);
    case "left_right_flow":
      return leftRightFlow(nodes);
    case "grid_clusters":
    case "cluster":
      return gridClusters(nodes);
    default:
      return forceDirectedSeed(nodes);
  }
}
function verticalLayers(nodes) {
  const byDepth = {};
  for (const n of nodes) {
    (byDepth[n.depth] ??= []).push(n);
  }
  const result = {};
  for (const [depthStr, group] of Object.entries(byDepth)) {
    const depth = Number(depthStr);
    const totalW = group.length * (NODE_WIDTH + H_GAP) - H_GAP;
    const startX = -totalW / 2;
    group.forEach((n, i) => {
      result[n.id] = {
        x: startX + i * (NODE_WIDTH + H_GAP),
        y: depth * (NODE_HEIGHT + V_GAP) * 2
      };
    });
  }
  return result;
}
function horizontalThreeColumn(nodes) {
  const col0 = nodes.filter((n) => n.depth === 0);
  const col1 = nodes.filter((n) => n.depth === 1);
  const col2 = nodes.filter((n) => n.depth >= 2);
  const result = {};
  const colX = [0, NODE_WIDTH + H_GAP * 4, (NODE_WIDTH + H_GAP * 4) * 2];
  [col0, col1, col2].forEach((group, col) => {
    group.forEach((n, i) => {
      result[n.id] = { x: colX[col], y: i * (NODE_HEIGHT + V_GAP) };
    });
  });
  return result;
}
function concentricRings(nodes) {
  const byDepth = {};
  for (const n of nodes) {
    (byDepth[n.depth] ??= []).push(n);
  }
  const result = {};
  const RING_RADIUS = 260;
  for (const [depthStr, group] of Object.entries(byDepth)) {
    const depth = Number(depthStr);
    const radius = depth === 0 ? 0 : depth * RING_RADIUS;
    if (depth === 0 && group.length === 1) {
      result[group[0].id] = { x: 0, y: 0 };
      continue;
    }
    const step = 2 * Math.PI / group.length;
    group.forEach((n, i) => {
      result[n.id] = {
        x: Math.round(radius * Math.cos(i * step - Math.PI / 2)),
        y: Math.round(radius * Math.sin(i * step - Math.PI / 2))
      };
    });
  }
  return result;
}
function leftRightFlow(nodes) {
  const byDepth = {};
  for (const n of nodes) {
    (byDepth[n.depth] ??= []).push(n);
  }
  const result = {};
  for (const [depthStr, group] of Object.entries(byDepth)) {
    const depth = Number(depthStr);
    const totalH = group.length * (NODE_HEIGHT + V_GAP) - V_GAP;
    const startY = -totalH / 2;
    group.forEach((n, i) => {
      result[n.id] = {
        x: depth * (NODE_WIDTH + H_GAP * 3),
        y: startY + i * (NODE_HEIGHT + V_GAP)
      };
    });
  }
  return result;
}
function gridClusters(nodes) {
  const modules = nodes.filter((n) => n.depth <= 1);
  const files = nodes.filter((n) => n.depth >= 2);
  const COLS = Math.ceil(Math.sqrt(modules.length));
  const CELL_W = NODE_WIDTH * 3;
  const CELL_H = NODE_HEIGHT * 5;
  const result = {};
  const modulePos = {};
  modules.forEach((n, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    modulePos[n.id] = { x: col * CELL_W, y: row * CELL_H };
    result[n.id] = modulePos[n.id];
  });
  const childrenByParent = {};
  for (const f of files) {
    (childrenByParent[f.parentId ?? "__root"] ??= []).push(f);
  }
  for (const [parentId, children] of Object.entries(childrenByParent)) {
    const origin = modulePos[parentId] ?? { x: 0, y: 0 };
    children.forEach((n, i) => {
      result[n.id] = {
        x: origin.x + i % 3 * (NODE_WIDTH + H_GAP),
        y: origin.y + NODE_HEIGHT + V_GAP + Math.floor(i / 3) * (NODE_HEIGHT + V_GAP)
      };
    });
  }
  return result;
}
function forceDirectedSeed(nodes) {
  const COLS = Math.ceil(Math.sqrt(nodes.length));
  const result = {};
  nodes.forEach((n, i) => {
    result[n.id] = {
      x: i % COLS * (NODE_WIDTH + H_GAP * 2),
      y: Math.floor(i / COLS) * (NODE_HEIGHT + V_GAP * 2)
    };
  });
  return result;
}
var TYPE_COLORS = {
  layer: { border: "#60a5fa", bg: "rgba(96,165,250,0.08)", badge: "#1d4ed8" },
  module: { border: "#a78bfa", bg: "rgba(167,139,250,0.08)", badge: "#6d28d9" },
  file: { border: "#34d399", bg: "rgba(52,211,153,0.08)", badge: "#065f46" },
  component: { border: "#fb923c", bg: "rgba(251,146,60,0.08)", badge: "#9a3412" }
};
var STATUS_TAG_COLORS = {
  legacy: { stripe: "#f59e0b", badge: "rgba(245,158,11,0.15)", label: "#f59e0b" },
  in_refactor: { stripe: "#3b82f6", badge: "rgba(59,130,246,0.15)", label: "#60a5fa" },
  stable: { stripe: "#10b981", badge: "rgba(16,185,129,0.15)", label: "#34d399" },
  deprecated: { stripe: "#ef4444", badge: "rgba(239,68,68,0.15)", label: "#f87171" }
};
var EDGE_COLORS = {
  engineering: "#60a5fa",
  architecture: "#c084fc",
  both: "#f472b6"
};
var CONFIDENCE_STYLE = {
  high: "solid",
  medium: "dashed",
  uncertain: "dotted"
};
var RepoNode = memo(function RepoNode2(props) {
  const { data, selected } = props;
  const nodeData = data;
  const [expanded, setExpanded] = useState(false);
  const [fictionalExpanded, setFictionalExpanded] = useState(false);
  const colors = TYPE_COLORS[nodeData.nodeType] ?? TYPE_COLORS.module;
  const statusTag = nodeData.statusTag;
  const status = statusTag ? STATUS_TAG_COLORS[statusTag] : null;
  const isBranch = nodeData.isBranchNode === true;
  const fictionalFiles = nodeData.fictionalFiles ?? [];
  const hasFictional = fictionalFiles.length > 0;
  const canExpand = (nodeData.nodeType === "module" || nodeData.nodeType === "layer") && Array.isArray(nodeData.files) && nodeData.files.length > 0;
  const borderLeft = status ? `3.5px solid ${status.stripe}` : isBranch ? `3px dashed ${colors.border}` : `1.5px solid ${colors.border}`;
  const borderMain = selected ? "1.5px solid #f9fafb" : isBranch ? `1.5px dashed ${colors.border}` : `1.5px solid ${colors.border}`;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      style: {
        background: colors.bg,
        borderTop: borderMain,
        borderRight: borderMain,
        borderBottom: borderMain,
        borderLeft,
        borderRadius: 10,
        padding: "10px 14px",
        minWidth: 180,
        maxWidth: 260,
        position: "relative",
        fontFamily: '"JetBrains Mono", monospace',
        cursor: "grab",
        boxShadow: isBranch ? "0 0 0 1px rgba(96,165,250,0.12)" : void 0
      },
      children: [
        isBranch && /* @__PURE__ */ jsx(
          "div",
          {
            title: "Added in branch",
            style: {
              position: "absolute",
              top: -8,
              right: 8,
              fontSize: 8,
              fontWeight: 700,
              background: "#1e3a5f",
              color: "#60a5fa",
              border: "1px solid #2a4a7f",
              borderRadius: 3,
              padding: "1px 5px",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              lineHeight: 1.6,
              pointerEvents: "none"
            },
            children: "branch"
          }
        ),
        isBranch && nodeData.description && /* @__PURE__ */ jsx(
          "div",
          {
            title: nodeData.description,
            style: {
              fontSize: 9,
              color: "#60a5fa",
              opacity: 0.7,
              marginBottom: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            },
            children: data.description
          }
        ),
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
          /* @__PURE__ */ jsx(
            "span",
            {
              style: {
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                background: colors.badge,
                color: "#fff",
                padding: "2px 6px",
                borderRadius: 4
              },
              children: data.nodeType
            }
          ),
          canExpand ? /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: (e) => {
                e.stopPropagation();
                setExpanded((p) => !p);
              },
              style: {
                fontSize: 10,
                color: expanded ? colors.border : "#94a3b8",
                background: expanded ? colors.bg : "transparent",
                border: `1px solid ${expanded ? colors.border : "#334155"}`,
                borderRadius: 4,
                padding: "2px 6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 3
              },
              children: [
                /* @__PURE__ */ jsx("span", { style: { fontSize: 9 }, children: expanded ? "\u25B2" : "\u25BC" }),
                data.fileCount,
                " files"
              ]
            }
          ) : /* @__PURE__ */ jsxs("span", { style: { fontSize: 10, color: "#94a3b8" }, children: [
            data.fileCount,
            " files"
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { style: { marginTop: 6, fontSize: 13, fontWeight: 600 }, children: data.label }),
        data.detectedRole && /* @__PURE__ */ jsx("div", { style: { fontSize: 10, color: "#94a3b8" }, children: data.detectedRole }),
        status && /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              marginTop: 5,
              background: status.badge,
              borderRadius: 4,
              padding: "1px 6px"
            },
            children: [
              /* @__PURE__ */ jsx("div", { style: { width: 5, height: 5, borderRadius: "50%", background: status.stripe, flexShrink: 0 } }),
              /* @__PURE__ */ jsx("span", { style: { fontSize: 9, color: status.label, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }, children: statusTag?.replace("_", " ") })
            ]
          }
        ),
        data.complexity && /* @__PURE__ */ jsx(
          "div",
          {
            style: {
              position: "absolute",
              top: 10,
              right: 10,
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: data.complexity === "high" ? "#f87171" : data.complexity === "medium" ? "#fbbf24" : "#4ade80"
            }
          }
        ),
        expanded && canExpand && /* @__PURE__ */ jsx("div", { style: { marginTop: 8, borderTop: `1px solid ${colors.border}30`, paddingTop: 6 }, children: /* @__PURE__ */ jsx("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }, children: data.files.map((file) => /* @__PURE__ */ jsxs(
          "li",
          {
            title: file,
            style: {
              fontSize: 9,
              color: "#94a3b8",
              padding: "2px 4px",
              borderRadius: 3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              background: "rgba(255,255,255,0.03)"
            },
            children: [
              "\u203A ",
              file.split("/").pop()
            ]
          },
          file
        )) }) }),
        hasFictional && /* @__PURE__ */ jsxs("div", { style: { marginTop: 8, borderTop: "1px solid rgba(96,165,250,0.12)", paddingTop: 5 }, children: [
          /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: (e) => {
                e.stopPropagation();
                setFictionalExpanded((p) => !p);
              },
              style: {
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                color: "#60a5fa",
                fontSize: 9,
                fontFamily: "inherit",
                letterSpacing: "0.06em"
              },
              children: [
                /* @__PURE__ */ jsx("span", { style: { opacity: 0.6 }, children: fictionalExpanded ? "\u25B2" : "\u25BC" }),
                fictionalFiles.length,
                " planned file",
                fictionalFiles.length !== 1 ? "s" : ""
              ]
            }
          ),
          fictionalExpanded && /* @__PURE__ */ jsx("ul", { style: { listStyle: "none", margin: "5px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }, children: fictionalFiles.map((f) => /* @__PURE__ */ jsxs(
            "li",
            {
              style: {
                fontSize: 9,
                background: "rgba(96,165,250,0.06)",
                border: "1px dashed rgba(96,165,250,0.2)",
                borderRadius: 4,
                padding: "3px 6px"
              },
              children: [
                /* @__PURE__ */ jsxs("div", { style: { color: "#93c5fd", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: [
                  "\u2726 ",
                  f.name
                ] }),
                f.description && /* @__PURE__ */ jsx("div", { style: { color: "#4b5563", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: f.description })
              ]
            },
            f.id
          )) })
        ] }),
        /* @__PURE__ */ jsx(Handle, { type: "target", position: Position.Top, style: { opacity: 0 } }),
        /* @__PURE__ */ jsx(Handle, { type: "source", position: Position.Bottom, style: { opacity: 0 } })
      ]
    }
  );
});
var RepoEdge = memo(function RepoEdge2(props) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8
  });
  if (!data) return null;
  const color = EDGE_COLORS[data.edgeType] ?? "#64748b";
  const dashStyle = CONFIDENCE_STYLE[data.confidence] ?? "solid";
  const baseDash = dashStyle === "dashed" ? "6,4" : dashStyle === "dotted" ? "2,4" : void 0;
  const strokeDasharray = data.isBranchEdge ? baseDash ?? "8,3" : baseDash;
  const strokeWidth = Math.max(1, data.strength * 0.6) * (data.isBranchEdge ? 1.3 : 1);
  const opacity = data.confidence === "uncertain" ? 0.45 : data.isBranchEdge ? 1 : 0.8;
  return /* @__PURE__ */ jsx(
    BaseEdge,
    {
      id,
      path: edgePath,
      markerEnd,
      style: {
        stroke: color,
        strokeWidth,
        strokeDasharray,
        opacity,
        filter: data.isBranchEdge ? `drop-shadow(0 0 3px ${color}55)` : void 0
      }
    }
  );
});
var nodeTypes = { repoNode: RepoNode };
var edgeTypes = { repoEdge: RepoEdge };
var NODE_TYPES_LIST = [
  { type: "layer", label: "Layer", color: "#60a5fa", depth: 0 },
  { type: "module", label: "Module", color: "#a78bfa", depth: 1 },
  { type: "file", label: "File", color: "#34d399", depth: 2 },
  { type: "component", label: "Component", color: "#fb923c", depth: 3 }
];
var EDGE_TYPES_LIST = [
  { type: "engineering", label: "Runtime call", color: "#60a5fa" },
  { type: "architecture", label: "Design structure", color: "#c084fc" },
  { type: "both", label: "Mixed", color: "#f472b6" }
];
var LAYOUT_OPTIONS = [
  { value: "vertical_layers", label: "Vertical layers" },
  { value: "horizontal_three_column", label: "Three columns" },
  { value: "concentric_rings", label: "Concentric rings" },
  { value: "left_right_flow", label: "Pipeline flow" },
  { value: "grid_clusters", label: "Grid clusters" },
  { value: "force_directed", label: "Free (force-dir.)" }
];
function makeNodeId(type, label) {
  const slug = label.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "node";
  return `${type}__${slug}__${Date.now()}`;
}
function makeEdgeId(source, target) {
  return `edge__${source}__${target}__${Date.now()}`;
}
function emptyGraph(meta = {}) {
  return {
    meta: {
      repoUrl: meta.repoUrl ?? "manual://untitled",
      repoName: meta.repoName ?? "Untitled diagram",
      analysisVersion: "manual",
      analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
      detectedPattern: meta.detectedPattern ?? "unknown",
      layoutTemplate: meta.layoutTemplate ?? "force_directed",
      patternConfidence: 0
    },
    nodes: [],
    edges: [],
    overlay: {
      version: 0,
      nodeOverrides: {},
      edgeOverrides: {},
      manualNodes: [],
      manualEdges: []
    }
  };
}
function graphToRF(graph) {
  const allNodes = [...graph.nodes, ...graph.overlay.manualNodes];
  const allEdges = [...graph.edges, ...graph.overlay.manualEdges];
  const rfNodes = allNodes.map((n, i) => {
    const ov = graph.overlay.nodeOverrides[n.id];
    const col = Math.ceil(Math.sqrt(allNodes.length));
    return {
      id: n.id,
      type: "repoNode",
      position: ov?.position ?? {
        x: i % col * 280,
        y: Math.floor(i / col) * 140
      },
      data: {
        label: ov?.customLabel ?? n.label,
        nodeType: n.type,
        detectedRole: n.detectedRole,
        patterns: n.patterns,
        fileCount: n.files.length,
        files: n.files,
        complexity: n.metadata.complexity,
        depth: n.depth,
        parentId: n.parentId,
        statusTag: ov?.statusTag ?? n.metadata.statusTag
      }
    };
  });
  const rfEdges = allEdges.filter((e) => !graph.overlay.edgeOverrides[e.id]?.hidden).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "repoEdge",
    label: e.label,
    data: {
      edgeType: e.edgeType,
      confidence: e.confidence,
      strength: e.strength
    }
  }));
  return { nodes: rfNodes, edges: rfEdges };
}
function rfToGraph(rfNodes, rfEdges, meta) {
  const nodes = rfNodes.map((n) => ({
    id: n.id,
    label: n.data.label,
    type: n.data.nodeType,
    parentId: n.data.parentId ?? null,
    depth: n.data.depth ?? 0,
    files: n.data.files ?? [],
    detectedRole: n.data.detectedRole ?? "",
    patterns: n.data.patterns ?? [],
    metadata: {
      complexity: n.data.complexity,
      statusTag: n.data.statusTag
    }
  }));
  const edges = rfEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    edgeType: e.data?.edgeType ?? "engineering",
    strength: e.data?.strength ?? 3,
    confidence: e.data?.confidence ?? "high",
    label: typeof e.label === "string" ? e.label : void 0
  }));
  const nodeOverrides = {};
  rfNodes.forEach((n) => {
    nodeOverrides[n.id] = { position: n.position };
  });
  return {
    meta,
    nodes,
    edges,
    overlay: {
      version: 1,
      nodeOverrides,
      edgeOverrides: {},
      manualNodes: [],
      manualEdges: []
    }
  };
}
function SectionTitle({ children }) {
  return /* @__PURE__ */ jsx("div", { style: { fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }, children });
}
function ManualEditor({
  mode = "create",
  initialGraph,
  lockedNodeIds = [],
  lockedEdgeIds = [],
  contextLabel,
  onComplete,
  onCancel
}) {
  const baseGraph = useMemo(
    () => initialGraph ?? emptyGraph(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const { nodes: initRFNodes, edges: initRFEdges } = useMemo(
    () => graphToRF(baseGraph),
    [baseGraph]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initRFNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initRFEdges);
  const [diagramName, setDiagramName] = useState(baseGraph.meta.repoName);
  const [layout, setLayout] = useState(baseGraph.meta.layoutTemplate);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [tab, setTab] = useState("add");
  const [newNode, setNewNode] = useState({
    label: "",
    type: "module",
    role: ""
  });
  const [edgeState, setEdgeState] = useState({
    active: false,
    sourceId: null,
    edgeType: "engineering",
    strength: 3,
    label: ""
  });
  const reactFlowRef = useRef(null);
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );
  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  );
  const lockedNodeSet = useMemo(() => new Set(lockedNodeIds), [lockedNodeIds]);
  const lockedEdgeSet = useMemo(() => new Set(lockedEdgeIds), [lockedEdgeIds]);
  const selectedNodeLocked = selectedNodeId ? lockedNodeSet.has(selectedNodeId) : false;
  selectedEdgeId ? lockedEdgeSet.has(selectedEdgeId) : false;
  const onNodeClick = useCallback((_, node) => {
    if (edgeState.active) {
      if (!edgeState.sourceId) {
        setEdgeState((s) => ({ ...s, sourceId: node.id }));
      } else if (edgeState.sourceId !== node.id) {
        const id = makeEdgeId(edgeState.sourceId, node.id);
        const newEdge = {
          id,
          source: edgeState.sourceId,
          target: node.id,
          type: "repoEdge",
          label: edgeState.label || void 0,
          data: {
            edgeType: edgeState.edgeType,
            confidence: "high",
            strength: edgeState.strength
          }
        };
        setEdges((es) => [...es, newEdge]);
        setEdgeState((s) => ({ ...s, sourceId: null, label: "" }));
      }
      return;
    }
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setTab("inspect");
  }, [edgeState, setEdges]);
  const onEdgeClick = useCallback((_, edge) => {
    if (edgeState.active) return;
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setTab("inspect");
  }, [edgeState.active]);
  function handleAddNode() {
    if (!newNode.label.trim()) return;
    const id = makeNodeId(newNode.type, newNode.label);
    const depth = NODE_TYPES_LIST.find((t) => t.type === newNode.type)?.depth ?? 1;
    const count = nodes.length;
    const col = Math.max(1, Math.ceil(Math.sqrt(count + 1)));
    const rfNode = {
      id,
      type: "repoNode",
      position: {
        x: count % col * 280 + Math.random() * 40 - 20,
        y: Math.floor(count / col) * 160 + Math.random() * 40 - 20
      },
      data: {
        label: newNode.label.trim(),
        nodeType: newNode.type,
        detectedRole: newNode.role.trim(),
        patterns: [],
        fileCount: 0,
        files: [],
        depth
      }
    };
    setNodes((ns) => [...ns, rfNode]);
    setNewNode((f) => ({ ...f, label: "" }));
    setSelectedNodeId(id);
    setTab("inspect");
  }
  function handleDeleteSelected() {
    if (selectedNodeId && !lockedNodeSet.has(selectedNodeId)) {
      setNodes((ns) => ns.filter((n) => n.id !== selectedNodeId));
      setEdges((es) => es.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
      setSelectedNodeId(null);
    }
    if (selectedEdgeId && !lockedEdgeSet.has(selectedEdgeId)) {
      setEdges((es) => es.filter((e) => e.id !== selectedEdgeId));
      setSelectedEdgeId(null);
    }
  }
  function updateSelectedNode(patch) {
    if (!selectedNodeId) return;
    if (lockedNodeSet.has(selectedNodeId)) return;
    setNodes((ns) => ns.map(
      (n) => n.id === selectedNodeId ? { ...n, data: { ...n.data, ...patch } } : n
    ));
  }
  function updateSelectedEdge(patch) {
    if (!selectedEdgeId) return;
    if (lockedEdgeSet.has(selectedEdgeId)) return;
    const { label, ...dataPatch } = patch;
    setEdges((es) => es.map((e) => {
      if (e.id !== selectedEdgeId) return e;
      return {
        ...e,
        label: label !== void 0 ? label : e.label,
        data: { ...e.data ?? {}, ...dataPatch }
      };
    }));
  }
  const onConnect = useCallback((params) => {
    setEdges((es) => addEdge({
      ...params,
      type: "repoEdge",
      data: {
        edgeType: edgeState.edgeType,
        confidence: "high",
        strength: edgeState.strength
      }
    }, es));
  }, [setEdges, edgeState.edgeType, edgeState.strength]);
  useEffect(() => {
    function onKey(e) {
      if ((e.key === "Delete" || e.key === "Backspace") && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        handleDeleteSelected();
      }
      if (e.key === "Escape") {
        setEdgeState((s) => ({ ...s, active: false, sourceId: null }));
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  function handleDone() {
    const graph = rfToGraph(nodes, edges, {
      repoUrl: `manual://${diagramName.toLowerCase().replace(/\s+/g, "-")}`,
      repoName: diagramName,
      analysisVersion: "manual",
      analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
      detectedPattern: "unknown",
      layoutTemplate: layout,
      patternConfidence: 0
    });
    onComplete(graph);
  }
  const isEdgeMode = edgeState.active;
  const hasSelected = selectedNodeId !== null || selectedEdgeId !== null;
  return /* @__PURE__ */ jsxs("div", { style: { width: "100%", height: "100%", display: "flex", background: "#0b0f1a", fontFamily: '"Inter", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif' }, children: [
    /* @__PURE__ */ jsxs("div", { style: {
      width: 240,
      flexShrink: 0,
      background: "#080e1a",
      borderRight: "1px solid #1e293b",
      display: "flex",
      flexDirection: "column",
      padding: "16px 14px",
      gap: 16,
      overflowY: "auto"
    }, children: [
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" }, children: [
        /* @__PURE__ */ jsxs("div", { style: { fontSize: 11, color: "#3b82f6", fontWeight: 700, letterSpacing: "0.08em" }, children: [
          "{",
          /* @__PURE__ */ jsx("span", { style: { color: "#a78bfa" }, children: "repo" }),
          "map",
          "}"
        ] }),
        /* @__PURE__ */ jsx("div", { style: { fontSize: 9, color: mode === "edit" ? "#a78bfa" : "#475569", background: mode === "edit" ? "rgba(167,139,250,0.1)" : "rgba(71,85,105,0.1)", border: `1px solid ${mode === "edit" ? "rgba(167,139,250,0.3)" : "#1e293b"}`, borderRadius: 4, padding: "2px 6px" }, children: mode === "edit" ? "\u270E edit mode" : "\u2726 manual" })
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("div", { style: { fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }, children: "Diagram name" }),
        /* @__PURE__ */ jsx(
          "input",
          {
            value: diagramName,
            onChange: (e) => setDiagramName(e.target.value),
            style: inputStyle,
            placeholder: "My architecture"
          }
        )
      ] }),
      /* @__PURE__ */ jsx("div", { style: { display: "flex", borderBottom: "1px solid #1e293b" }, children: ["add", "inspect", "settings"].map((t) => /* @__PURE__ */ jsx(
        "button",
        {
          onClick: () => setTab(t),
          style: {
            flex: 1,
            background: "none",
            border: "none",
            borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
            padding: "7px 2px",
            fontSize: 9,
            cursor: "pointer",
            color: tab === t ? "#93c5fd" : "#475569",
            fontFamily: "inherit",
            letterSpacing: "0.04em"
          },
          children: t === "add" ? "\uFF0B add" : t === "inspect" ? "\u25CE node" : "\u2699 settings"
        },
        t
      )) }),
      tab === "add" && /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Node type" }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 5 }, children: NODE_TYPES_LIST.map(({ type, label, color }) => /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => setNewNode((f) => ({ ...f, type })),
              style: {
                background: newNode.type === type ? `rgba(${hexToRgb(color)},0.15)` : "transparent",
                border: `1px solid ${newNode.type === type ? color : "#1e293b"}`,
                borderRadius: 5,
                color: newNode.type === type ? color : "#475569",
                fontSize: 10,
                padding: "5px 9px",
                cursor: "pointer",
                fontFamily: "inherit"
              },
              children: label
            },
            type
          )) })
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Label" }),
          /* @__PURE__ */ jsx(
            "input",
            {
              autoFocus: true,
              value: newNode.label,
              onChange: (e) => setNewNode((f) => ({ ...f, label: e.target.value })),
              onKeyDown: (e) => e.key === "Enter" && handleAddNode(),
              style: inputStyle,
              placeholder: `e.g. "Auth module"`
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Role (optional)" }),
          /* @__PURE__ */ jsx(
            "input",
            {
              value: newNode.role,
              onChange: (e) => setNewNode((f) => ({ ...f, role: e.target.value })),
              onKeyDown: (e) => e.key === "Enter" && handleAddNode(),
              style: inputStyle,
              placeholder: `e.g. "authentication"`
            }
          )
        ] }),
        /* @__PURE__ */ jsxs(
          "button",
          {
            onClick: handleAddNode,
            disabled: !newNode.label.trim(),
            style: {
              ...actionBtnStyle,
              opacity: newNode.label.trim() ? 1 : 0.4,
              cursor: newNode.label.trim() ? "pointer" : "not-allowed"
            },
            children: [
              "\uFF0B Add ",
              newNode.type
            ]
          }
        ),
        /* @__PURE__ */ jsxs("div", { style: { borderTop: "1px solid #1e293b", paddingTop: 12, marginTop: 4 }, children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Connect nodes" }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }, children: EDGE_TYPES_LIST.map(({ type, label, color }) => /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: () => setEdgeState((s) => ({ ...s, edgeType: type })),
              style: {
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: edgeState.edgeType === type ? `rgba(${hexToRgb(color)},0.1)` : "transparent",
                border: `1px solid ${edgeState.edgeType === type ? color : "#1e293b"}`,
                borderRadius: 5,
                padding: "6px 9px",
                cursor: "pointer",
                color: edgeState.edgeType === type ? color : "#475569",
                fontSize: 10,
                fontFamily: "inherit"
              },
              children: [
                /* @__PURE__ */ jsx("svg", { width: 18, height: 8, children: /* @__PURE__ */ jsx("line", { x1: 0, y1: 4, x2: 18, y2: 4, stroke: color, strokeWidth: 1.5, strokeDasharray: type === "architecture" ? "5,3" : void 0 }) }),
                label
              ]
            },
            type
          )) }),
          /* @__PURE__ */ jsxs("div", { style: { marginBottom: 8 }, children: [
            /* @__PURE__ */ jsxs("div", { style: { fontSize: 9, color: "#334155", marginBottom: 4 }, children: [
              "Strength: ",
              edgeState.strength
            ] }),
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "range",
                min: 1,
                max: 5,
                step: 1,
                value: edgeState.strength,
                onChange: (e) => setEdgeState((s) => ({ ...s, strength: Number(e.target.value) })),
                style: { width: "100%", accentColor: "#3b82f6" }
              }
            )
          ] }),
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => setEdgeState((s) => ({
                ...s,
                active: !s.active,
                sourceId: null
              })),
              style: {
                ...actionBtnStyle,
                background: isEdgeMode ? "rgba(59,130,246,0.2)" : "rgba(59,130,246,0.08)",
                borderColor: isEdgeMode ? "#3b82f6" : "#1e293b",
                color: isEdgeMode ? "#93c5fd" : "#475569",
                width: "100%"
              },
              children: isEdgeMode ? edgeState.sourceId ? `\u25B8 click target node\u2026` : `\u25B8 click source node\u2026` : "\u27F5 draw connection"
            }
          ),
          isEdgeMode && /* @__PURE__ */ jsx("div", { style: { fontSize: 9, color: "#334155", marginTop: 5, lineHeight: 1.5 }, children: "Click two nodes to connect them. Press Esc to exit." })
        ] })
      ] }),
      tab === "inspect" && /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: !hasSelected ? /* @__PURE__ */ jsx("div", { style: { fontSize: 11, color: "#334155" }, children: "Click a node or edge to inspect." }) : selectedNode ? /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("div", { style: { fontSize: 12, fontWeight: 700, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: selectedNode.data.label }),
        selectedNodeLocked && /* @__PURE__ */ jsx("div", { style: { background: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.14)", borderRadius: 6, color: "#64748b", fontSize: 10, lineHeight: 1.5, padding: "6px 8px" }, children: "This node belongs to the base graph or a parent branch. You can connect to it, but edits are saved only for this branch's own nodes." }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Label" }),
          /* @__PURE__ */ jsx(
            "input",
            {
              value: selectedNode.data.label ?? "",
              onChange: (e) => updateSelectedNode({ label: e.target.value }),
              style: inputStyle,
              disabled: selectedNodeLocked
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Type" }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 4 }, children: NODE_TYPES_LIST.map(({ type, label, color, depth }) => /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => updateSelectedNode({ nodeType: type, depth }),
              disabled: selectedNodeLocked,
              style: {
                background: selectedNode.data.nodeType === type ? `rgba(${hexToRgb(color)},0.15)` : "transparent",
                border: `1px solid ${selectedNode.data.nodeType === type ? color : "#1e293b"}`,
                borderRadius: 5,
                color: selectedNode.data.nodeType === type ? color : "#475569",
                fontSize: 10,
                padding: "4px 8px",
                cursor: "pointer",
                fontFamily: "inherit"
              },
              children: label
            },
            type
          )) })
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Role" }),
          /* @__PURE__ */ jsx(
            "input",
            {
              value: selectedNode.data.detectedRole ?? "",
              onChange: (e) => updateSelectedNode({ detectedRole: e.target.value }),
              style: inputStyle,
              disabled: selectedNodeLocked,
              placeholder: "e.g. authentication"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Status tag" }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 4 }, children: [void 0, "stable", "legacy", "in_refactor", "deprecated"].map((tag) => /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => updateSelectedNode({ statusTag: tag }),
              disabled: selectedNodeLocked,
              style: {
                background: selectedNode.data.statusTag === tag ? "rgba(99,102,241,0.15)" : "transparent",
                border: `1px solid ${selectedNode.data.statusTag === tag ? "#6366f1" : "#1e293b"}`,
                borderRadius: 5,
                color: selectedNode.data.statusTag === tag ? "#a5b4fc" : "#475569",
                fontSize: 9,
                padding: "3px 7px",
                cursor: "pointer",
                fontFamily: "inherit"
              },
              children: tag ?? "none"
            },
            tag ?? "none"
          )) })
        ] }),
        /* @__PURE__ */ jsx("button", { onClick: handleDeleteSelected, disabled: selectedNodeLocked, style: { ...deleteBtnStyle, opacity: selectedNodeLocked ? 0.35 : 1, cursor: selectedNodeLocked ? "not-allowed" : "pointer" }, children: "\u2715 Delete node" })
      ] }) : selectedEdge ? /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("div", { style: { fontSize: 12, fontWeight: 700, color: "#e2e8f0" }, children: "Edge" }),
        /* @__PURE__ */ jsxs("div", { style: { fontSize: 10, color: "#475569" }, children: [
          selectedEdge.source,
          " \u2192 ",
          selectedEdge.target
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Label" }),
          /* @__PURE__ */ jsx(
            "input",
            {
              value: typeof selectedEdge.label === "string" ? selectedEdge.label : "",
              onChange: (e) => updateSelectedEdge({ label: e.target.value }),
              style: inputStyle,
              placeholder: "e.g. calls, implements\u2026"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Type" }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: EDGE_TYPES_LIST.map(({ type, label, color }) => /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: () => updateSelectedEdge({ edgeType: type }),
              style: {
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: selectedEdge.data?.edgeType === type ? `rgba(${hexToRgb(color)},0.1)` : "transparent",
                border: `1px solid ${selectedEdge.data?.edgeType === type ? color : "#1e293b"}`,
                borderRadius: 5,
                padding: "5px 9px",
                cursor: "pointer",
                color: selectedEdge.data?.edgeType === type ? color : "#475569",
                fontSize: 10,
                fontFamily: "inherit"
              },
              children: [
                /* @__PURE__ */ jsx("svg", { width: 18, height: 8, children: /* @__PURE__ */ jsx("line", { x1: 0, y1: 4, x2: 18, y2: 4, stroke: color, strokeWidth: 1.5, strokeDasharray: type === "architecture" ? "5,3" : void 0 }) }),
                label
              ]
            },
            type
          )) })
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsxs(SectionTitle, { children: [
            "Strength: ",
            selectedEdge.data?.strength ?? 3
          ] }),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "range",
              min: 1,
              max: 5,
              step: 1,
              value: selectedEdge.data?.strength ?? 3,
              onChange: (e) => updateSelectedEdge({ strength: Number(e.target.value) }),
              style: { width: "100%", accentColor: "#3b82f6" }
            }
          )
        ] }),
        /* @__PURE__ */ jsx("button", { onClick: handleDeleteSelected, style: deleteBtnStyle, children: "\u2715 Delete edge" })
      ] }) : null }),
      tab === "settings" && /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Layout" }),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: LAYOUT_OPTIONS.map(({ value, label }) => /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: () => setLayout(value),
              style: {
                background: layout === value ? "rgba(99,102,241,0.15)" : "transparent",
                border: `1px solid ${layout === value ? "#6366f1" : "#1e293b"}`,
                borderRadius: 5,
                color: layout === value ? "#a5b4fc" : "#475569",
                fontSize: 10,
                padding: "7px 10px",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left"
              },
              children: [
                layout === value ? "\u25B8 " : "  ",
                label
              ]
            },
            value
          )) })
        ] }),
        /* @__PURE__ */ jsxs("div", { style: { borderTop: "1px solid #1e293b", paddingTop: 12 }, children: [
          /* @__PURE__ */ jsx(SectionTitle, { children: "Stats" }),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 5 }, children: [
            /* @__PURE__ */ jsx(Stat, { label: "Nodes", value: nodes.length }),
            /* @__PURE__ */ jsx(Stat, { label: "Connections", value: edges.length }),
            /* @__PURE__ */ jsx(Stat, { label: "Layers", value: nodes.filter((n) => n.data.nodeType === "layer").length }),
            /* @__PURE__ */ jsx(Stat, { label: "Modules", value: nodes.filter((n) => n.data.nodeType === "module").length })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }, children: [
        nodes.length === 0 && /* @__PURE__ */ jsx("div", { style: { fontSize: 10, color: "#1e3a5f", textAlign: "center", padding: "8px 0" }, children: "Add at least one node to save" }),
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: handleDone,
            disabled: nodes.length === 0,
            style: {
              ...actionBtnStyle,
              background: nodes.length > 0 ? "#1d4ed8" : "#0f1f35",
              borderColor: nodes.length > 0 ? "#2563eb" : "#1e293b",
              color: nodes.length > 0 ? "#eff6ff" : "#1e3a5f",
              cursor: nodes.length > 0 ? "pointer" : "not-allowed",
              fontWeight: 600,
              fontSize: 12,
              padding: "11px 0"
            },
            children: mode === "edit" ? "\u2713 Save changes" : "\u2713 Create diagram"
          }
        ),
        onCancel && /* @__PURE__ */ jsx("button", { onClick: onCancel, style: { ...actionBtnStyle, background: "transparent", color: "#334155", borderColor: "#1e293b" }, children: "\u2715 Cancel" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs(
      "div",
      {
        ref: reactFlowRef,
        style: {
          flex: 1,
          position: "relative",
          cursor: isEdgeMode ? "crosshair" : "default"
        },
        children: [
          isEdgeMode && /* @__PURE__ */ jsxs("div", { style: {
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            background: "rgba(15,23,42,0.92)",
            border: "1px solid #3b82f6",
            borderRadius: 8,
            padding: "7px 16px",
            fontSize: 11,
            color: "#93c5fd",
            backdropFilter: "blur(6px)",
            pointerEvents: "none"
          }, children: [
            edgeState.sourceId ? `\u25B8 Now click the target node` : `\u25B8 Click the source node`,
            " \xB7 ",
            /* @__PURE__ */ jsx("span", { style: { color: "#475569" }, children: "Esc to cancel" })
          ] }),
          nodes.length === 0 && /* @__PURE__ */ jsxs("div", { style: {
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 5,
            textAlign: "center",
            pointerEvents: "none",
            color: "#1e293b",
            fontFamily: '"JetBrains Mono", monospace'
          }, children: [
            /* @__PURE__ */ jsx("div", { style: { fontSize: 28, marginBottom: 10 }, children: "\u2B21" }),
            /* @__PURE__ */ jsx("div", { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 }, children: "Empty canvas" }),
            /* @__PURE__ */ jsx("div", { style: { fontSize: 11 }, children: "Add your first node from the sidebar \u2192" })
          ] }),
          /* @__PURE__ */ jsxs(
            ReactFlow,
            {
              nodes,
              edges,
              onNodesChange,
              onEdgesChange,
              onConnect,
              onNodeClick,
              onEdgeClick,
              nodeTypes,
              edgeTypes,
              fitView: true,
              fitViewOptions: { padding: 0.3 },
              deleteKeyCode: null,
              style: { background: "#0b0f1a" },
              defaultEdgeOptions: {
                type: "repoEdge",
                data: { edgeType: "engineering", confidence: "high", strength: 3 }
              },
              children: [
                /* @__PURE__ */ jsx(Background, { variant: BackgroundVariant.Dots, gap: 24, size: 1.5, color: "#1e2a3a" }),
                /* @__PURE__ */ jsx(Controls, { style: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 } }),
                /* @__PURE__ */ jsx(
                  MiniMap,
                  {
                    style: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 },
                    nodeColor: (n) => {
                      const t = n.data.nodeType;
                      return t === "layer" ? "#60a5fa" : t === "module" ? "#a78bfa" : t === "file" ? "#34d399" : "#fb923c";
                    },
                    maskColor: "rgba(0,0,0,0.6)"
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ jsxs("div", { style: {
            position: "absolute",
            bottom: 14,
            right: 14,
            fontSize: 9,
            color: "#1e3a5f",
            fontFamily: '"JetBrains Mono", monospace',
            lineHeight: 1.8,
            textAlign: "right",
            pointerEvents: "none"
          }, children: [
            "Delete / Backspace \u2192 remove selected",
            /* @__PURE__ */ jsx("br", {}),
            "Drag node handles \u2192 connect nodes",
            /* @__PURE__ */ jsx("br", {}),
            "Esc \u2192 deselect / exit edge mode"
          ] })
        ]
      }
    )
  ] });
}
function Stat({ label, value }) {
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 10 }, children: [
    /* @__PURE__ */ jsx("span", { style: { color: "#334155" }, children: label }),
    /* @__PURE__ */ jsx("span", { style: { color: "#60a5fa", fontWeight: 700 }, children: value })
  ] });
}
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}
var inputStyle = {
  width: "100%",
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 6,
  padding: "7px 10px",
  color: "#e2e8f0",
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box"
};
var actionBtnStyle = {
  width: "100%",
  background: "rgba(59,130,246,0.08)",
  border: "1px solid #1e293b",
  borderRadius: 7,
  padding: "9px 0",
  color: "#60a5fa",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
  textAlign: "center"
};
var deleteBtnStyle = {
  ...actionBtnStyle,
  background: "rgba(239,68,68,0.06)",
  borderColor: "rgba(239,68,68,0.2)",
  color: "#f87171"
};
var LAYOUT_TO_VIEW = {
  concentric_rings: "onion",
  horizontal_three_column: "layers",
  cluster: "clusters",
  vertical_layers: "layers",
  grid_clusters: "clusters",
  left_right_flow: "pipeline",
  force_directed: "graph"
};
function recommendedView(layout) {
  return LAYOUT_TO_VIEW[layout] ?? "graph";
}
var VIEWS = [
  { id: "graph", icon: "\u25C9", label: "Node graph" },
  { id: "onion", icon: "\u2299", label: "Onion rings" },
  { id: "layers", icon: "\u2261", label: "Layer stack" },
  { id: "clusters", icon: "\u229E", label: "Clusters" },
  { id: "pipeline", icon: "\u2192", label: "Pipeline" }
];
function ViewSwitcher({ current, recommended, onChange }) {
  return /* @__PURE__ */ jsxs("div", { style: { marginTop: 10 }, children: [
    /* @__PURE__ */ jsx("div", { style: { fontSize: 9, color: "#334155", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }, children: "visualisation" }),
    /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 3 }, children: VIEWS.map(({ id, icon, label }) => {
      const active = current === id;
      const rec = recommended === id && !active;
      return /* @__PURE__ */ jsx(
        "button",
        {
          onClick: () => onChange(id),
          title: label + (rec ? " \u2014 recommended for this pattern" : ""),
          style: {
            background: active ? "rgba(99,102,241,0.3)" : rec ? "rgba(99,102,241,0.1)" : "transparent",
            border: `1px solid ${active ? "rgba(99,102,241,0.7)" : rec ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 5,
            color: active ? "#a5b4fc" : rec ? "#6366f1" : "#475569",
            cursor: "pointer",
            flex: 1,
            fontSize: 12,
            fontFamily: "inherit",
            padding: "4px 0",
            transition: "all 0.15s"
          },
          children: icon
        },
        id
      );
    }) }),
    recommended !== current && /* @__PURE__ */ jsxs("div", { style: { fontSize: 9, color: "#334155", marginTop: 4 }, children: [
      "\u2299 = recommended for ",
      recommended === "onion" ? "this pattern" : recommended
    ] })
  ] });
}
var NCOLORS = {
  layer: { bg: "rgba(96,165,250,0.12)", stroke: "#60a5fa", text: "#93c5fd" },
  module: { bg: "rgba(167,139,250,0.12)", stroke: "#a78bfa", text: "#c4b5fd" },
  file: { bg: "rgba(52,211,153,0.12)", stroke: "#34d399", text: "#6ee7b7" },
  component: { bg: "rgba(251,146,60,0.12)", stroke: "#fb923c", text: "#fdba74" }
};
var nc = (type) => NCOLORS[type] ?? NCOLORS.module;
function HoverCard({ node, showFiles }) {
  const col = nc(node.type);
  return /* @__PURE__ */ jsxs("div", { style: {
    position: "absolute",
    bottom: 16,
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(8,14,26,0.97)",
    border: "1px solid #1e293b",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 11,
    fontFamily: '"JetBrains Mono",monospace',
    pointerEvents: "none",
    whiteSpace: "nowrap",
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    gap: 4
  }, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
      /* @__PURE__ */ jsx("span", { style: { color: col.text, fontWeight: 700 }, children: node.label }),
      /* @__PURE__ */ jsx("span", { style: { color: "#334155" }, children: "\xB7" }),
      /* @__PURE__ */ jsx("span", { style: { color: "#475569" }, children: node.type }),
      node.detectedRole && node.detectedRole !== "unknown" && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("span", { style: { color: "#334155" }, children: "\xB7" }),
        /* @__PURE__ */ jsx("span", { style: { color: "#334155" }, children: node.detectedRole })
      ] }),
      node.files.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("span", { style: { color: "#334155" }, children: "\xB7" }),
        /* @__PURE__ */ jsxs("span", { style: { color: "#334155" }, children: [
          node.files.length,
          " files"
        ] })
      ] })
    ] }),
    showFiles && node.files.length > 0 && /* @__PURE__ */ jsx("div", { style: { borderTop: "1px solid #1e293b", paddingTop: 4, display: "flex", flexDirection: "column", gap: 2 }, children: node.files.map((f) => /* @__PURE__ */ jsxs("span", { style: { color: "#475569", fontSize: 9 }, children: [
      "\u203A ",
      f.split("/").pop()
    ] }, f)) })
  ] });
}
var RINGS = [
  { inner: 0, outer: 62 },
  { inner: 78, outer: 142 },
  { inner: 158, outer: 214 },
  { inner: 230, outer: 278 }
];
var RING_STROKE = ["#60a5fa", "#a78bfa", "#34d399", "#fb923c"];
function arcPath(cx, cy, ri, ro, a1, a2) {
  const gap = Math.min(0.035, (a2 - a1) * 0.07);
  const s = a1 + gap, e = a2 - gap;
  if (e <= s) return "";
  const lg = e - s > Math.PI ? 1 : 0;
  const C = Math.cos, S = Math.sin;
  if (ri <= 1) {
    return `M ${cx} ${cy} L ${cx + ro * C(s)} ${cy + ro * S(s)} A ${ro} ${ro} 0 ${lg} 1 ${cx + ro * C(e)} ${cy + ro * S(e)} Z`;
  }
  return `M ${cx + ro * C(s)} ${cy + ro * S(s)} A ${ro} ${ro} 0 ${lg} 1 ${cx + ro * C(e)} ${cy + ro * S(e)} L ${cx + ri * C(e)} ${cy + ri * S(e)} A ${ri} ${ri} 0 ${lg} 0 ${cx + ri * C(s)} ${cy + ri * S(s)} Z`;
}
function OnionView({ graph, onNodeClick }) {
  const [hovered, setHovered] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragging = useRef(null);
  const isDragging = useRef(false);
  const CX = 290, CY = 295;
  const byDepth = useMemo(() => {
    const m = {};
    graph.nodes.forEach((n) => {
      const d = Math.min(n.depth, 3);
      (m[d] ??= []).push(n);
    });
    return m;
  }, [graph.nodes]);
  const depths = Object.keys(byDepth).map(Number).sort();
  const hovNode = hovered ? graph.nodes.find((n) => n.id === hovered) ?? null : null;
  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((t) => ({ ...t, scale: Math.min(4, Math.max(0.25, t.scale * delta)) }));
  };
  const onMouseDown = (e) => {
    if (e.target.closest("[data-node]")) return;
    isDragging.current = false;
    dragging.current = { startX: e.clientX, startY: e.clientY, ox: transform.x, oy: transform.y };
  };
  const onMouseMove = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.startX;
    const dy = e.clientY - dragging.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging.current = true;
    setTransform((t) => ({
      ...t,
      x: dragging.current.ox + dx,
      y: dragging.current.oy + dy
    }));
  };
  const onMouseUp = () => {
    dragging.current = null;
  };
  return /* @__PURE__ */ jsxs("div", { style: { width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }, children: [
    /* @__PURE__ */ jsxs(
      "div",
      {
        style: { flex: 1, position: "relative", cursor: dragging.current ? "grabbing" : "grab", overflow: "hidden" },
        onWheel,
        onMouseDown,
        onMouseMove,
        onMouseUp,
        onMouseLeave: onMouseUp,
        children: [
          /* @__PURE__ */ jsxs(
            "svg",
            {
              width: "100%",
              height: "100%",
              viewBox: "0 0 580 590",
              style: {
                display: "block",
                transformOrigin: "center center",
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
              },
              children: [
                depths.map((d) => {
                  const r = RINGS[d];
                  if (!r) return null;
                  return /* @__PURE__ */ jsx(
                    "circle",
                    {
                      cx: CX,
                      cy: CY,
                      r: r.outer,
                      fill: "none",
                      stroke: RING_STROKE[d],
                      strokeWidth: 0.4,
                      strokeOpacity: 0.2,
                      strokeDasharray: "4 4"
                    },
                    "bg" + d
                  );
                }),
                depths.flatMap((d) => {
                  const nodes = byDepth[d] ?? [];
                  const ring = RINGS[d];
                  if (!ring || !nodes.length) return [];
                  const angle = 2 * Math.PI / nodes.length;
                  const start = -Math.PI / 2;
                  const stroke = RING_STROKE[d];
                  return nodes.map((node, i) => {
                    const a1 = start + i * angle, a2 = a1 + angle;
                    const mid = (a1 + a2) / 2;
                    const midR = ring.inner <= 1 ? ring.outer * 0.56 : (ring.inner + ring.outer) / 2;
                    const lx = CX + midR * Math.cos(mid);
                    const ly = CY + midR * Math.sin(mid);
                    const path = arcPath(CX, CY, ring.inner, ring.outer, a1, a2);
                    const col = nc(node.type);
                    const hov = hovered === node.id;
                    const isExp = expanded === node.id;
                    const arcLen = midR * angle;
                    const maxCh = Math.max(3, Math.floor(arcLen / 7));
                    const lbl = node.label.length > maxCh ? node.label.slice(0, maxCh - 1) + "\u2026" : node.label;
                    let rot = mid * 180 / Math.PI;
                    if (rot > 90 && rot < 270) rot += 180;
                    return /* @__PURE__ */ jsxs(
                      "g",
                      {
                        "data-node": "1",
                        onMouseEnter: () => setHovered(node.id),
                        onMouseLeave: () => setHovered(null),
                        onClick: () => {
                          if (!isDragging.current) {
                            setExpanded((prev) => prev === node.id ? null : node.id);
                            onNodeClick?.(node);
                          }
                        },
                        style: { cursor: "pointer" },
                        children: [
                          /* @__PURE__ */ jsx(
                            "path",
                            {
                              d: path,
                              fill: isExp ? col.bg.replace("0.12", "0.4") : hov ? col.bg.replace("0.12", "0.32") : col.bg,
                              stroke,
                              strokeWidth: isExp ? 1.8 : hov ? 1.4 : 0.5,
                              strokeOpacity: isExp ? 1 : hov ? 0.9 : 0.55,
                              style: { transition: "fill 0.12s" }
                            }
                          ),
                          arcLen > 30 && /* @__PURE__ */ jsx(
                            "text",
                            {
                              x: lx,
                              y: ly,
                              textAnchor: "middle",
                              dominantBaseline: "central",
                              transform: `rotate(${rot},${lx},${ly})`,
                              style: {
                                fill: col.text,
                                fontSize: Math.min(11, Math.max(7, (ring.outer - ring.inner) * 0.22)),
                                fontFamily: '"JetBrains Mono",monospace',
                                opacity: hov || isExp ? 1 : 0.85,
                                pointerEvents: "none"
                              },
                              children: lbl
                            }
                          )
                        ]
                      },
                      node.id
                    );
                  });
                }),
                depths.map((d) => {
                  const r = RINGS[d];
                  if (!r) return null;
                  return /* @__PURE__ */ jsxs(
                    "text",
                    {
                      x: CX + r.outer + 14,
                      y: CY + (d - depths.length / 2 + 0.5) * 16,
                      dominantBaseline: "central",
                      style: { fill: RING_STROKE[d], fontSize: 9, fontFamily: '"JetBrains Mono",monospace', opacity: 0.55 },
                      children: [
                        "depth ",
                        d,
                        " \xB7 ",
                        byDepth[d]?.length ?? 0
                      ]
                    },
                    "dlbl" + d
                  );
                })
              ]
            }
          ),
          /* @__PURE__ */ jsx("div", { style: { position: "absolute", bottom: 12, right: 12, display: "flex", flexDirection: "column", gap: 2 }, children: [["\uFF0B", 1.2], ["\uFF0D", 0.8], ["\u2299", "reset"]].map(([icon, action]) => /* @__PURE__ */ jsx(
            "button",
            {
              onMouseDown: (e) => e.stopPropagation(),
              onClick: () => action === "reset" ? setTransform({ x: 0, y: 0, scale: 1 }) : setTransform((t) => ({ ...t, scale: Math.min(4, Math.max(0.25, t.scale * action)) })),
              style: {
                background: "rgba(15,23,42,0.9)",
                border: "1px solid #1e293b",
                borderRadius: 5,
                color: "#475569",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "inherit",
                width: 28,
                height: 26,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              },
              children: icon
            },
            String(icon)
          )) }),
          hovNode && /* @__PURE__ */ jsx(HoverCard, { node: hovNode, showFiles: expanded === hovNode.id })
        ]
      }
    ),
    /* @__PURE__ */ jsxs("div", { style: { borderTop: "1px solid #1e293b", display: "flex", gap: 20, padding: "8px 20px", flexShrink: 0, flexWrap: "wrap" }, children: [
      depths.map((d) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 5 }, children: [
        /* @__PURE__ */ jsx("div", { style: { width: 8, height: 8, borderRadius: "50%", background: RING_STROKE[d], opacity: 0.7 } }),
        /* @__PURE__ */ jsxs("span", { style: { fontSize: 10, color: "#475569", fontFamily: '"JetBrains Mono",monospace' }, children: [
          d === 0 ? "core" : d === 1 ? "modules" : d === 2 ? "files" : "components",
          " (",
          byDepth[d]?.length ?? 0,
          ")"
        ] })
      ] }, d)),
      /* @__PURE__ */ jsx("div", { style: { marginLeft: "auto", fontSize: 9, color: "#334155", fontFamily: '"JetBrains Mono",monospace' }, children: "click segment to expand files" })
    ] })
  ] });
}
function LayerStackView({ graph, onNodeClick }) {
  const [hovered, setHovered] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const toggleExpanded = (id) => setExpanded((prev) => prev === id ? null : id);
  const bands = useMemo(() => {
    const layerNodes = graph.nodes.filter((n) => n.type === "layer");
    if (layerNodes.length > 0) {
      return layerNodes.map((ln) => ({
        id: ln.id,
        label: ln.label,
        role: ln.detectedRole,
        nodeType: ln.type,
        children: graph.nodes.filter((n) => n.parentId === ln.id)
      }));
    }
    const depths = [...new Set(graph.nodes.map((n) => n.depth))].sort();
    return depths.map((d) => ({
      id: "depth-" + d,
      label: d === 0 ? "Layer / Core" : d === 1 ? "Modules" : d === 2 ? "Files" : "Components",
      role: "",
      nodeType: d === 0 ? "layer" : d === 1 ? "module" : "file",
      children: graph.nodes.filter((n) => n.depth === d)
    }));
  }, [graph.nodes]);
  const edgeCounts = useMemo(() => {
    const nodeToGroup = {};
    bands.forEach((b) => {
      nodeToGroup[b.id] = b.id;
      b.children.forEach((c) => {
        nodeToGroup[c.id] = b.id;
      });
    });
    const counts = {};
    graph.edges.forEach((e) => {
      const sg = nodeToGroup[e.source], tg = nodeToGroup[e.target];
      if (!sg || !tg || sg === tg) return;
      (counts[sg] ??= {})[tg] ??= 0;
      counts[sg][tg]++;
    });
    return counts;
  }, [graph.edges, bands]);
  return /* @__PURE__ */ jsx("div", { style: {
    width: "100%",
    height: "100%",
    overflowY: "auto",
    padding: "0 24px 20px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 0
  }, children: bands.map((band, bi) => {
    const col = nc(band.nodeType);
    const nextBand = bands[bi + 1];
    const connCount = nextBand ? edgeCounts[band.id]?.[nextBand.id] ?? 0 : 0;
    return /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsxs("div", { style: {
        background: col.bg,
        border: `1px solid ${col.stroke}55`,
        borderLeft: `3px solid ${col.stroke}`,
        borderRadius: 8,
        padding: "12px 16px"
      }, children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: band.children.length > 0 ? 10 : 0 }, children: [
          /* @__PURE__ */ jsx("span", { style: { color: col.text, fontSize: 12, fontWeight: 700, fontFamily: '"JetBrains Mono",monospace' }, children: band.label }),
          band.role && band.role !== "unknown" && /* @__PURE__ */ jsxs("span", { style: { color: "#475569", fontSize: 10, fontFamily: '"JetBrains Mono",monospace' }, children: [
            "\xB7 ",
            band.role
          ] }),
          /* @__PURE__ */ jsxs("span", { style: { marginLeft: "auto", color: "#334155", fontSize: 10, fontFamily: '"JetBrains Mono",monospace' }, children: [
            band.children.length,
            " nodes"
          ] })
        ] }),
        band.children.length > 0 && /* @__PURE__ */ jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 5 }, children: band.children.map((child) => {
          const cc = nc(child.type);
          const hov = hovered === child.id;
          const isExp = expanded === child.id;
          const canExp = (child.type === "module" || child.type === "layer") && child.files.length > 0;
          return /* @__PURE__ */ jsxs(
            "div",
            {
              onMouseEnter: () => setHovered(child.id),
              onMouseLeave: () => setHovered(null),
              onClick: () => onNodeClick?.(child),
              title: child.detectedRole !== "unknown" ? child.detectedRole : child.id,
              style: {
                background: hov ? cc.bg.replace("0.12", "0.3") : cc.bg,
                border: `1px solid ${cc.stroke}${hov ? "" : "88"}`,
                borderRadius: 5,
                color: cc.text,
                cursor: onNodeClick ? "pointer" : "default",
                fontSize: 10,
                fontFamily: '"JetBrains Mono",monospace',
                padding: "3px 8px",
                transition: "all 0.12s"
              },
              children: [
                /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 4 }, children: [
                  /* @__PURE__ */ jsx("span", { children: child.label }),
                  canExp && /* @__PURE__ */ jsxs(
                    "span",
                    {
                      onClick: (e) => {
                        e.stopPropagation();
                        toggleExpanded(child.id);
                      },
                      style: {
                        color: isExp ? cc.stroke : "#475569",
                        fontSize: 9,
                        cursor: "pointer",
                        border: `1px solid ${isExp ? cc.stroke : "#334155"}`,
                        borderRadius: 3,
                        padding: "0px 3px",
                        lineHeight: "14px"
                      },
                      children: [
                        child.files.length,
                        isExp ? " \u25B2" : " \u25BC"
                      ]
                    }
                  )
                ] }),
                isExp && /* @__PURE__ */ jsx("div", { style: { marginTop: 5, borderTop: `1px solid ${cc.stroke}33`, paddingTop: 4, display: "flex", flexDirection: "column", gap: 1 }, children: child.files.map((f) => /* @__PURE__ */ jsxs("span", { style: { color: "#64748b", fontSize: 8 }, children: [
                  "\u203A ",
                  f.split("/").pop()
                ] }, f)) })
              ]
            },
            child.id
          );
        }) })
      ] }),
      bi < bands.length - 1 && /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "6px 20px" }, children: [
        /* @__PURE__ */ jsx("div", { style: { flex: 1, height: 1, background: "linear-gradient(to right, #1e293b, #334155)" } }),
        /* @__PURE__ */ jsx("span", { style: { color: "#334155", fontSize: 10, fontFamily: '"JetBrains Mono",monospace', flexShrink: 0 }, children: connCount > 0 ? `${connCount} connection${connCount !== 1 ? "s" : ""}` : "\u2014" }),
        /* @__PURE__ */ jsx("div", { style: { flex: 1, height: 1, background: "linear-gradient(to left, #1e293b, #334155)" } }),
        /* @__PURE__ */ jsx("span", { style: { color: "#334155", fontSize: 11 }, children: "\u2193" })
      ] })
    ] }, band.id);
  }) });
}
function ClusterView({ graph, onNodeClick }) {
  const [hovered, setHovered] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const toggleExpanded = (id) => setExpanded((prev) => prev === id ? null : id);
  const clusters = useMemo(() => {
    const topIds = new Set(
      graph.nodes.filter((n) => n.parentId === null || n.depth <= 1).map((n) => n.id)
    );
    const tops = graph.nodes.filter((n) => topIds.has(n.id) && (!n.parentId || !topIds.has(n.parentId)));
    return tops.map((n) => {
      const children = graph.nodes.filter((c) => c.parentId === n.id);
      const allIds = /* @__PURE__ */ new Set([n.id, ...children.map((c) => c.id)]);
      return {
        node: n,
        children,
        edgesOut: graph.edges.filter((e) => allIds.has(e.source) && !allIds.has(e.target)).length,
        edgesIn: graph.edges.filter((e) => allIds.has(e.target) && !allIds.has(e.source)).length
      };
    });
  }, [graph.nodes, graph.edges]);
  return /* @__PURE__ */ jsx("div", { style: { width: "100%", height: "100%", overflowY: "auto", padding: "0 24px 24px", boxSizing: "border-box" }, children: /* @__PURE__ */ jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }, children: clusters.map(({ node, children, edgesOut, edgesIn }) => {
    const col = nc(node.type);
    const hov = hovered === node.id;
    const isExp = expanded === node.id;
    const canExp = node.files.length > 0;
    return /* @__PURE__ */ jsxs(
      "div",
      {
        onMouseEnter: () => setHovered(node.id),
        onMouseLeave: () => setHovered(null),
        onClick: () => onNodeClick?.(node),
        style: {
          background: hov ? col.bg.replace("0.12", "0.24") : col.bg,
          border: `1px solid ${col.stroke}${hov ? "" : "66"}`,
          borderRadius: 10,
          cursor: onNodeClick ? "pointer" : "default",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "all 0.15s"
        },
        children: [
          /* @__PURE__ */ jsxs("div", { style: { borderBottom: `1px solid ${col.stroke}33`, padding: "10px 12px" }, children: [
            /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }, children: [
              /* @__PURE__ */ jsx("div", { style: { color: col.text, fontFamily: '"JetBrains Mono",monospace', fontSize: 11, fontWeight: 700, lineHeight: 1.35 }, children: node.label }),
              /* @__PURE__ */ jsx("span", { style: {
                background: col.bg,
                border: `1px solid ${col.stroke}66`,
                borderRadius: 4,
                color: col.text,
                flexShrink: 0,
                fontSize: 8,
                fontFamily: '"JetBrains Mono",monospace',
                padding: "2px 5px",
                marginTop: 1
              }, children: node.type })
            ] }),
            node.detectedRole && node.detectedRole !== "unknown" && /* @__PURE__ */ jsx("div", { style: { color: "#475569", fontFamily: '"JetBrains Mono",monospace', fontSize: 9, marginTop: 3 }, children: node.detectedRole }),
            /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, marginTop: 7, alignItems: "center" }, children: [
              /* @__PURE__ */ jsxs("span", { title: "Incoming connections", style: { color: "#334155", fontSize: 9, fontFamily: '"JetBrains Mono",monospace' }, children: [
                "\u2193",
                edgesIn
              ] }),
              /* @__PURE__ */ jsxs("span", { title: "Outgoing connections", style: { color: "#334155", fontSize: 9, fontFamily: '"JetBrains Mono",monospace' }, children: [
                "\u2191",
                edgesOut
              ] }),
              canExp && /* @__PURE__ */ jsxs(
                "span",
                {
                  onClick: (e) => {
                    e.stopPropagation();
                    toggleExpanded(node.id);
                  },
                  style: {
                    color: isExp ? col.text : "#475569",
                    fontSize: 9,
                    fontFamily: '"JetBrains Mono",monospace',
                    cursor: "pointer",
                    border: `1px solid ${isExp ? col.stroke : "#334155"}`,
                    borderRadius: 3,
                    padding: "1px 5px",
                    transition: "all 0.12s"
                  },
                  children: [
                    node.files.length,
                    " files ",
                    isExp ? "\u25B2" : "\u25BC"
                  ]
                }
              )
            ] })
          ] }),
          isExp && /* @__PURE__ */ jsx("div", { style: { padding: "6px 12px", borderBottom: `1px solid ${col.stroke}22`, display: "flex", flexDirection: "column", gap: 2 }, children: node.files.map((f) => /* @__PURE__ */ jsxs("span", { style: { color: "#475569", fontSize: 8, fontFamily: '"JetBrains Mono",monospace' }, children: [
            "\u203A ",
            f.split("/").pop()
          ] }, f)) }),
          children.length > 0 && /* @__PURE__ */ jsxs("div", { style: { padding: "8px 12px", display: "flex", flexDirection: "column", gap: 3, maxHeight: 130, overflowY: "auto" }, children: [
            children.slice(0, 7).map((child) => {
              const cc = nc(child.type);
              return /* @__PURE__ */ jsxs(
                "div",
                {
                  onClick: (e) => {
                    e.stopPropagation();
                    onNodeClick?.(child);
                  },
                  style: { alignItems: "center", display: "flex", gap: 6, cursor: onNodeClick ? "pointer" : "default" },
                  children: [
                    /* @__PURE__ */ jsx("div", { style: { width: 5, height: 5, borderRadius: "50%", background: cc.stroke, flexShrink: 0 } }),
                    /* @__PURE__ */ jsx("span", { style: {
                      color: "#64748b",
                      fontFamily: '"JetBrains Mono",monospace',
                      fontSize: 9,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }, children: child.label })
                  ]
                },
                child.id
              );
            }),
            children.length > 7 && /* @__PURE__ */ jsxs("div", { style: { color: "#334155", fontSize: 9, fontFamily: '"JetBrains Mono",monospace', paddingLeft: 11 }, children: [
              "+",
              children.length - 7,
              " more"
            ] })
          ] }),
          node.patterns?.length > 0 && /* @__PURE__ */ jsx("div", { style: { borderTop: `1px solid ${col.stroke}22`, padding: "6px 12px", display: "flex", flexWrap: "wrap", gap: 3 }, children: node.patterns.slice(0, 2).map((p) => /* @__PURE__ */ jsx("span", { style: {
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 3,
            color: "#334155",
            fontSize: 8,
            fontFamily: '"JetBrains Mono",monospace',
            padding: "1px 5px"
          }, children: p.replace(/_/g, " ") }, p)) })
        ]
      },
      node.id
    );
  }) }) });
}
var COL_LABELS = {
  0: "layers",
  1: "modules",
  2: "files",
  3: "components"
};
function PipelineView({ graph, onNodeClick }) {
  const [hovered, setHovered] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const CARD_W = 158, CARD_H = 54, COL_GAP = 72, ROW_GAP = 8, PAD = 24;
  const columns = useMemo(() => {
    const depths = [...new Set(graph.nodes.map((n) => n.depth))].sort();
    return depths.map((d) => ({ depth: d, nodes: graph.nodes.filter((n) => n.depth === d) }));
  }, [graph.nodes]);
  const positions = useMemo(() => {
    const pos = {};
    columns.forEach((col, ci) => {
      col.nodes.forEach((n, ni) => {
        pos[n.id] = { x: PAD + ci * (CARD_W + COL_GAP), y: PAD + 28 + ni * (CARD_H + ROW_GAP) };
      });
    });
    return pos;
  }, [columns]);
  const VW = PAD * 2 + columns.length * (CARD_W + COL_GAP) - COL_GAP;
  const VH = PAD * 2 + 28 + Math.max(...columns.map((c) => c.nodes.length)) * (CARD_H + ROW_GAP);
  const crossEdges = useMemo(
    () => graph.edges.filter((e) => {
      const sn = graph.nodes.find((n) => n.id === e.source);
      const tn = graph.nodes.find((n) => n.id === e.target);
      return sn && tn && sn.depth !== tn.depth;
    }).slice(0, 80),
    [graph]
  );
  const hovNode = hovered ? graph.nodes.find((n) => n.id === hovered) ?? null : null;
  return /* @__PURE__ */ jsxs("div", { style: { width: "100%", height: "100%", overflow: "auto", position: "relative" }, children: [
    /* @__PURE__ */ jsxs("svg", { width: Math.max(VW, 400), height: Math.max(VH, 300), style: { display: "block" }, children: [
      columns.map((col, ci) => {
        const x = PAD + ci * (CARD_W + COL_GAP);
        return /* @__PURE__ */ jsxs("g", { children: [
          /* @__PURE__ */ jsx(
            "rect",
            {
              x,
              y: 8,
              width: CARD_W,
              height: 18,
              rx: 4,
              fill: "rgba(255,255,255,0.03)",
              stroke: "rgba(255,255,255,0.06)",
              strokeWidth: 0.5
            }
          ),
          /* @__PURE__ */ jsx(
            "text",
            {
              x: x + CARD_W / 2,
              y: 17,
              textAnchor: "middle",
              dominantBaseline: "central",
              style: { fill: "#334155", fontSize: 9, fontFamily: '"JetBrains Mono",monospace', letterSpacing: "0.07em" },
              children: COL_LABELS[col.depth] ?? "depth " + col.depth
            }
          )
        ] }, "hdr" + ci);
      }),
      crossEdges.map((edge) => {
        const sp = positions[edge.source], tp = positions[edge.target];
        if (!sp || !tp) return null;
        const x1 = sp.x + CARD_W, y1 = sp.y + CARD_H / 2;
        const x2 = tp.x, y2 = tp.y + CARD_H / 2;
        const mx = (x1 + x2) / 2;
        const col = edge.edgeType === "architecture" ? "#a78bfa" : edge.edgeType === "both" ? "#f472b6" : "#60a5fa";
        const dash = edge.confidence === "uncertain" ? "3,3" : edge.confidence === "medium" ? "5,3" : void 0;
        return /* @__PURE__ */ jsx(
          "path",
          {
            d: `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`,
            fill: "none",
            stroke: col,
            strokeWidth: Math.max(0.7, edge.strength * 0.35),
            strokeDasharray: dash,
            opacity: 0.4
          },
          edge.id
        );
      }),
      graph.nodes.map((node) => {
        const p = positions[node.id];
        if (!p) return null;
        const col = nc(node.type);
        const hov = hovered === node.id;
        const isExp = expanded === node.id;
        const canExp = (node.type === "module" || node.type === "layer") && node.files.length > 0;
        const lbl = node.label.length > 20 ? node.label.slice(0, 19) + "\u2026" : node.label;
        const role = node.detectedRole && node.detectedRole !== "unknown" ? node.detectedRole.length > 22 ? node.detectedRole.slice(0, 21) + "\u2026" : node.detectedRole : null;
        return /* @__PURE__ */ jsxs(
          "g",
          {
            onMouseEnter: () => setHovered(node.id),
            onMouseLeave: () => setHovered(null),
            onClick: () => {
              if (canExp) setExpanded((prev) => prev === node.id ? null : node.id);
              onNodeClick?.(node);
            },
            style: { cursor: "pointer" },
            children: [
              /* @__PURE__ */ jsx(
                "rect",
                {
                  x: p.x,
                  y: p.y,
                  width: CARD_W,
                  height: CARD_H,
                  rx: 6,
                  fill: isExp ? col.bg.replace("0.12", "0.35") : hov ? col.bg.replace("0.12", "0.3") : col.bg,
                  stroke: col.stroke,
                  strokeWidth: isExp ? 1.5 : hov ? 1.2 : 0.5,
                  strokeOpacity: isExp ? 1 : hov ? 1 : 0.6,
                  style: { transition: "fill 0.12s" }
                }
              ),
              /* @__PURE__ */ jsx(
                "text",
                {
                  x: p.x + 10,
                  y: p.y + 19,
                  style: { fill: col.text, fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700 },
                  children: lbl
                }
              ),
              role && /* @__PURE__ */ jsx(
                "text",
                {
                  x: p.x + 10,
                  y: p.y + 35,
                  style: { fill: "#475569", fontSize: 9, fontFamily: '"JetBrains Mono",monospace' },
                  children: role
                }
              ),
              node.files.length > 0 && /* @__PURE__ */ jsxs(
                "text",
                {
                  x: p.x + CARD_W - 7,
                  y: p.y + CARD_H - 7,
                  textAnchor: "end",
                  style: {
                    fill: isExp ? col.text : "#334155",
                    fontSize: 8,
                    fontFamily: '"JetBrains Mono",monospace'
                  },
                  children: [
                    node.files.length,
                    "f ",
                    canExp ? isExp ? "\u25B2" : "\u25BC" : ""
                  ]
                }
              )
            ]
          },
          node.id
        );
      })
    ] }),
    hovNode && /* @__PURE__ */ jsx(HoverCard, { node: hovNode, showFiles: expanded === hovNode.id })
  ] });
}
var DB_NAME = "repomap";
var DB_VERSION = 3;
var _db = null;
async function getDB() {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains("graphs")) {
        db.createObjectStore("graphs", { keyPath: "meta.repoUrl" });
      }
      if (!db.objectStoreNames.contains("progress")) {
        db.createObjectStore("progress", { keyPath: "repoUrl" });
      }
      if (!db.objectStoreNames.contains("branches")) {
        const branchStore = db.createObjectStore("branches", { keyPath: "id" });
        branchStore.createIndex("byRepoGraphId", "repoGraphId", { unique: false });
      } else {
        const branchStore = tx.objectStore("branches");
        if (!branchStore.indexNames.contains("byRepoGraphId")) {
          branchStore.createIndex("byRepoGraphId", "repoGraphId", { unique: false });
        }
      }
      if (!db.objectStoreNames.contains("branchDeltas")) {
        db.createObjectStore("branchDeltas", { keyPath: "branchId" });
      }
    }
  });
  return _db;
}
async function saveBranch(branch) {
  const db = await getDB();
  await db.put("branches", branch);
}
async function getBranch(branchId) {
  const db = await getDB();
  return db.get("branches", branchId);
}
async function getBranchesForRepo(repoGraphId) {
  const db = await getDB();
  const all = await db.getAllFromIndex("branches", "byRepoGraphId", repoGraphId);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
async function deleteBranch(branchId) {
  const db = await getDB();
  const tx = db.transaction(["branches", "branchDeltas"], "readwrite");
  await Promise.all([
    tx.objectStore("branches").delete(branchId),
    tx.objectStore("branchDeltas").delete(branchId),
    tx.done
  ]);
}
async function saveDelta(delta) {
  const db = await getDB();
  await db.put("branchDeltas", delta);
}
async function getDelta(branchId) {
  const db = await getDB();
  return db.get("branchDeltas", branchId);
}
function emptyDelta(branchId) {
  return {
    branchId,
    addedNodes: [],
    addedEdges: [],
    fictionalFiles: {}
  };
}
async function createBranch(params) {
  const id = `branch__${Date.now()}__${Math.random().toString(36).slice(2, 7)}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const branch = {
    id,
    name: params.name,
    description: params.description,
    color: params.color,
    parentBranchId: params.parentBranchId,
    repoGraphId: params.repoGraphId,
    createdAt: now,
    updatedAt: now
  };
  const db = await getDB();
  const tx = db.transaction(["branches", "branchDeltas"], "readwrite");
  await Promise.all([
    tx.objectStore("branches").put(branch),
    tx.objectStore("branchDeltas").put(emptyDelta(id)),
    tx.done
  ]);
  return branch;
}
async function addNodeToBranch(branchId, node) {
  const db = await getDB();
  const delta = await db.get("branchDeltas", branchId) ?? emptyDelta(branchId);
  delta.addedNodes = [...delta.addedNodes.filter((n) => n.id !== node.id), node];
  await db.put("branchDeltas", delta);
  await _touchBranch(db, branchId);
}
async function removeNodeFromBranch(branchId, nodeId) {
  const db = await getDB();
  const delta = await db.get("branchDeltas", branchId) ?? emptyDelta(branchId);
  delta.addedNodes = delta.addedNodes.filter((n) => n.id !== nodeId);
  delta.addedEdges = delta.addedEdges.filter(
    (e) => e.source !== nodeId && e.target !== nodeId
  );
  await db.put("branchDeltas", delta);
  await _touchBranch(db, branchId);
}
async function addEdgeToBranch(branchId, edge) {
  const db = await getDB();
  const delta = await db.get("branchDeltas", branchId) ?? emptyDelta(branchId);
  delta.addedEdges = [...delta.addedEdges.filter((e) => e.id !== edge.id), edge];
  await db.put("branchDeltas", delta);
  await _touchBranch(db, branchId);
}
async function removeEdgeFromBranch(branchId, edgeId) {
  const db = await getDB();
  const delta = await db.get("branchDeltas", branchId) ?? emptyDelta(branchId);
  delta.addedEdges = delta.addedEdges.filter((e) => e.id !== edgeId);
  await db.put("branchDeltas", delta);
  await _touchBranch(db, branchId);
}
async function addFictionalFile(branchId, nodeId, file) {
  const db = await getDB();
  const delta = await db.get("branchDeltas", branchId) ?? emptyDelta(branchId);
  const existing = delta.fictionalFiles[nodeId] ?? [];
  delta.fictionalFiles = {
    ...delta.fictionalFiles,
    [nodeId]: [...existing.filter((f) => f.id !== file.id), file]
  };
  await db.put("branchDeltas", delta);
  await _touchBranch(db, branchId);
}
async function removeFictionalFile(branchId, nodeId, fileId) {
  const db = await getDB();
  const delta = await db.get("branchDeltas", branchId) ?? emptyDelta(branchId);
  const existing = delta.fictionalFiles[nodeId] ?? [];
  delta.fictionalFiles = {
    ...delta.fictionalFiles,
    [nodeId]: existing.filter((f) => f.id !== fileId)
  };
  await db.put("branchDeltas", delta);
  await _touchBranch(db, branchId);
}
async function _touchBranch(db, branchId) {
  const branch = await db.get("branches", branchId);
  if (branch) {
    await db.put("branches", { ...branch, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
}

// src/branches/resolver.ts
async function resolveBranch(baseGraph, branchId) {
  if (branchId === null) {
    return buildBaseResolved(baseGraph);
  }
  const chain = await collectAncestorChain(branchId);
  const deltas = await Promise.all(chain.map((b) => getDelta(b.id)));
  const resolvedNodes = new Map(
    baseGraph.nodes.map((node) => [
      node.id,
      {
        ...node,
        fictionalFiles: [],
        origin: "base"
      }
    ])
  );
  const resolvedEdges = new Map(
    baseGraph.edges.map((edge) => [
      edge.id,
      { ...edge, origin: "base" }
    ])
  );
  for (let i = 0; i < chain.length; i++) {
    const branch = chain[i];
    const delta = deltas[i];
    if (!delta) continue;
    for (const node of delta.addedNodes) {
      resolvedNodes.set(node.id, {
        id: node.id,
        label: node.label,
        type: node.type,
        parentId: node.parentId,
        depth: node.depth,
        files: node.files,
        detectedRole: "",
        patterns: [],
        metadata: node.metadata ?? {},
        description: node.description,
        fictionalFiles: [],
        origin: branch.id
      });
    }
    for (const edge of delta.addedEdges) {
      resolvedEdges.set(edge.id, { ...edge, origin: branch.id });
    }
    for (const [nodeId, files] of Object.entries(delta.fictionalFiles)) {
      const existing = resolvedNodes.get(nodeId);
      if (existing) {
        const mergedFiles = mergeFictionalFiles(existing.fictionalFiles, files);
        resolvedNodes.set(nodeId, { ...existing, fictionalFiles: mergedFiles });
      }
    }
  }
  return {
    branchId,
    nodes: Array.from(resolvedNodes.values()),
    edges: Array.from(resolvedEdges.values())
  };
}
function buildBaseResolved(baseGraph) {
  return {
    branchId: null,
    nodes: baseGraph.nodes.map((node) => ({
      ...node,
      fictionalFiles: [],
      origin: "base"
    })),
    edges: baseGraph.edges.map((edge) => ({
      ...edge,
      origin: "base"
    }))
  };
}
async function collectAncestorChain(branchId) {
  const chain = [];
  let currentId = branchId;
  const MAX_DEPTH = 50;
  while (currentId !== null && chain.length < MAX_DEPTH) {
    const branch = await getBranch(currentId);
    if (!branch) break;
    chain.unshift(branch);
    currentId = branch.parentBranchId;
  }
  return chain;
}
function mergeFictionalFiles(existing, incoming) {
  const map = new Map(existing.map((f) => [f.id, f]));
  for (const f of incoming) {
    map.set(f.id, f);
  }
  return Array.from(map.values()).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}
function isNodeFromBranch(node, branchId) {
  return node.origin === branchId;
}
function isEdgeFromBranch(edge, branchId) {
  return edge.origin === branchId;
}
function newBranchNodeId(label, type) {
  const slug = label.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  return `${type}__branch__${slug}__${Date.now()}`;
}
function newBranchEdgeId(sourceId, targetId) {
  return `edge__branch__${sourceId}__${targetId}__${Date.now()}`;
}
function newFictionalFileId() {
  return `fictfile__${Date.now()}__${Math.random().toString(36).slice(2, 6)}`;
}
function reducer(state, action) {
  switch (action.type) {
    case "LOAD_START":
      return { ...state, loading: true, error: null };
    case "LOAD_SUCCESS":
      return {
        ...state,
        loading: false,
        branches: action.branches,
        resolvedGraph: action.resolvedGraph
      };
    case "LOAD_ERROR":
      return { ...state, loading: false, error: action.error };
    case "SET_ACTIVE":
      return {
        ...state,
        activeBranchId: action.branchId,
        resolvedGraph: action.resolvedGraph
      };
    case "BRANCHES_UPDATED":
      return { ...state, branches: action.branches };
    case "GRAPH_UPDATED":
      return { ...state, resolvedGraph: action.resolvedGraph };
    default:
      return state;
  }
}
var initialState = {
  branches: [],
  activeBranchId: null,
  resolvedGraph: null,
  loading: true,
  error: null
};
var BranchContext = createContext(null);
function BranchProvider({ baseGraph, children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const baseGraphRef = useRef(baseGraph);
  baseGraphRef.current = baseGraph;
  const repoGraphId = baseGraph.meta.repoUrl;
  useEffect(() => {
    let cancelled = false;
    async function load() {
      dispatch({ type: "LOAD_START" });
      try {
        const branches = await getBranchesForRepo(repoGraphId);
        const resolvedGraph = await resolveBranch(baseGraphRef.current, null);
        if (!cancelled) {
          dispatch({ type: "LOAD_SUCCESS", branches, resolvedGraph });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "LOAD_ERROR",
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [repoGraphId]);
  useEffect(() => {
    async function reResolve() {
      const resolved = await resolveBranch(baseGraph, state.activeBranchId);
      dispatch({ type: "GRAPH_UPDATED", resolvedGraph: resolved });
    }
    if (!state.loading) {
      reResolve();
    }
  }, [baseGraph]);
  const reResolveActive = useCallback(async () => {
    const resolved = await resolveBranch(baseGraphRef.current, state.activeBranchId);
    dispatch({ type: "GRAPH_UPDATED", resolvedGraph: resolved });
  }, [state.activeBranchId]);
  const reloadBranches = useCallback(async () => {
    const branches = await getBranchesForRepo(repoGraphId);
    dispatch({ type: "BRANCHES_UPDATED", branches });
    return branches;
  }, [repoGraphId]);
  const setActiveBranch = useCallback(async (branchId) => {
    const resolvedGraph = await resolveBranch(baseGraphRef.current, branchId);
    dispatch({ type: "SET_ACTIVE", branchId, resolvedGraph });
  }, []);
  const createNewBranch = useCallback(async (params) => {
    const branch = await createBranch({ ...params, repoGraphId });
    await reloadBranches();
    return branch;
  }, [repoGraphId, reloadBranches]);
  const updateBranch = useCallback(async (branchId, patch) => {
    const branches = await getBranchesForRepo(repoGraphId);
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) return;
    await saveBranch({ ...branch, ...patch, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    await reloadBranches();
  }, [repoGraphId, reloadBranches]);
  const removeBranch = useCallback(async (branchId) => {
    const branches = await getBranchesForRepo(repoGraphId);
    const toDelete = collectDescendants(branchId, branches);
    await Promise.all(toDelete.map((id) => deleteBranch(id)));
    const remainingBranches = await reloadBranches();
    if (state.activeBranchId && toDelete.includes(state.activeBranchId)) {
      const resolvedGraph = await resolveBranch(baseGraphRef.current, null);
      dispatch({ type: "SET_ACTIVE", branchId: null, resolvedGraph });
    } else {
      dispatch({ type: "BRANCHES_UPDATED", branches: remainingBranches });
    }
  }, [repoGraphId, reloadBranches, state.activeBranchId]);
  const addNode = useCallback(async (params) => {
    if (!state.activeBranchId) {
      throw new Error("Cannot add a node: no active branch. Create or select a branch first.");
    }
    const node = {
      id: newBranchNodeId(params.label, params.type),
      label: params.label,
      type: params.type,
      parentId: params.parentId,
      depth: params.depth,
      files: [],
      description: params.description,
      metadata: params.metadata
    };
    await addNodeToBranch(state.activeBranchId, node);
    await reResolveActive();
    return node;
  }, [state.activeBranchId, reResolveActive]);
  const removeNode = useCallback(async (nodeId) => {
    if (!state.activeBranchId) return;
    await removeNodeFromBranch(state.activeBranchId, nodeId);
    await reResolveActive();
  }, [state.activeBranchId, reResolveActive]);
  const addEdge3 = useCallback(async (params) => {
    if (!state.activeBranchId) {
      throw new Error("Cannot add an edge: no active branch.");
    }
    const edge = {
      id: newBranchEdgeId(params.source, params.target),
      source: params.source,
      target: params.target,
      edgeType: params.edgeType,
      strength: params.strength,
      label: params.label,
      confidence: params.confidence
    };
    await addEdgeToBranch(state.activeBranchId, edge);
    await reResolveActive();
    return edge;
  }, [state.activeBranchId, reResolveActive]);
  const removeEdge = useCallback(async (edgeId) => {
    if (!state.activeBranchId) return;
    await removeEdgeFromBranch(state.activeBranchId, edgeId);
    await reResolveActive();
  }, [state.activeBranchId, reResolveActive]);
  const replaceActiveBranchGraph = useCallback(async (editedGraph) => {
    if (!state.activeBranchId) {
      throw new Error("Cannot edit branch graph: no active branch.");
    }
    const activeBranch = state.branches.find((branch) => branch.id === state.activeBranchId);
    if (!activeBranch) {
      throw new Error("Cannot edit branch graph: active branch was not found.");
    }
    const parentResolved = await resolveBranch(baseGraphRef.current, activeBranch.parentBranchId);
    const parentNodeIds = new Set(parentResolved.nodes.map((node) => node.id));
    const parentEdgeIds = new Set(parentResolved.edges.map((edge) => edge.id));
    const existingDelta = await getDelta(state.activeBranchId);
    const nextDelta = {
      branchId: state.activeBranchId,
      addedNodes: editedGraph.nodes.filter((node) => !parentNodeIds.has(node.id)).map((node) => ({
        id: node.id,
        label: node.label,
        type: node.type,
        parentId: node.parentId,
        depth: node.depth,
        files: node.files,
        description: node.detectedRole || void 0,
        metadata: node.metadata
      })),
      addedEdges: editedGraph.edges.filter((edge) => !parentEdgeIds.has(edge.id)).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        edgeType: edge.edgeType,
        strength: edge.strength,
        label: edge.label,
        confidence: edge.confidence
      })),
      fictionalFiles: existingDelta?.fictionalFiles ?? {}
    };
    await saveDelta(nextDelta);
    await saveBranch({ ...activeBranch, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    await reloadBranches();
    const resolvedGraph = await resolveBranch(baseGraphRef.current, state.activeBranchId);
    dispatch({ type: "GRAPH_UPDATED", resolvedGraph });
  }, [state.activeBranchId, state.branches, reloadBranches]);
  const addFictionalFileToNode = useCallback(async (params) => {
    if (!state.activeBranchId) {
      throw new Error("Cannot add a fictional file: no active branch.");
    }
    const file = {
      id: newFictionalFileId(),
      name: params.name,
      description: params.description,
      pseudocode: params.pseudocode,
      addedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await addFictionalFile(state.activeBranchId, params.nodeId, file);
    await reResolveActive();
    return file;
  }, [state.activeBranchId, reResolveActive]);
  const removeFictionalFileFromNode = useCallback(async (nodeId, fileId) => {
    if (!state.activeBranchId) return;
    await removeFictionalFile(state.activeBranchId, nodeId, fileId);
    await reResolveActive();
  }, [state.activeBranchId, reResolveActive]);
  const isOnBranch = state.activeBranchId !== null;
  const canDeleteNode = useCallback((nodeId) => {
    if (!state.activeBranchId || !state.resolvedGraph) return false;
    const node = state.resolvedGraph.nodes.find((n) => n.id === nodeId);
    if (!node) return false;
    return isNodeFromBranch(node, state.activeBranchId);
  }, [state.activeBranchId, state.resolvedGraph]);
  const canDeleteEdge = useCallback((edgeId) => {
    if (!state.activeBranchId || !state.resolvedGraph) return false;
    const edge = state.resolvedGraph.edges.find((e) => e.id === edgeId);
    if (!edge) return false;
    return isEdgeFromBranch(edge, state.activeBranchId);
  }, [state.activeBranchId, state.resolvedGraph]);
  const childrenOf = useCallback((parentId) => {
    return state.branches.filter((b) => b.parentBranchId === parentId);
  }, [state.branches]);
  const value = useMemo(() => ({
    ...state,
    setActiveBranch,
    createNewBranch,
    updateBranch,
    removeBranch,
    addNode,
    removeNode,
    addEdge: addEdge3,
    removeEdge,
    replaceActiveBranchGraph,
    addFictionalFileToNode,
    removeFictionalFileFromNode,
    isOnBranch,
    canDeleteNode,
    canDeleteEdge,
    childrenOf
  }), [
    state,
    setActiveBranch,
    createNewBranch,
    updateBranch,
    removeBranch,
    addNode,
    removeNode,
    addEdge3,
    removeEdge,
    replaceActiveBranchGraph,
    addFictionalFileToNode,
    removeFictionalFileFromNode,
    isOnBranch,
    canDeleteNode,
    canDeleteEdge,
    childrenOf
  ]);
  return /* @__PURE__ */ jsx(BranchContext.Provider, { value, children });
}
function useBranches() {
  const ctx = useContext(BranchContext);
  if (!ctx) {
    throw new Error("useBranches must be used inside <BranchProvider>");
  }
  return ctx;
}
function collectDescendants(rootId, allBranches) {
  const result = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    const children = allBranches.filter((b) => b.parentBranchId === current);
    for (const child of children) {
      result.push(child.id);
      queue.push(child.id);
    }
  }
  return result;
}
var BRANCH_COLORS = [
  "#60a5fa",
  // blue
  "#34d399",
  // emerald
  "#f472b6",
  // pink
  "#fb923c",
  // orange
  "#a78bfa",
  // violet
  "#facc15",
  // yellow
  "#22d3ee",
  // cyan
  "#f87171"
  // red
];
function pickColor(index) {
  return BRANCH_COLORS[index % BRANCH_COLORS.length];
}
function BranchPanel() {
  const {
    branches,
    activeBranchId,
    loading,
    error,
    isOnBranch,
    setActiveBranch,
    createNewBranch,
    removeBranch,
    updateBranch,
    childrenOf
  } = useBranches();
  const [creating, setCreating] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const openCreate = useCallback((parentBranchId) => {
    const index = branches.length;
    setCreating({
      parentBranchId,
      name: "",
      description: "",
      color: pickColor(index)
    });
    setEditingId(null);
  }, [branches.length]);
  const handleCreate = useCallback(async () => {
    if (!creating || !creating.name.trim()) return;
    const branch = await createNewBranch({
      name: creating.name.trim(),
      description: creating.description.trim() || void 0,
      color: creating.color,
      parentBranchId: creating.parentBranchId
    });
    setCreating(null);
    await setActiveBranch(branch.id);
  }, [creating, createNewBranch, setActiveBranch]);
  const rootBranches = childrenOf(null);
  return /* @__PURE__ */ jsxs("aside", { style: styles.panel, children: [
    /* @__PURE__ */ jsxs("div", { style: styles.header, children: [
      /* @__PURE__ */ jsx("span", { style: styles.headerLabel, children: "BRANCHES" }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          style: styles.newBranchBtn,
          onClick: () => openCreate(null),
          title: "New branch from base",
          children: [
            /* @__PURE__ */ jsx(PlusIcon, {}),
            "New"
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsxs(
      "button",
      {
        style: {
          ...styles.baseRow,
          ...activeBranchId === null ? styles.baseRowActive : {}
        },
        onClick: () => setActiveBranch(null),
        children: [
          /* @__PURE__ */ jsx("span", { style: styles.baseIcon, children: "\u25C8" }),
          /* @__PURE__ */ jsx("span", { style: styles.baseName, children: "Base graph" }),
          activeBranchId === null && /* @__PURE__ */ jsx("span", { style: styles.activePill, children: "active" })
        ]
      }
    ),
    /* @__PURE__ */ jsx("div", { style: styles.divider }),
    /* @__PURE__ */ jsxs("div", { style: styles.treeContainer, children: [
      loading && /* @__PURE__ */ jsx("span", { style: styles.dimText, children: "Loading\u2026" }),
      error && /* @__PURE__ */ jsx("span", { style: styles.errorText, children: error }),
      !loading && branches.length === 0 && /* @__PURE__ */ jsxs("div", { style: styles.emptyState, children: [
        /* @__PURE__ */ jsx("span", { style: styles.emptyIcon, children: "\u2442" }),
        /* @__PURE__ */ jsx("span", { style: styles.emptyText, children: "No branches yet." }),
        /* @__PURE__ */ jsx("span", { style: styles.emptyHint, children: 'Create one to start exploring "what-if" changes without touching the base graph.' })
      ] }),
      rootBranches.map((branch) => /* @__PURE__ */ jsx(
        BranchTreeNode,
        {
          branch,
          depth: 0,
          activeBranchId,
          editingId,
          creating,
          onActivate: setActiveBranch,
          onStartEdit: setEditingId,
          onFinishEdit: async (id, patch) => {
            await updateBranch(id, patch);
            setEditingId(null);
          },
          onDelete: removeBranch,
          onCreateChild: openCreate,
          onSubmitCreate: handleCreate,
          onCancelCreate: () => setCreating(null),
          onChangeCreate: setCreating,
          childrenOf
        },
        branch.id
      )),
      creating && creating.parentBranchId === null && /* @__PURE__ */ jsx(
        CreateForm,
        {
          value: creating,
          depth: 0,
          onChange: setCreating,
          onSubmit: handleCreate,
          onCancel: () => setCreating(null)
        }
      )
    ] })
  ] });
}
function BranchTreeNode({
  branch,
  depth,
  activeBranchId,
  editingId,
  creating,
  onActivate,
  onStartEdit,
  onFinishEdit,
  onDelete,
  onCreateChild,
  onSubmitCreate,
  onCancelCreate,
  onChangeCreate,
  childrenOf
}) {
  const isActive = activeBranchId === branch.id;
  const isEditing = editingId === branch.id;
  const children = childrenOf(branch.id);
  const [editName, setEditName] = useState(branch.name);
  const [editDesc, setEditDesc] = useState(branch.description ?? "");
  const [hovered, setHovered] = useState(false);
  const nameRef = useRef(null);
  useEffect(() => {
    if (isEditing) nameRef.current?.focus();
  }, [isEditing]);
  const indent = depth * 16;
  return /* @__PURE__ */ jsxs("div", { style: { marginLeft: indent }, children: [
    depth > 0 && /* @__PURE__ */ jsx("div", { style: styles.connector }),
    isEditing ? /* @__PURE__ */ jsxs("div", { style: styles.editRow, children: [
      /* @__PURE__ */ jsx(
        "span",
        {
          style: { ...styles.colorDot, background: branch.color ?? "#60a5fa" }
        }
      ),
      /* @__PURE__ */ jsx(
        "input",
        {
          ref: nameRef,
          style: styles.editInput,
          value: editName,
          onChange: (e) => setEditName(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") onFinishEdit(branch.id, { name: editName, description: editDesc });
            if (e.key === "Escape") onStartEdit("");
          },
          placeholder: "Branch name"
        }
      ),
      /* @__PURE__ */ jsx(
        "input",
        {
          style: { ...styles.editInput, fontSize: 11, opacity: 0.6 },
          value: editDesc,
          onChange: (e) => setEditDesc(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") onFinishEdit(branch.id, { name: editName, description: editDesc });
            if (e.key === "Escape") onStartEdit("");
          },
          placeholder: "Description (optional)"
        }
      ),
      /* @__PURE__ */ jsxs("div", { style: styles.editActions, children: [
        /* @__PURE__ */ jsx(
          "button",
          {
            style: styles.confirmBtn,
            onClick: () => onFinishEdit(branch.id, { name: editName, description: editDesc }),
            children: "\u2713"
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            style: styles.cancelBtn,
            onClick: () => onStartEdit(""),
            children: "\u2715"
          }
        )
      ] })
    ] }) : /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          ...styles.branchRow,
          ...isActive ? styles.branchRowActive : {},
          ...hovered && !isActive ? styles.branchRowHover : {}
        },
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        children: [
          /* @__PURE__ */ jsxs(
            "button",
            {
              style: styles.branchMain,
              onClick: () => onActivate(branch.id),
              children: [
                /* @__PURE__ */ jsx("span", { style: { ...styles.colorDot, background: branch.color ?? "#60a5fa" } }),
                /* @__PURE__ */ jsx("span", { style: styles.branchName, children: branch.name }),
                isActive && /* @__PURE__ */ jsx("span", { style: styles.activePill, children: "active" })
              ]
            }
          ),
          (hovered || isActive) && /* @__PURE__ */ jsxs("div", { style: styles.rowActions, children: [
            /* @__PURE__ */ jsx(
              ActionButton,
              {
                title: "Create child branch",
                onClick: () => onCreateChild(branch.id),
                children: "\u2442"
              }
            ),
            /* @__PURE__ */ jsx(
              ActionButton,
              {
                title: "Rename",
                onClick: () => onStartEdit(branch.id),
                children: "\u270E"
              }
            ),
            /* @__PURE__ */ jsx(
              ActionButton,
              {
                title: "Delete branch",
                danger: true,
                onClick: () => {
                  if (confirm(`Delete branch "${branch.name}" and all its children?`)) {
                    onDelete(branch.id);
                  }
                },
                children: "\u2715"
              }
            )
          ] })
        ]
      }
    ),
    !isEditing && branch.description && /* @__PURE__ */ jsx("div", { style: { ...styles.branchDesc, marginLeft: 16 + indent }, children: branch.description }),
    children.map((child) => /* @__PURE__ */ jsx(
      BranchTreeNode,
      {
        branch: child,
        depth: depth + 1,
        activeBranchId,
        editingId,
        creating,
        onActivate,
        onStartEdit,
        onFinishEdit,
        onDelete,
        onCreateChild,
        onSubmitCreate,
        onCancelCreate,
        onChangeCreate,
        childrenOf
      },
      child.id
    )),
    creating && creating.parentBranchId === branch.id && /* @__PURE__ */ jsx(
      CreateForm,
      {
        value: creating,
        depth: depth + 1,
        onChange: onChangeCreate,
        onSubmit: onSubmitCreate,
        onCancel: onCancelCreate
      }
    )
  ] });
}
function CreateForm({ value, depth, onChange, onSubmit, onCancel }) {
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return /* @__PURE__ */ jsxs("div", { style: { marginLeft: depth * 16, ...styles.createForm }, children: [
    /* @__PURE__ */ jsx("div", { style: styles.colorRow, children: BRANCH_COLORS.map((c) => /* @__PURE__ */ jsx(
      "button",
      {
        style: {
          ...styles.colorSwatch,
          background: c,
          outline: value.color === c ? `2px solid #fff` : "none",
          outlineOffset: 2
        },
        onClick: () => onChange({ ...value, color: c })
      },
      c
    )) }),
    /* @__PURE__ */ jsx(
      "input",
      {
        ref: inputRef,
        style: styles.createInput,
        placeholder: "Branch name\u2026",
        value: value.name,
        onChange: (e) => onChange({ ...value, name: e.target.value }),
        onKeyDown: (e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }
      }
    ),
    /* @__PURE__ */ jsx(
      "input",
      {
        style: { ...styles.createInput, fontSize: 11, opacity: 0.65 },
        placeholder: "Description (optional)",
        value: value.description,
        onChange: (e) => onChange({ ...value, description: e.target.value }),
        onKeyDown: (e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }
      }
    ),
    /* @__PURE__ */ jsxs("div", { style: styles.createActions, children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          style: styles.createSubmit,
          onClick: onSubmit,
          disabled: !value.name.trim(),
          children: "Create branch"
        }
      ),
      /* @__PURE__ */ jsx("button", { style: styles.cancelBtn, onClick: onCancel, children: "Cancel" })
    ] })
  ] });
}
function ActionButton({
  children,
  title,
  danger = false,
  onClick
}) {
  return /* @__PURE__ */ jsx(
    "button",
    {
      title,
      onClick: (e) => {
        e.stopPropagation();
        onClick();
      },
      style: {
        ...styles.actionBtn,
        ...danger ? styles.actionBtnDanger : {}
      },
      children
    }
  );
}
function PlusIcon() {
  return /* @__PURE__ */ jsx("svg", { width: "10", height: "10", viewBox: "0 0 10 10", fill: "none", style: { marginRight: 4 }, children: /* @__PURE__ */ jsx("path", { d: "M5 1v8M1 5h8", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }) });
}
var styles = {
  panel: {
    width: 240,
    minWidth: 240,
    height: "100%",
    background: "#0f1117",
    borderRight: "1px solid #1e2130",
    display: "flex",
    flexDirection: "column",
    fontFamily: '"Inter", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
    fontSize: 13,
    color: "#c9d1d9",
    overflowY: "auto",
    userSelect: "none"
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 12px 10px",
    borderBottom: "1px solid #1e2130"
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: "#4b5563"
  },
  newBranchBtn: {
    display: "flex",
    alignItems: "center",
    background: "#1a2035",
    border: "1px solid #2a3350",
    borderRadius: 4,
    color: "#93c5fd",
    fontSize: 11,
    padding: "3px 8px",
    cursor: "pointer",
    transition: "background 0.15s"
  },
  baseRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "9px 12px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "#9ca3af",
    fontSize: 12,
    textAlign: "left",
    transition: "background 0.1s"
  },
  baseRowActive: {
    background: "#111827",
    color: "#f9fafb"
  },
  baseIcon: {
    fontSize: 14,
    color: "#374151"
  },
  baseName: {
    flex: 1,
    fontFamily: "inherit"
  },
  activePill: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.08em",
    background: "#1e3a5f",
    color: "#60a5fa",
    borderRadius: 3,
    padding: "1px 5px",
    textTransform: "uppercase"
  },
  divider: {
    height: 1,
    background: "#1e2130",
    margin: "0 0 4px"
  },
  treeContainer: {
    flex: 1,
    padding: "4px 0 16px",
    overflowY: "auto"
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    padding: "32px 20px",
    textAlign: "center"
  },
  emptyIcon: {
    fontSize: 28,
    color: "#1f2937"
  },
  emptyText: {
    color: "#4b5563",
    fontWeight: 600,
    fontSize: 12
  },
  emptyHint: {
    color: "#374151",
    fontSize: 11,
    lineHeight: 1.5
  },
  connector: {
    position: "absolute",
    left: -8,
    top: 0,
    bottom: 0,
    width: 1,
    background: "#1e2130"
  },
  branchRow: {
    display: "flex",
    alignItems: "center",
    padding: "6px 8px 6px 12px",
    borderRadius: 4,
    margin: "1px 6px",
    transition: "background 0.14s ease, transform 0.14s ease",
    position: "relative"
  },
  branchRowActive: {
    background: "#111827"
  },
  branchRowHover: {
    background: "#0d1117",
    transform: "translateX(2px)"
  },
  branchMain: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 7,
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "inherit",
    padding: 0,
    fontSize: 12,
    fontFamily: "inherit",
    textAlign: "left",
    minWidth: 0
  },
  colorDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0
  },
  branchName: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#e2e8f0"
  },
  branchDesc: {
    fontSize: 10,
    color: "#4b5563",
    padding: "0 12px 4px",
    lineHeight: 1.4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  },
  rowActions: {
    display: "flex",
    gap: 2,
    flexShrink: 0
  },
  actionBtn: {
    background: "none",
    border: "none",
    color: "#4b5563",
    cursor: "pointer",
    fontSize: 13,
    padding: "2px 4px",
    borderRadius: 3,
    lineHeight: 1,
    transition: "color 0.1s"
  },
  actionBtnDanger: {
    color: "#6b2737"
  },
  editRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "6px 10px",
    background: "#0d1117",
    borderRadius: 4,
    margin: "1px 6px",
    border: "1px solid #1e3a5f"
  },
  editInput: {
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #1e3a5f",
    color: "#e2e8f0",
    fontSize: 12,
    fontFamily: "inherit",
    padding: "2px 0",
    outline: "none",
    width: "100%"
  },
  editActions: {
    display: "flex",
    gap: 6,
    justifyContent: "flex-end",
    marginTop: 2
  },
  confirmBtn: {
    background: "#1e3a5f",
    border: "none",
    color: "#60a5fa",
    borderRadius: 3,
    padding: "2px 8px",
    cursor: "pointer",
    fontSize: 12
  },
  cancelBtn: {
    background: "none",
    border: "none",
    color: "#4b5563",
    cursor: "pointer",
    fontSize: 12,
    padding: "2px 6px"
  },
  createForm: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: "8px 10px",
    background: "#0d1117",
    borderRadius: 4,
    margin: "4px 6px",
    border: "1px solid #1e3a5f"
  },
  colorRow: {
    display: "flex",
    gap: 5,
    marginBottom: 2
  },
  colorSwatch: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    padding: 0,
    transition: "transform 0.1s"
  },
  createInput: {
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #1e2130",
    color: "#e2e8f0",
    fontSize: 12,
    fontFamily: "inherit",
    padding: "3px 0",
    outline: "none",
    width: "100%"
  },
  createActions: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    marginTop: 2
  },
  createSubmit: {
    background: "#1e3a5f",
    border: "1px solid #2a4a7f",
    color: "#93c5fd",
    borderRadius: 4,
    padding: "3px 10px",
    cursor: "pointer",
    fontSize: 11,
    fontFamily: "inherit"
  },
  dimText: {
    color: "#374151",
    padding: "12px 16px",
    display: "block"
  },
  errorText: {
    color: "#f87171",
    padding: "12px 16px",
    display: "block",
    fontSize: 11
  }
};
var DEFAULT_FILTERS = {
  showEngineering: true,
  showArchitecture: true,
  showBoth: true,
  showUncertain: true,
  minStrength: 1
};
function GraphRenderer({ graph, onOverlayChange }) {
  const {
    isOnBranch,
    resolvedGraph,
    activeBranchId,
    branches,
    replaceActiveBranchGraph
  } = useBranches();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [annotations, setAnnotations] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [sidebarTab, setSidebarTab] = useState("filters");
  const [branchEditOpen, setBranchEditOpen] = useState(false);
  const [viewType, setViewType] = useState(
    () => recommendedView(graph.meta.layoutTemplate)
  );
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (isOnBranch && resolvedGraph) {
      return buildReactFlowGraphFromResolved(resolvedGraph, graph.meta.layoutTemplate);
    }
    return buildReactFlowGraph(graph);
  }, [isOnBranch, resolvedGraph, graph]);
  const flowKey = activeBranchId ?? "__base__";
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [flowKey, initialNodes, initialEdges, setNodes, setEdges]);
  const visibleEdges = useMemo(() => edges.filter((e) => {
    const d = e.data;
    const type = d?.edgeType ?? "engineering";
    const conf = d?.confidence ?? "high";
    const str = d?.strength ?? 1;
    if (!filters.showEngineering && type === "engineering") return false;
    if (!filters.showArchitecture && type === "architecture") return false;
    if (!filters.showBoth && type === "both") return false;
    if (!filters.showUncertain && conf === "uncertain") return false;
    if (str < filters.minStrength) return false;
    return true;
  }), [edges, filters]);
  const annotatedNodes = useMemo(() => nodes.map((n) => {
    const ann = annotations[n.id];
    if (!ann) return n;
    return {
      ...n,
      data: {
        ...n.data,
        label: ann.customLabel ?? n.data.label,
        statusTag: ann.statusTag !== "none" ? ann.statusTag : void 0
      }
    };
  }), [nodes, annotations]);
  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, type: "repoEdge" }, eds)),
    [setEdges]
  );
  const onNodeClick = useCallback((_, node) => {
    setSelectedId(node.id);
    setSidebarTab("node");
  }, []);
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId]
  );
  const selectedAnn = selectedId ? annotations[selectedId] ?? {} : {};
  function updateAnnotation(id, patch) {
    setAnnotations((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }
  function handleExportSVG() {
    const svg = document.querySelector(".react-flow__renderer svg");
    if (!svg) return;
    download(new Blob([svg.outerHTML], { type: "image/svg+xml" }), `${graph.meta.repoName.replace("/", "_")}.svg`);
  }
  function handleExportPNG() {
    const svg = document.querySelector(".react-flow__renderer svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const bbox = svg.getBoundingClientRect();
    canvas.width = bbox.width * 2;
    canvas.height = bbox.height * 2;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "#0b0f1a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => b && download(b, `${graph.meta.repoName.replace("/", "_")}.png`));
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  }
  async function handleBranchEditorComplete(editedGraph) {
    await replaceActiveBranchGraph(editedGraph);
    setBranchEditOpen(false);
  }
  const edgeCounts = useMemo(() => {
    const c = { engineering: 0, architecture: 0, both: 0, uncertain: 0 };
    edges.forEach((e) => {
      const d = e.data;
      const type = d?.edgeType ?? "engineering";
      const conf = d?.confidence ?? "high";
      if (type === "engineering") c.engineering++;
      if (type === "architecture") c.architecture++;
      if (type === "both") c.both++;
      if (conf === "uncertain") c.uncertain++;
    });
    return c;
  }, [edges]);
  const nodeCounts = useMemo(() => {
    const c = { layer: 0, module: 0, file: 0, component: 0 };
    nodes.forEach((n) => {
      const type = n.data.nodeType;
      if (type && type in c) c[type]++;
    });
    return c;
  }, [nodes]);
  return /* @__PURE__ */ jsxs("div", { style: { width: "100%", height: "100%", display: "flex", background: "#0b0f1a", fontFamily: '"Inter", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif' }, children: [
    /* @__PURE__ */ jsxs("div", { style: sidebarStyle, children: [
      /* @__PURE__ */ jsxs("div", { style: { fontSize: 11, color: "#3b82f6", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 14 }, children: [
        "{",
        /* @__PURE__ */ jsx("span", { style: { color: "#a78bfa" }, children: "repo" }),
        "map",
        "}"
      ] }),
      /* @__PURE__ */ jsx("div", { style: { display: "flex", borderBottom: "1px solid #1e293b", marginBottom: 16 }, children: ["filters", "node", "export", "branches"].map((tab) => /* @__PURE__ */ jsxs(
        "button",
        {
          onClick: () => setSidebarTab(tab),
          style: {
            ...tabBtnStyle,
            color: sidebarTab === tab ? "#93c5fd" : "#475569",
            borderBottom: sidebarTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
            position: "relative"
          },
          children: [
            tab === "filters" ? "\u2699" : tab === "node" ? "\u25CE" : tab === "export" ? "\u2197" : "\u2442",
            " ",
            tab,
            tab === "branches" && isOnBranch && /* @__PURE__ */ jsx("span", { style: {
              position: "absolute",
              top: 4,
              right: 2,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: activeBranch?.color ?? "#60a5fa",
              display: "block"
            } })
          ]
        },
        tab
      )) }),
      sidebarTab === "filters" && /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [
        /* @__PURE__ */ jsx(Section, { title: "Connection type", subtitle: "Toggle edge layers", children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [
          /* @__PURE__ */ jsx(ToggleRow, { label: "Runtime calls", color: "#60a5fa", count: edgeCounts.engineering, value: filters.showEngineering, onChange: (v) => setFilters((f) => ({ ...f, showEngineering: v })) }),
          /* @__PURE__ */ jsx(ToggleRow, { label: "Design structure", color: "#c084fc", count: edgeCounts.architecture, value: filters.showArchitecture, onChange: (v) => setFilters((f) => ({ ...f, showArchitecture: v })) }),
          /* @__PURE__ */ jsx(ToggleRow, { label: "Mixed", color: "#f472b6", count: edgeCounts.both, value: filters.showBoth, onChange: (v) => setFilters((f) => ({ ...f, showBoth: v })) }),
          /* @__PURE__ */ jsx(ToggleRow, { label: "Uncertain", color: "#64748b", count: edgeCounts.uncertain, value: filters.showUncertain, onChange: (v) => setFilters((f) => ({ ...f, showUncertain: v })) })
        ] }) }),
        /* @__PURE__ */ jsxs(Section, { title: "Min strength", children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "range",
              min: 1,
              max: 5,
              step: 1,
              value: filters.minStrength,
              onChange: (e) => setFilters((f) => ({ ...f, minStrength: Number(e.target.value) })),
              style: { width: "100%", accentColor: "#3b82f6" }
            }
          ),
          /* @__PURE__ */ jsx("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 9, color: "#334155", marginTop: 2 }, children: [1, 2, 3, 4, 5].map((v) => /* @__PURE__ */ jsx("span", { style: { color: filters.minStrength === v ? "#93c5fd" : void 0 }, children: v }, v)) })
        ] }),
        /* @__PURE__ */ jsx(Section, { title: "View", children: /* @__PURE__ */ jsx(ViewSwitcher, { current: viewType, recommended: recommendedView(graph.meta.layoutTemplate), onChange: setViewType }) })
      ] }),
      sidebarTab === "node" && /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: 16 }, children: !selectedNode ? /* @__PURE__ */ jsx("div", { style: { fontSize: 11, color: "#334155", paddingTop: 8 }, children: "Click a node to inspect it." }) : /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { style: { fontSize: 13, fontWeight: 700, color: "#e2e8f0" }, children: selectedNode.data.label }),
          /* @__PURE__ */ jsx("div", { style: { fontSize: 10, color: "#475569", marginTop: 2 }, children: selectedNode.id })
        ] }),
        selectedNode.data.isBranchNode && /* @__PURE__ */ jsx("div", { style: { fontSize: 10, color: "#60a5fa", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.15)", borderRadius: 6, padding: "6px 10px" }, children: "\u2442 Added in branch" }),
        /* @__PURE__ */ jsx(Section, { title: "Custom label", children: /* @__PURE__ */ jsx("input", { style: sidebarInputStyle, placeholder: selectedNode.data.label, value: selectedAnn.customLabel ?? "", onChange: (e) => updateAnnotation(selectedNode.id, { customLabel: e.target.value || void 0 }) }) }),
        /* @__PURE__ */ jsx(Section, { title: "Annotation", children: /* @__PURE__ */ jsx("textarea", { style: { ...sidebarInputStyle, resize: "vertical", minHeight: 60 }, placeholder: "Add a note\u2026", value: selectedAnn.annotation ?? "", onChange: (e) => updateAnnotation(selectedNode.id, { annotation: e.target.value || void 0 }) }) }),
        /* @__PURE__ */ jsx(Section, { title: "Status tag", children: /* @__PURE__ */ jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: ["none", "stable", "in_refactor", "legacy", "deprecated"].map((tag) => /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => updateAnnotation(selectedNode.id, { statusTag: tag }),
            style: {
              ...ghostBtn,
              color: selectedAnn.statusTag === tag || !selectedAnn.statusTag && tag === "none" ? "#93c5fd" : "#475569",
              borderColor: selectedAnn.statusTag === tag || !selectedAnn.statusTag && tag === "none" ? "#3b82f6" : "#1e293b"
            },
            children: tag === "none" ? "none" : tag.replace("_", " ")
          },
          tag
        )) }) })
      ] }) }),
      sidebarTab === "export" && /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: [
        /* @__PURE__ */ jsx(Section, { title: "Export graph", children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
          /* @__PURE__ */ jsx(ExportBtn, { label: "Export SVG", sub: "Vector, scalable", onClick: handleExportSVG }),
          /* @__PURE__ */ jsx(ExportBtn, { label: "Export PNG", sub: "Raster, 2\xD7 density", onClick: handleExportPNG })
        ] }) }),
        isOnBranch && activeBranch && /* @__PURE__ */ jsx(Section, { title: "Branch note", children: /* @__PURE__ */ jsxs("div", { style: { fontSize: 10, color: "#60a5fa", background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.15)", borderRadius: 6, padding: "8px 10px" }, children: [
          "Exporting ",
          /* @__PURE__ */ jsx("strong", { children: activeBranch.name }),
          " \u2014 branch nodes included."
        ] }) })
      ] }),
      sidebarTab === "branches" && /* @__PURE__ */ jsx("div", { style: { flex: 1, display: "flex", flexDirection: "column", margin: "0 -14px", overflow: "hidden" }, children: /* @__PURE__ */ jsx(BranchPanel, {}) })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { flex: 1, position: "relative", overflow: "hidden" }, children: [
      isOnBranch && activeBranch && /* @__PURE__ */ jsxs("div", { style: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        background: "rgba(15,23,42,0.92)",
        borderBottom: `2px solid ${activeBranch.color ?? "#60a5fa"}`,
        padding: "5px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        backdropFilter: "blur(6px)",
        fontSize: 12,
        fontFamily: "inherit"
      }, children: [
        /* @__PURE__ */ jsx("span", { style: { width: 8, height: 8, borderRadius: "50%", background: activeBranch.color ?? "#60a5fa", flexShrink: 0, display: "inline-block" } }),
        /* @__PURE__ */ jsxs("span", { style: { color: "#60a5fa", fontWeight: 700 }, children: [
          "\u2442 ",
          activeBranch.name
        ] }),
        activeBranch.description && /* @__PURE__ */ jsx("span", { style: { color: "#374151", borderLeft: "1px solid #1e293b", paddingLeft: 10 }, children: activeBranch.description }),
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => setBranchEditOpen(true),
            style: { marginLeft: "auto", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: 4, color: "#93c5fd", fontSize: 10, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" },
            children: "edit branch"
          }
        ),
        /* @__PURE__ */ jsx(
          "button",
          {
            onClick: () => setSidebarTab("branches"),
            style: { background: "none", border: "1px solid #1e293b", borderRadius: 4, color: "#475569", fontSize: 10, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" },
            children: "manage"
          }
        )
      ] }),
      viewType === "graph" && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs(
          ReactFlow,
          {
            nodes: annotatedNodes,
            edges: visibleEdges,
            onNodesChange,
            onEdgesChange,
            onConnect,
            onNodeClick,
            nodeTypes,
            edgeTypes,
            fitView: true,
            style: { background: "#0b0f1a", paddingTop: isOnBranch ? 36 : 0 },
            children: [
              /* @__PURE__ */ jsx(Background, { variant: BackgroundVariant.Dots, gap: 24, size: 1.5, color: "#1e2a3a" }),
              /* @__PURE__ */ jsx(Controls, { style: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 } }),
              /* @__PURE__ */ jsx(
                MiniMap,
                {
                  style: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 },
                  nodeColor: (n) => {
                    const t = n.data.nodeType;
                    return t === "layer" ? "#60a5fa" : t === "module" ? "#a78bfa" : t === "file" ? "#34d399" : "#fb923c";
                  },
                  maskColor: "rgba(0,0,0,0.6)"
                }
              )
            ]
          },
          flowKey
        ),
        /* @__PURE__ */ jsx(Legend, { nodeCounts, edgeCounts })
      ] }),
      viewType !== "graph" && /* @__PURE__ */ jsxs("div", { style: { position: "absolute", inset: 0, paddingTop: isOnBranch ? 256 : 220, boxSizing: "border-box" }, children: [
        viewType === "onion" && /* @__PURE__ */ jsx(OnionView, { graph, onNodeClick: (n) => {
          setSelectedId(n.id);
          setSidebarTab("node");
        } }),
        viewType === "layers" && /* @__PURE__ */ jsx(LayerStackView, { graph, onNodeClick: (n) => {
          setSelectedId(n.id);
          setSidebarTab("node");
        } }),
        viewType === "clusters" && /* @__PURE__ */ jsx(ClusterView, { graph, onNodeClick: (n) => {
          setSelectedId(n.id);
          setSidebarTab("node");
        } }),
        viewType === "pipeline" && /* @__PURE__ */ jsx(PipelineView, { graph, onNodeClick: (n) => {
          setSelectedId(n.id);
          setSidebarTab("node");
        } })
      ] })
    ] }),
    branchEditOpen && isOnBranch && resolvedGraph && activeBranch && /* @__PURE__ */ jsx("div", { style: { position: "fixed", inset: 0, zIndex: 100 }, children: /* @__PURE__ */ jsx(
      ManualEditor,
      {
        mode: "edit",
        initialGraph: resolvedToRepoGraph(graph, resolvedGraph, activeBranch.name),
        lockedNodeIds: resolvedGraph.nodes.filter((node) => node.origin !== activeBranchId).map((node) => node.id),
        lockedEdgeIds: resolvedGraph.edges.filter((edge) => edge.origin !== activeBranchId).map((edge) => edge.id),
        contextLabel: "branch edit",
        onComplete: handleBranchEditorComplete,
        onCancel: () => setBranchEditOpen(false)
      }
    ) })
  ] });
}
function Section({ title, subtitle, children }) {
  return /* @__PURE__ */ jsxs("div", { style: { animation: "fadeUp 0.25s ease both" }, children: [
    /* @__PURE__ */ jsx("div", { style: { fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }, children: title }),
    subtitle && /* @__PURE__ */ jsx("div", { style: { fontSize: 10, color: "#475569", marginBottom: 8 }, children: subtitle }),
    children
  ] });
}
function ToggleRow({ label, color, count, value, onChange }) {
  return /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" }, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 7 }, children: [
      /* @__PURE__ */ jsx("div", { style: { width: 10, height: 10, borderRadius: 2, background: color, opacity: value ? 1 : 0.25, flexShrink: 0 } }),
      /* @__PURE__ */ jsx("span", { style: { fontSize: 12, color: value ? "#cbd5e1" : "#475569" }, children: label }),
      /* @__PURE__ */ jsx("span", { style: { fontSize: 9, color: "#334155", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 4, padding: "1px 5px" }, children: count })
    ] }),
    /* @__PURE__ */ jsx("button", { onClick: () => onChange(!value), style: { width: 32, height: 18, borderRadius: 9, border: "none", cursor: "pointer", background: value ? "#1d4ed8" : "#1e293b", position: "relative", transition: "background 0.2s", flexShrink: 0 }, children: /* @__PURE__ */ jsx("div", { style: { position: "absolute", top: 3, width: 12, height: 12, borderRadius: "50%", background: value ? "#93c5fd" : "#475569", left: value ? 17 : 3, transition: "left 0.2s" } }) })
  ] });
}
function ExportBtn({ label, sub, onClick }) {
  return /* @__PURE__ */ jsxs("button", { className: "repo-control", onClick, style: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "12px 14px", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }, children: [
    /* @__PURE__ */ jsx("div", { style: { fontSize: 13, color: "#93c5fd", fontWeight: 700 }, children: label }),
    /* @__PURE__ */ jsx("div", { style: { fontSize: 11, color: "#64748b", marginTop: 2 }, children: sub })
  ] });
}
function Legend({
  nodeCounts,
  edgeCounts
}) {
  const nodeItems = [
    { key: "layer", label: "Layer", color: "#60a5fa" },
    { key: "module", label: "Module", color: "#a78bfa" },
    { key: "file", label: "File", color: "#34d399" },
    { key: "component", label: "Component", color: "#fb923c" }
  ].filter((item) => nodeCounts[item.key] > 0);
  const edgeItems = [
    { key: "engineering", label: "Runtime calls", color: "#60a5fa", dash: void 0 },
    { key: "architecture", label: "Design structure", color: "#c084fc", dash: void 0 },
    { key: "both", label: "Mixed", color: "#f472b6", dash: void 0 },
    { key: "uncertain", label: "Uncertain", color: "#64748b", dash: "4,3" }
  ].filter((item) => edgeCounts[item.key] > 0);
  return /* @__PURE__ */ jsxs("div", { style: { position: "absolute", bottom: 16, left: 16, background: "rgba(15,23,42,0.9)", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", backdropFilter: "blur(8px)", zIndex: 10, display: "flex", gap: 20 }, children: [
    nodeItems.length > 0 && /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("div", { style: { fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }, children: "Nodes" }),
      nodeItems.map(({ key, label, color }) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }, children: [
        /* @__PURE__ */ jsx("div", { style: { width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.9 } }),
        /* @__PURE__ */ jsx("span", { style: { fontSize: 10, color: "#94a3b8" }, children: label }),
        /* @__PURE__ */ jsx("span", { style: { fontSize: 9, color: "#475569" }, children: nodeCounts[key] })
      ] }, key))
    ] }),
    edgeItems.length > 0 && /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("div", { style: { fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }, children: "Connections" }),
      edgeItems.map(({ key, label, color, dash }) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }, children: [
        /* @__PURE__ */ jsx("svg", { width: 22, height: 10, children: /* @__PURE__ */ jsx("line", { x1: 0, y1: 5, x2: 22, y2: 5, stroke: color, strokeWidth: 1.5, strokeDasharray: dash }) }),
        /* @__PURE__ */ jsx("span", { style: { fontSize: 10, color: "#94a3b8" }, children: label }),
        /* @__PURE__ */ jsx("span", { style: { fontSize: 9, color: "#475569" }, children: edgeCounts[key] })
      ] }, key)),
      /* @__PURE__ */ jsx("div", { style: { borderTop: "1px solid #1e293b", color: "#475569", fontSize: 9, lineHeight: 1.5, marginTop: 6, paddingTop: 5 }, children: "solid high \xB7 dashed medium \xB7 dotted uncertain" })
    ] })
  ] });
}
function resolvedToRepoGraph(baseGraph, resolved, branchName) {
  return {
    meta: {
      ...baseGraph.meta,
      repoName: `${baseGraph.meta.repoName} / ${branchName}`,
      analyzedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    nodes: resolved.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      parentId: node.parentId,
      depth: node.depth,
      files: node.files,
      detectedRole: node.detectedRole,
      patterns: node.patterns,
      metadata: node.metadata
    })),
    edges: resolved.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      edgeType: edge.edgeType,
      strength: edge.strength,
      label: edge.label,
      confidence: edge.confidence
    })),
    overlay: {
      version: 0,
      nodeOverrides: {},
      edgeOverrides: {},
      manualNodes: [],
      manualEdges: []
    }
  };
}
var sidebarStyle = {
  width: 240,
  flexShrink: 0,
  background: "#080e1a",
  borderRight: "1px solid #1e293b",
  padding: "16px 14px",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  animation: "fadeUp 0.32s ease both"
};
var tabBtnStyle = {
  flex: 1,
  background: "none",
  border: "none",
  borderBottom: "2px solid transparent",
  padding: "8px 2px",
  fontSize: 10,
  cursor: "pointer",
  fontFamily: "inherit",
  letterSpacing: "0.02em"
};
var ghostBtn = {
  background: "none",
  border: "1px solid #1e293b",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 11,
  color: "#64748b",
  cursor: "pointer",
  fontFamily: "inherit"
};
var sidebarInputStyle = {
  width: "100%",
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 6,
  padding: "7px 10px",
  color: "#e2e8f0",
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box"
};
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export { BranchPanel, BranchProvider, GraphRenderer, ManualEditor, recommendedView, useBranches };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map