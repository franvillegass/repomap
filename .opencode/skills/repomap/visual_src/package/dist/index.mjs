// src/components/graph/GraphRenderer.tsx
import { useMemo as useMemo3, useCallback as useCallback3, useState as useState4, useEffect as useEffect3, memo as memo3 } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

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
    (e) => {
      var _a;
      return !((_a = overlay.edgeOverrides[e.id]) == null ? void 0 : _a.hidden);
    }
  );
  const archNodes = allNodes.filter((n) => n.type === "layer" || n.type === "module");
  const archNodeIds = new Set(archNodes.map((n) => n.id));
  const positions = computePositions(archNodes, "vertical_layers");
  const rfNodes = archNodes.map((node) => ({
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
  const rfEdges = visibleEdges.filter((e) => archNodeIds.has(e.source) && archNodeIds.has(e.target)).map((edge) => {
    const ov = overlay.edgeOverrides[edge.id];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "repoEdge",
      label: (ov == null ? void 0 : ov.customLabel) ?? edge.label,
      data: {
        edgeType: (ov == null ? void 0 : ov.customEdgeType) ?? edge.edgeType,
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
  const archLayoutNodes = layoutNodes.filter((n) => n.type === "layer" || n.type === "module");
  const archResolvedNodes = resolved.nodes.filter((n) => n.type === "layer" || n.type === "module");
  const archNodeIds = new Set(archResolvedNodes.map((n) => n.id));
  const positions = computePositions(archLayoutNodes, "vertical_layers");
  const rfNodes = archResolvedNodes.map((node) => {
    var _a;
    return {
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
        complexity: (_a = node.metadata) == null ? void 0 : _a.complexity,
        depth: node.depth,
        description: node.description,
        fictionalFiles: node.fictionalFiles,
        // Visual markers for branch-added nodes
        isBranchNode: node.origin !== "base",
        branchOrigin: node.origin !== "base" ? node.origin : void 0
      }
    };
  });
  const rfEdges = resolved.edges.filter((e) => archNodeIds.has(e.source) && archNodeIds.has(e.target)).map((edge) => ({
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

// src/components/graph/GraphNodes.tsx
import { memo, useState } from "react";
import { Handle, Position, BaseEdge, getBezierPath } from "@xyflow/react";
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
  const diffStatus = nodeData.diffStatus;
  const DIFF_COLORS = {
    added: "#22c55e",
    modified: "#f97316",
    deleted: "#ef4444",
    renamed: "#a855f7",
    copied: "#06b6d4"
  };
  const diffColor = diffStatus ? DIFF_COLORS[diffStatus] : void 0;
  const canExpand = (nodeData.nodeType === "module" || nodeData.nodeType === "layer") && Array.isArray(nodeData.files) && nodeData.files.length > 0;
  const borderLeft = diffColor ? `3.5px solid ${diffColor}` : status ? `3.5px solid ${status.stripe}` : isBranch ? `3px dashed ${colors.border}` : `1.5px solid ${colors.border}`;
  const borderMain = selected ? "1.5px solid #f9fafb" : isBranch ? `1.5px dashed ${colors.border}` : `1.5px solid ${colors.border}`;
  return /* @__PURE__ */ React.createElement(
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
        boxShadow: diffColor ? `0 0 0 1.5px ${diffColor}40` : isBranch ? "0 0 0 1px rgba(96,165,250,0.12)" : void 0
      }
    },
    isBranch && /* @__PURE__ */ React.createElement(
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
        }
      },
      "branch"
    ),
    diffStatus && /* @__PURE__ */ React.createElement(
      "div",
      {
        title: `File ${diffStatus} in this branch`,
        style: {
          position: "absolute",
          top: -8,
          left: 8,
          fontSize: 8,
          fontWeight: 700,
          background: `${diffColor}22`,
          color: diffColor ?? "#f9fafb",
          border: `1px solid ${diffColor ?? "transparent"}`,
          borderRadius: 3,
          padding: "1px 5px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          lineHeight: 1.6,
          pointerEvents: "none"
        }
      },
      diffStatus
    ),
    isBranch && nodeData.description && /* @__PURE__ */ React.createElement(
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
        }
      },
      data.description
    ),
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement(
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
        }
      },
      data.nodeType
    ), canExpand ? /* @__PURE__ */ React.createElement(
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
        }
      },
      /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9 } }, expanded ? "\u25B2" : "\u25BC"),
      data.fileCount,
      " files"
    ) : /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#94a3b8" } }, data.fileCount, " files")),
    /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, fontSize: 13, fontWeight: 600, color: "#e2e8f0" } }, data.label),
    data.detectedRole && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#94a3b8" } }, data.detectedRole),
    status && /* @__PURE__ */ React.createElement(
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
        }
      },
      /* @__PURE__ */ React.createElement("div", { style: { width: 5, height: 5, borderRadius: "50%", background: status.stripe, flexShrink: 0 } }),
      /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: status.label, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" } }, statusTag == null ? void 0 : statusTag.replace("_", " "))
    ),
    data.complexity && /* @__PURE__ */ React.createElement(
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
    expanded && canExpand && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8, borderTop: `1px solid ${colors.border}30`, paddingTop: 6 } }, /* @__PURE__ */ React.createElement("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 } }, data.files.map((file) => /* @__PURE__ */ React.createElement(
      "li",
      {
        key: file,
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
        }
      },
      "\u203A ",
      file.split("/").pop()
    )))),
    hasFictional && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8, borderTop: "1px solid rgba(96,165,250,0.12)", paddingTop: 5 } }, /* @__PURE__ */ React.createElement(
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
        }
      },
      /* @__PURE__ */ React.createElement("span", { style: { opacity: 0.6 } }, fictionalExpanded ? "\u25B2" : "\u25BC"),
      fictionalFiles.length,
      " planned file",
      fictionalFiles.length !== 1 ? "s" : ""
    ), fictionalExpanded && /* @__PURE__ */ React.createElement("ul", { style: { listStyle: "none", margin: "5px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 } }, fictionalFiles.map((f) => /* @__PURE__ */ React.createElement(
      "li",
      {
        key: f.id,
        style: {
          fontSize: 9,
          background: "rgba(96,165,250,0.06)",
          border: "1px dashed rgba(96,165,250,0.2)",
          borderRadius: 4,
          padding: "3px 6px"
        }
      },
      /* @__PURE__ */ React.createElement("div", { style: { color: "#93c5fd", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "\u2726 ", f.name),
      f.description && /* @__PURE__ */ React.createElement("div", { style: { color: "#4b5563", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, f.description)
    )))),
    /* @__PURE__ */ React.createElement(Handle, { type: "target", position: Position.Top, style: { opacity: 0 } }),
    /* @__PURE__ */ React.createElement(Handle, { type: "source", position: Position.Bottom, style: { opacity: 0 } })
  );
});
var RepoEdge = memo(function RepoEdge2(props) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });
  if (!data) return null;
  const highlighted = data.highlighted === true;
  const color = highlighted ? "#f0abfc" : EDGE_COLORS[data.edgeType] ?? "#64748b";
  const dashStyle = CONFIDENCE_STYLE[data.confidence] ?? "solid";
  const baseDash = dashStyle === "dashed" ? "6,4" : dashStyle === "dotted" ? "2,4" : void 0;
  const strokeDasharray = data.isBranchEdge ? baseDash ?? "8,3" : baseDash;
  const strokeWidth = highlighted ? 3 : Math.max(1, data.strength * 0.6) * (data.isBranchEdge ? 1.3 : 1);
  const opacity = highlighted ? 1 : data.confidence === "uncertain" ? 0.45 : data.isBranchEdge ? 1 : 0.8;
  return /* @__PURE__ */ React.createElement(
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
        filter: highlighted ? `drop-shadow(0 0 6px ${color}88)` : void 0
      }
    }
  );
});
var nodeTypes = { repoNode: RepoNode };
var edgeTypes = { repoEdge: RepoEdge };

// src/components/graph/AlternativeViews.tsx
import { useState as useState2, useMemo, useRef, memo as memo2 } from "react";
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
var ViewSwitcher = memo2(function ViewSwitcher2({ current, recommended, onChange }) {
  return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#334155", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 } }, "visualisation"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 3 } }, VIEWS.map(({ id, icon, label }) => {
    const active = current === id;
    const rec = recommended === id && !active;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: id,
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
        }
      },
      icon
    );
  })), recommended !== current && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#334155", marginTop: 4 } }, "\u2299 = recommended for ", recommended === "onion" ? "this pattern" : recommended));
});
var NCOLORS = {
  layer: { bg: "rgba(96,165,250,0.12)", stroke: "#60a5fa", text: "#93c5fd" },
  module: { bg: "rgba(167,139,250,0.12)", stroke: "#a78bfa", text: "#c4b5fd" },
  file: { bg: "rgba(52,211,153,0.12)", stroke: "#34d399", text: "#6ee7b7" },
  component: { bg: "rgba(251,146,60,0.12)", stroke: "#fb923c", text: "#fdba74" }
};
var nc = (type) => NCOLORS[type] ?? NCOLORS.module;
var HoverCard = memo2(function HoverCard2({ node, showFiles }) {
  const col = nc(node.type);
  return /* @__PURE__ */ React.createElement("div", { style: {
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
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { color: col.text, fontWeight: 700 } }, node.label), /* @__PURE__ */ React.createElement("span", { style: { color: "#334155" } }, "\xB7"), /* @__PURE__ */ React.createElement("span", { style: { color: "#475569" } }, node.type), node.detectedRole && node.detectedRole !== "unknown" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { color: "#334155" } }, "\xB7"), /* @__PURE__ */ React.createElement("span", { style: { color: "#334155" } }, node.detectedRole)), node.files.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { color: "#334155" } }, "\xB7"), /* @__PURE__ */ React.createElement("span", { style: { color: "#334155" } }, node.files.length, " files"))), showFiles && node.files.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid #1e293b", paddingTop: 4, display: "flex", flexDirection: "column", gap: 2 } }, node.files.map((f) => /* @__PURE__ */ React.createElement("span", { key: f, style: { color: "#475569", fontSize: 9 } }, "\u203A ", f.split("/").pop()))));
});
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
var OnionView = memo2(function OnionView2({ graph, onNodeClick }) {
  const [hovered, setHovered] = useState2(null);
  const [expanded, setExpanded] = useState2(null);
  const [transform, setTransform] = useState2({ x: 0, y: 0, scale: 1 });
  const dragging = useRef(null);
  const isDragging = useRef(false);
  const CX = 290, CY = 295;
  const nodeMap = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph.nodes]);
  const byDepth = useMemo(() => {
    const m = {};
    for (const n of graph.nodes) {
      const d = Math.min(n.depth, 3);
      (m[d] ??= []).push(n);
    }
    return m;
  }, [graph.nodes]);
  const depths = Object.keys(byDepth).map(Number).sort();
  const hovNode = hovered ? nodeMap.get(hovered) ?? null : null;
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
  return /* @__PURE__ */ React.createElement("div", { style: { width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" } }, /* @__PURE__ */ React.createElement(
    "div",
    {
      style: { flex: 1, position: "relative", cursor: dragging.current ? "grabbing" : "grab", overflow: "hidden" },
      onWheel,
      onMouseDown,
      onMouseMove,
      onMouseUp,
      onMouseLeave: onMouseUp
    },
    /* @__PURE__ */ React.createElement(
      "svg",
      {
        width: "100%",
        height: "100%",
        viewBox: "0 0 580 590",
        style: {
          display: "block",
          transformOrigin: "center center",
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`
        }
      },
      depths.map((d) => {
        const r = RINGS[d];
        if (!r) return null;
        return /* @__PURE__ */ React.createElement(
          "circle",
          {
            key: "bg" + d,
            cx: CX,
            cy: CY,
            r: r.outer,
            fill: "none",
            stroke: RING_STROKE[d],
            strokeWidth: 0.4,
            strokeOpacity: 0.2,
            strokeDasharray: "4 4"
          }
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
          return /* @__PURE__ */ React.createElement(
            "g",
            {
              key: node.id,
              "data-node": "1",
              onMouseEnter: () => setHovered(node.id),
              onMouseLeave: () => setHovered(null),
              onClick: () => {
                if (!isDragging.current) {
                  setExpanded((prev) => prev === node.id ? null : node.id);
                  onNodeClick == null ? void 0 : onNodeClick(node);
                }
              },
              style: { cursor: "pointer" }
            },
            /* @__PURE__ */ React.createElement(
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
            arcLen > 30 && /* @__PURE__ */ React.createElement(
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
                }
              },
              lbl
            )
          );
        });
      }),
      depths.map((d) => {
        var _a;
        const r = RINGS[d];
        if (!r) return null;
        return /* @__PURE__ */ React.createElement(
          "text",
          {
            key: "dlbl" + d,
            x: CX + r.outer + 14,
            y: CY + (d - depths.length / 2 + 0.5) * 16,
            dominantBaseline: "central",
            style: { fill: RING_STROKE[d], fontSize: 9, fontFamily: '"JetBrains Mono",monospace', opacity: 0.55 }
          },
          "depth ",
          d,
          " \xB7 ",
          ((_a = byDepth[d]) == null ? void 0 : _a.length) ?? 0
        );
      })
    ),
    /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: 12, right: 12, display: "flex", flexDirection: "column", gap: 2 } }, [["\uFF0B", 1.2], ["\uFF0D", 0.8], ["\u2299", "reset"]].map(([icon, action]) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: String(icon),
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
        }
      },
      icon
    ))),
    hovNode && /* @__PURE__ */ React.createElement(HoverCard, { node: hovNode, showFiles: expanded === hovNode.id })
  ), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid #1e293b", display: "flex", gap: 20, padding: "8px 20px", flexShrink: 0, flexWrap: "wrap" } }, depths.map((d) => {
    var _a;
    return /* @__PURE__ */ React.createElement("div", { key: d, style: { display: "flex", alignItems: "center", gap: 5 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 8, height: 8, borderRadius: "50%", background: RING_STROKE[d], opacity: 0.7 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#475569", fontFamily: '"JetBrains Mono",monospace' } }, d === 0 ? "core" : d === 1 ? "modules" : d === 2 ? "files" : "components", " (", ((_a = byDepth[d]) == null ? void 0 : _a.length) ?? 0, ")"));
  }), /* @__PURE__ */ React.createElement("div", { style: { marginLeft: "auto", fontSize: 9, color: "#334155", fontFamily: '"JetBrains Mono",monospace' } }, "click segment to expand files")));
});
var LayerStackView = memo2(function LayerStackView2({ graph, onNodeClick }) {
  const [hovered, setHovered] = useState2(null);
  const [expanded, setExpanded] = useState2(null);
  const toggleExpanded = (id) => setExpanded((prev) => prev === id ? null : id);
  const nodeMap = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph.nodes]);
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
    for (const e of graph.edges) {
      const sg = nodeToGroup[e.source], tg = nodeToGroup[e.target];
      if (!sg || !tg || sg === tg) continue;
      (counts[sg] ??= {})[tg] ??= 0;
      counts[sg][tg]++;
    }
    return counts;
  }, [graph.edges, bands]);
  return /* @__PURE__ */ React.createElement("div", { style: {
    width: "100%",
    height: "100%",
    overflowY: "auto",
    padding: "0 24px 20px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 0
  } }, bands.map((band, bi) => {
    var _a;
    const col = nc(band.nodeType);
    const nextBand = bands[bi + 1];
    const connCount = nextBand ? ((_a = edgeCounts[band.id]) == null ? void 0 : _a[nextBand.id]) ?? 0 : 0;
    return /* @__PURE__ */ React.createElement("div", { key: band.id }, /* @__PURE__ */ React.createElement("div", { style: {
      background: col.bg,
      border: `1px solid ${col.stroke}55`,
      borderLeft: `3px solid ${col.stroke}`,
      borderRadius: 8,
      padding: "12px 16px"
    } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: band.children.length > 0 ? 10 : 0 } }, /* @__PURE__ */ React.createElement("span", { style: { color: col.text, fontSize: 12, fontWeight: 700, fontFamily: '"JetBrains Mono",monospace' } }, band.label), band.role && band.role !== "unknown" && /* @__PURE__ */ React.createElement("span", { style: { color: "#475569", fontSize: 10, fontFamily: '"JetBrains Mono",monospace' } }, "\xB7 ", band.role), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", color: "#334155", fontSize: 10, fontFamily: '"JetBrains Mono",monospace' } }, band.children.length, " nodes")), band.children.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 5 } }, band.children.map((child) => {
      const cc = nc(child.type);
      const hov = hovered === child.id;
      const isExp = expanded === child.id;
      const canExp = (child.type === "module" || child.type === "layer") && child.files.length > 0;
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: child.id,
          onMouseEnter: () => setHovered(child.id),
          onMouseLeave: () => setHovered(null),
          onClick: () => onNodeClick == null ? void 0 : onNodeClick(child),
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
          }
        },
        /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4 } }, /* @__PURE__ */ React.createElement("span", null, child.label), canExp && /* @__PURE__ */ React.createElement(
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
            }
          },
          child.files.length,
          isExp ? " \u25B2" : " \u25BC"
        )),
        isExp && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 5, borderTop: `1px solid ${cc.stroke}33`, paddingTop: 4, display: "flex", flexDirection: "column", gap: 1 } }, child.files.map((f) => /* @__PURE__ */ React.createElement("span", { key: f, style: { color: "#64748b", fontSize: 8 } }, "\u203A ", f.split("/").pop())))
      );
    }))), bi < bands.length - 1 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "6px 20px" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, height: 1, background: "linear-gradient(to right, #1e293b, #334155)" } }), /* @__PURE__ */ React.createElement("span", { style: { color: "#334155", fontSize: 10, fontFamily: '"JetBrains Mono",monospace', flexShrink: 0 } }, connCount > 0 ? `${connCount} connection${connCount !== 1 ? "s" : ""}` : "\u2014"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, height: 1, background: "linear-gradient(to left, #1e293b, #334155)" } }), /* @__PURE__ */ React.createElement("span", { style: { color: "#334155", fontSize: 11 } }, "\u2193")));
  }));
});
var ClusterView = memo2(function ClusterView2({ graph, onNodeClick }) {
  const [hovered, setHovered] = useState2(null);
  const [expanded, setExpanded] = useState2(null);
  const toggleExpanded = (id) => setExpanded((prev) => prev === id ? null : id);
  const clusters = useMemo(() => {
    const topIds = new Set(
      graph.nodes.filter((n) => n.parentId === null || n.depth <= 1).map((n) => n.id)
    );
    const tops = graph.nodes.filter((n) => topIds.has(n.id) && (!n.parentId || !topIds.has(n.parentId)));
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    const childrenByParent = {};
    for (const n of graph.nodes) {
      if (n.parentId) {
        ;
        (childrenByParent[n.parentId] ??= []).push(n);
      }
    }
    const edgesOut = {};
    const edgesIn = {};
    for (const e of graph.edges) {
      const sourceTop = nodeMap.get(e.source);
      const targetTop = nodeMap.get(e.target);
      if (!sourceTop || !targetTop) continue;
      let sTop = e.source;
      let sNode = nodeMap.get(sTop);
      while ((sNode == null ? void 0 : sNode.parentId) && topIds.has(sNode.parentId)) {
        sTop = sNode.parentId;
        sNode = nodeMap.get(sTop);
      }
      let tTop = e.target;
      let tNode = nodeMap.get(tTop);
      while ((tNode == null ? void 0 : tNode.parentId) && topIds.has(tNode.parentId)) {
        tTop = tNode.parentId;
        tNode = nodeMap.get(tTop);
      }
      if (sTop !== tTop) {
        edgesOut[sTop] = (edgesOut[sTop] ?? 0) + 1;
        edgesIn[tTop] = (edgesIn[tTop] ?? 0) + 1;
      }
    }
    return tops.map((n) => ({
      node: n,
      children: childrenByParent[n.id] ?? [],
      edgesOut: edgesOut[n.id] ?? 0,
      edgesIn: edgesIn[n.id] ?? 0
    }));
  }, [graph.nodes, graph.edges]);
  return /* @__PURE__ */ React.createElement("div", { style: { width: "100%", height: "100%", overflowY: "auto", padding: "0 24px 24px", boxSizing: "border-box" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 } }, clusters.map(({ node, children, edgesOut, edgesIn }) => {
    var _a;
    const col = nc(node.type);
    const hov = hovered === node.id;
    const isExp = expanded === node.id;
    const canExp = node.files.length > 0;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: node.id,
        onMouseEnter: () => setHovered(node.id),
        onMouseLeave: () => setHovered(null),
        onClick: () => onNodeClick == null ? void 0 : onNodeClick(node),
        style: {
          background: hov ? col.bg.replace("0.12", "0.24") : col.bg,
          border: `1px solid ${col.stroke}${hov ? "" : "66"}`,
          borderRadius: 10,
          cursor: onNodeClick ? "pointer" : "default",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "all 0.15s"
        }
      },
      /* @__PURE__ */ React.createElement("div", { style: { borderBottom: `1px solid ${col.stroke}33`, padding: "10px 12px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { color: col.text, fontFamily: '"JetBrains Mono",monospace', fontSize: 11, fontWeight: 700, lineHeight: 1.35 } }, node.label), /* @__PURE__ */ React.createElement("span", { style: {
        background: col.bg,
        border: `1px solid ${col.stroke}66`,
        borderRadius: 4,
        color: col.text,
        flexShrink: 0,
        fontSize: 8,
        fontFamily: '"JetBrains Mono",monospace',
        padding: "2px 5px",
        marginTop: 1
      } }, node.type)), node.detectedRole && node.detectedRole !== "unknown" && /* @__PURE__ */ React.createElement("div", { style: { color: "#475569", fontFamily: '"JetBrains Mono",monospace', fontSize: 9, marginTop: 3 } }, node.detectedRole), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 7, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { title: "Incoming connections", style: { color: "#334155", fontSize: 9, fontFamily: '"JetBrains Mono",monospace' } }, "\u2193", edgesIn), /* @__PURE__ */ React.createElement("span", { title: "Outgoing connections", style: { color: "#334155", fontSize: 9, fontFamily: '"JetBrains Mono",monospace' } }, "\u2191", edgesOut), canExp && /* @__PURE__ */ React.createElement(
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
          }
        },
        node.files.length,
        " files ",
        isExp ? "\u25B2" : "\u25BC"
      ))),
      isExp && /* @__PURE__ */ React.createElement("div", { style: { padding: "6px 12px", borderBottom: `1px solid ${col.stroke}22`, display: "flex", flexDirection: "column", gap: 2 } }, node.files.map((f) => /* @__PURE__ */ React.createElement("span", { key: f, style: { color: "#475569", fontSize: 8, fontFamily: '"JetBrains Mono",monospace' } }, "\u203A ", f.split("/").pop()))),
      children.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 12px", display: "flex", flexDirection: "column", gap: 3, maxHeight: 130, overflowY: "auto" } }, children.slice(0, 7).map((child) => {
        const cc = nc(child.type);
        return /* @__PURE__ */ React.createElement(
          "div",
          {
            key: child.id,
            onClick: (e) => {
              e.stopPropagation();
              onNodeClick == null ? void 0 : onNodeClick(child);
            },
            style: { alignItems: "center", display: "flex", gap: 6, cursor: onNodeClick ? "pointer" : "default" }
          },
          /* @__PURE__ */ React.createElement("div", { style: { width: 5, height: 5, borderRadius: "50%", background: cc.stroke, flexShrink: 0 } }),
          /* @__PURE__ */ React.createElement("span", { style: {
            color: "#64748b",
            fontFamily: '"JetBrains Mono",monospace',
            fontSize: 9,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          } }, child.label)
        );
      }), children.length > 7 && /* @__PURE__ */ React.createElement("div", { style: { color: "#334155", fontSize: 9, fontFamily: '"JetBrains Mono",monospace', paddingLeft: 11 } }, "+", children.length - 7, " more")),
      ((_a = node.patterns) == null ? void 0 : _a.length) > 0 && /* @__PURE__ */ React.createElement("div", { style: { borderTop: `1px solid ${col.stroke}22`, padding: "6px 12px", display: "flex", flexWrap: "wrap", gap: 3 } }, node.patterns.slice(0, 2).map((p) => /* @__PURE__ */ React.createElement("span", { key: p, style: {
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 3,
        color: "#334155",
        fontSize: 8,
        fontFamily: '"JetBrains Mono",monospace',
        padding: "1px 5px"
      } }, p.replace(/_/g, " "))))
    );
  })));
});
var COL_LABELS = {
  0: "layers",
  1: "modules",
  2: "files",
  3: "components"
};
var PipelineView = memo2(function PipelineView2({ graph, onNodeClick }) {
  const [hovered, setHovered] = useState2(null);
  const [expanded, setExpanded] = useState2(null);
  const CARD_W = 158, CARD_H = 54, COL_GAP = 72, ROW_GAP = 8, PAD = 24;
  const nodeMap = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph.nodes]);
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
  const crossEdges = useMemo(() => {
    const result = [];
    let count = 0;
    for (const e of graph.edges) {
      if (count >= 80) break;
      const sn = nodeMap.get(e.source);
      const tn = nodeMap.get(e.target);
      if (sn && tn && sn.depth !== tn.depth) {
        result.push(e);
        count++;
      }
    }
    return result;
  }, [graph.edges, nodeMap]);
  const hovNode = hovered ? nodeMap.get(hovered) ?? null : null;
  return /* @__PURE__ */ React.createElement("div", { style: { width: "100%", height: "100%", overflow: "auto", position: "relative" } }, /* @__PURE__ */ React.createElement("svg", { width: Math.max(VW, 400), height: Math.max(VH, 300), style: { display: "block" } }, columns.map((col, ci) => {
    const x = PAD + ci * (CARD_W + COL_GAP);
    return /* @__PURE__ */ React.createElement("g", { key: "hdr" + ci }, /* @__PURE__ */ React.createElement(
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
    ), /* @__PURE__ */ React.createElement(
      "text",
      {
        x: x + CARD_W / 2,
        y: 17,
        textAnchor: "middle",
        dominantBaseline: "central",
        style: { fill: "#334155", fontSize: 9, fontFamily: '"JetBrains Mono",monospace', letterSpacing: "0.07em" }
      },
      COL_LABELS[col.depth] ?? "depth " + col.depth
    ));
  }), crossEdges.map((edge) => {
    const sp = positions[edge.source], tp = positions[edge.target];
    if (!sp || !tp) return null;
    const x1 = sp.x + CARD_W, y1 = sp.y + CARD_H / 2;
    const x2 = tp.x, y2 = tp.y + CARD_H / 2;
    const mx = (x1 + x2) / 2;
    const col = edge.edgeType === "architecture" ? "#a78bfa" : edge.edgeType === "both" ? "#f472b6" : "#60a5fa";
    const dash = edge.confidence === "uncertain" ? "3,3" : edge.confidence === "medium" ? "5,3" : void 0;
    return /* @__PURE__ */ React.createElement(
      "path",
      {
        key: edge.id,
        d: `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`,
        fill: "none",
        stroke: col,
        strokeWidth: Math.max(0.7, edge.strength * 0.35),
        strokeDasharray: dash,
        opacity: 0.4
      }
    );
  }), graph.nodes.map((node) => {
    const p = positions[node.id];
    if (!p) return null;
    const col = nc(node.type);
    const hov = hovered === node.id;
    const isExp = expanded === node.id;
    const canExp = (node.type === "module" || node.type === "layer") && node.files.length > 0;
    const lbl = node.label.length > 20 ? node.label.slice(0, 19) + "\u2026" : node.label;
    const role = node.detectedRole && node.detectedRole !== "unknown" ? node.detectedRole.length > 22 ? node.detectedRole.slice(0, 21) + "\u2026" : node.detectedRole : null;
    return /* @__PURE__ */ React.createElement(
      "g",
      {
        key: node.id,
        onMouseEnter: () => setHovered(node.id),
        onMouseLeave: () => setHovered(null),
        onClick: () => {
          if (canExp) setExpanded((prev) => prev === node.id ? null : node.id);
          onNodeClick == null ? void 0 : onNodeClick(node);
        },
        style: { cursor: "pointer" }
      },
      /* @__PURE__ */ React.createElement(
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
      /* @__PURE__ */ React.createElement(
        "text",
        {
          x: p.x + 10,
          y: p.y + 19,
          style: { fill: col.text, fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700 }
        },
        lbl
      ),
      role && /* @__PURE__ */ React.createElement(
        "text",
        {
          x: p.x + 10,
          y: p.y + 35,
          style: { fill: "#475569", fontSize: 9, fontFamily: '"JetBrains Mono",monospace' }
        },
        role
      ),
      node.files.length > 0 && /* @__PURE__ */ React.createElement(
        "text",
        {
          x: p.x + CARD_W - 7,
          y: p.y + CARD_H - 7,
          textAnchor: "end",
          style: {
            fill: isExp ? col.text : "#334155",
            fontSize: 8,
            fontFamily: '"JetBrains Mono",monospace'
          }
        },
        node.files.length,
        "f ",
        canExp ? isExp ? "\u25B2" : "\u25BC" : ""
      )
    );
  })), hovNode && /* @__PURE__ */ React.createElement(HoverCard, { node: hovNode, showFiles: expanded === hovNode.id }));
});

// src/branches/BranchPanel.tsx
import { useState as useState3, useRef as useRef3, useEffect as useEffect2, useCallback as useCallback2 } from "react";

// src/branches/UseBranches.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo as useMemo2,
  useReducer,
  useRef as useRef2
} from "react";

// src/branches/storage.ts
import { openDB } from "idb";
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
    removedNodeIds: [],
    removedEdgeIds: [],
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
    for (const id of delta.removedNodeIds ?? []) {
      resolvedNodes.delete(id);
    }
    for (const id of delta.removedEdgeIds ?? []) {
      resolvedEdges.delete(id);
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

// src/branches/UseBranches.tsx
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
  const baseGraphRef = useRef2(baseGraph);
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
      removedNodeIds: parentResolved.nodes.map((n) => n.id).filter((id) => !editedGraph.nodes.some((gn) => gn.id === id)),
      removedEdgeIds: parentResolved.edges.map((e) => e.id).filter((id) => !editedGraph.edges.some((ge) => ge.id === id)),
      fictionalFiles: (existingDelta == null ? void 0 : existingDelta.fictionalFiles) ?? {}
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
  const value = useMemo2(() => ({
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
  return /* @__PURE__ */ React.createElement(BranchContext.Provider, { value }, children);
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

// src/branches/BranchPanel.tsx
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
function BranchPanel({
  graph,
  onSelectGitBranch,
  activeGitBranch
} = {}) {
  var _a;
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
  const [creating, setCreating] = useState3(null);
  const [editingId, setEditingId] = useState3(null);
  const openCreate = useCallback2((parentBranchId) => {
    const index = branches.length;
    setCreating({
      parentBranchId,
      name: "",
      description: "",
      color: pickColor(index)
    });
    setEditingId(null);
  }, [branches.length]);
  const handleCreate = useCallback2(async () => {
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
  const gitBranches = ((_a = graph == null ? void 0 : graph.git) == null ? void 0 : _a.branches) ?? [];
  return /* @__PURE__ */ React.createElement("aside", { style: styles.panel }, /* @__PURE__ */ React.createElement("div", { style: styles.header }, /* @__PURE__ */ React.createElement("span", { style: styles.headerLabel }, gitBranches.length > 0 ? "REPOSITORY & BRANCHES" : "BRANCHES"), /* @__PURE__ */ React.createElement(
    "button",
    {
      style: styles.newBranchBtn,
      onClick: () => openCreate(null),
      title: "New branch from base"
    },
    /* @__PURE__ */ React.createElement(PlusIcon, null),
    "New"
  )), gitBranches.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: styles.sectionLabel }, "Repository branches"), gitBranches.map((gb, i) => {
    const isCurrent = gb.current;
    const isSelected = activeGitBranch === gb.name;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: gb.name,
        style: {
          ...styles.gitBranchRow,
          ...isSelected ? styles.gitBranchSelected : {},
          ...isCurrent && !isSelected ? styles.gitBranchCurrent : {}
        },
        onClick: () => onSelectGitBranch == null ? void 0 : onSelectGitBranch(isSelected ? null : gb.name),
        title: isCurrent ? "Current branch" : `Show diff for ${gb.name}`
      },
      /* @__PURE__ */ React.createElement("span", { style: styles.gitBranchIcon }, isCurrent ? "\u2713" : "\u2442"),
      /* @__PURE__ */ React.createElement("span", { style: styles.gitBranchName }, gb.name),
      isCurrent && /* @__PURE__ */ React.createElement("span", { style: styles.activePill }, "current"),
      isSelected && /* @__PURE__ */ React.createElement("span", { style: { ...styles.activePill, background: "#3b1f1f", color: "#f87171" } }, "diff")
    );
  }), /* @__PURE__ */ React.createElement("div", { style: styles.divider })), /* @__PURE__ */ React.createElement(
    "button",
    {
      style: {
        ...styles.baseRow,
        ...!activeGitBranch && activeBranchId === null ? styles.baseRowActive : {}
      },
      onClick: () => {
        setActiveBranch(null);
        onSelectGitBranch == null ? void 0 : onSelectGitBranch(null);
      }
    },
    /* @__PURE__ */ React.createElement("span", { style: styles.baseIcon }, "\u25C8"),
    /* @__PURE__ */ React.createElement("span", { style: styles.baseName }, "Base graph"),
    !activeGitBranch && activeBranchId === null && /* @__PURE__ */ React.createElement("span", { style: styles.activePill }, "active")
  ), /* @__PURE__ */ React.createElement("div", { style: styles.divider }), /* @__PURE__ */ React.createElement("div", { style: styles.treeContainer }, loading && /* @__PURE__ */ React.createElement("span", { style: styles.dimText }, "Loading\u2026"), error && /* @__PURE__ */ React.createElement("span", { style: styles.errorText }, error), !loading && branches.length === 0 && /* @__PURE__ */ React.createElement("div", { style: styles.emptyState }, /* @__PURE__ */ React.createElement("span", { style: styles.emptyIcon }, "\u2442"), /* @__PURE__ */ React.createElement("span", { style: styles.emptyText }, "No branches yet."), /* @__PURE__ */ React.createElement("span", { style: styles.emptyHint }, 'Create one to start exploring "what-if" changes without touching the base graph.')), rootBranches.map((branch) => /* @__PURE__ */ React.createElement(
    BranchTreeNode,
    {
      key: branch.id,
      branch,
      depth: 0,
      activeBranchId,
      editingId,
      creating,
      onActivate: (id) => {
        setActiveBranch(id);
        onSelectGitBranch == null ? void 0 : onSelectGitBranch(null);
      },
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
    }
  )), creating && creating.parentBranchId === null && /* @__PURE__ */ React.createElement(
    CreateForm,
    {
      value: creating,
      depth: 0,
      onChange: setCreating,
      onSubmit: handleCreate,
      onCancel: () => setCreating(null)
    }
  )));
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
  const [editName, setEditName] = useState3(branch.name);
  const [editDesc, setEditDesc] = useState3(branch.description ?? "");
  const [hovered, setHovered] = useState3(false);
  const nameRef = useRef3(null);
  useEffect2(() => {
    var _a;
    if (isEditing) (_a = nameRef.current) == null ? void 0 : _a.focus();
  }, [isEditing]);
  const indent = depth * 16;
  return /* @__PURE__ */ React.createElement("div", { style: { marginLeft: indent } }, depth > 0 && /* @__PURE__ */ React.createElement("div", { style: styles.connector }), isEditing ? /* @__PURE__ */ React.createElement("div", { style: styles.editRow }, /* @__PURE__ */ React.createElement(
    "span",
    {
      style: { ...styles.colorDot, background: branch.color ?? "#60a5fa" }
    }
  ), /* @__PURE__ */ React.createElement(
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
  ), /* @__PURE__ */ React.createElement(
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
  ), /* @__PURE__ */ React.createElement("div", { style: styles.editActions }, /* @__PURE__ */ React.createElement(
    "button",
    {
      style: styles.confirmBtn,
      onClick: () => onFinishEdit(branch.id, { name: editName, description: editDesc })
    },
    "\u2713"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      style: styles.cancelBtn,
      onClick: () => onStartEdit("")
    },
    "\u2715"
  ))) : /* @__PURE__ */ React.createElement(
    "div",
    {
      style: {
        ...styles.branchRow,
        ...isActive ? styles.branchRowActive : {},
        ...hovered && !isActive ? styles.branchRowHover : {}
      },
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false)
    },
    /* @__PURE__ */ React.createElement(
      "button",
      {
        style: styles.branchMain,
        onClick: () => onActivate(branch.id)
      },
      /* @__PURE__ */ React.createElement("span", { style: { ...styles.colorDot, background: branch.color ?? "#60a5fa" } }),
      /* @__PURE__ */ React.createElement("span", { style: styles.branchName }, branch.name),
      isActive && /* @__PURE__ */ React.createElement("span", { style: styles.activePill }, "active")
    ),
    (hovered || isActive) && /* @__PURE__ */ React.createElement("div", { style: styles.rowActions }, /* @__PURE__ */ React.createElement(
      ActionButton,
      {
        title: "Create child branch",
        onClick: () => onCreateChild(branch.id)
      },
      "\u2442"
    ), /* @__PURE__ */ React.createElement(
      ActionButton,
      {
        title: "Rename",
        onClick: () => onStartEdit(branch.id)
      },
      "\u270E"
    ), /* @__PURE__ */ React.createElement(
      ActionButton,
      {
        title: "Delete branch",
        danger: true,
        onClick: () => {
          if (confirm(`Delete branch "${branch.name}" and all its children?`)) {
            onDelete(branch.id);
          }
        }
      },
      "\u2715"
    ))
  ), !isEditing && branch.description && /* @__PURE__ */ React.createElement("div", { style: { ...styles.branchDesc, marginLeft: 16 + indent } }, branch.description), children.map((child) => /* @__PURE__ */ React.createElement(
    BranchTreeNode,
    {
      key: child.id,
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
    }
  )), creating && creating.parentBranchId === branch.id && /* @__PURE__ */ React.createElement(
    CreateForm,
    {
      value: creating,
      depth: depth + 1,
      onChange: onChangeCreate,
      onSubmit: onSubmitCreate,
      onCancel: onCancelCreate
    }
  ));
}
function CreateForm({ value, depth, onChange, onSubmit, onCancel }) {
  const inputRef = useRef3(null);
  useEffect2(() => {
    var _a;
    (_a = inputRef.current) == null ? void 0 : _a.focus();
  }, []);
  return /* @__PURE__ */ React.createElement("div", { style: { marginLeft: depth * 16, ...styles.createForm } }, /* @__PURE__ */ React.createElement("div", { style: styles.colorRow }, BRANCH_COLORS.map((c) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: c,
      style: {
        ...styles.colorSwatch,
        background: c,
        outline: value.color === c ? `2px solid #fff` : "none",
        outlineOffset: 2
      },
      onClick: () => onChange({ ...value, color: c })
    }
  ))), /* @__PURE__ */ React.createElement(
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
  ), /* @__PURE__ */ React.createElement(
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
  ), /* @__PURE__ */ React.createElement("div", { style: styles.createActions }, /* @__PURE__ */ React.createElement(
    "button",
    {
      style: styles.createSubmit,
      onClick: onSubmit,
      disabled: !value.name.trim()
    },
    "Create branch"
  ), /* @__PURE__ */ React.createElement("button", { style: styles.cancelBtn, onClick: onCancel }, "Cancel")));
}
function ActionButton({
  children,
  title,
  danger = false,
  onClick
}) {
  return /* @__PURE__ */ React.createElement(
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
      }
    },
    children
  );
}
function PlusIcon() {
  return /* @__PURE__ */ React.createElement("svg", { width: "10", height: "10", viewBox: "0 0 10 10", fill: "none", style: { marginRight: 4 } }, /* @__PURE__ */ React.createElement("path", { d: "M5 1v8M1 5h8", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }));
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
  sectionLabel: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: "#4b5563",
    padding: "6px 12px 2px",
    textTransform: "uppercase"
  },
  gitBranchRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    width: "100%",
    padding: "7px 12px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "#9ca3af",
    fontSize: 12,
    textAlign: "left",
    fontFamily: "inherit",
    transition: "background 0.1s"
  },
  gitBranchSelected: {
    background: "#111827",
    color: "#f9fafb"
  },
  gitBranchCurrent: {
    color: "#bfd4f0"
  },
  gitBranchIcon: {
    fontSize: 11,
    width: 14,
    flexShrink: 0
  },
  gitBranchName: {
    flex: 1,
    fontFamily: "inherit",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
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

// src/components/graph/GraphRenderer.tsx
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
  const [filters, setFilters] = useState4(DEFAULT_FILTERS);
  const [annotations, setAnnotations] = useState4({});
  const [selectedId, setSelectedId] = useState4(null);
  const [sidebarTab, setSidebarTab] = useState4("filters");
  const [viewType, setViewType] = useState4(
    () => recommendedView(graph.meta.layoutTemplate)
  );
  const [newNodeForm, setNewNodeForm] = useState4({ type: "module", label: "" });
  const [connectingFromId, setConnectingFromId] = useState4(null);
  const [diffBranch, setDiffBranch] = useState4(null);
  const [diffFiles, setDiffFiles] = useState4(null);
  const [diffLoading, setDiffLoading] = useState4(false);
  const handleSelectGitBranch = useCallback3(async (branchName) => {
    setDiffBranch(branchName);
    if (!branchName) {
      setDiffFiles(null);
      return;
    }
    setDiffLoading(true);
    try {
      const res = await fetch(`/api/diff?to=${encodeURIComponent(branchName)}`);
      if (!res.ok) {
        setDiffFiles(null);
        return;
      }
      const data = await res.json();
      setDiffFiles(data.files ?? []);
    } catch {
      setDiffFiles(null);
    } finally {
      setDiffLoading(false);
    }
  }, []);
  const { nodes: initialNodes, edges: initialEdges } = useMemo3(() => {
    if (isOnBranch && resolvedGraph) {
      return buildReactFlowGraphFromResolved(resolvedGraph, graph.meta.layoutTemplate);
    }
    return buildReactFlowGraph(graph);
  }, [isOnBranch, resolvedGraph, graph]);
  const flowKey = activeBranchId ?? "__base__";
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  useEffect3(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [flowKey, initialNodes, initialEdges, setNodes, setEdges]);
  useEffect3(() => {
    if (!connectingFromId) return;
    function onKey(e) {
      if (e.key === "Escape") setConnectingFromId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connectingFromId]);
  const edgeDataArray = useMemo3(
    () => edges.map((e) => {
      var _a, _b, _c;
      return {
        edge: e,
        type: ((_a = e.data) == null ? void 0 : _a.edgeType) ?? "engineering",
        conf: ((_b = e.data) == null ? void 0 : _b.confidence) ?? "high",
        str: ((_c = e.data) == null ? void 0 : _c.strength) ?? 1
      };
    }),
    [edges]
  );
  const visibleEdges = useMemo3(() => {
    return edgeDataArray.filter(({ type, conf, str }) => {
      if (!filters.showEngineering && type === "engineering") return false;
      if (!filters.showArchitecture && type === "architecture") return false;
      if (!filters.showBoth && type === "both") return false;
      if (!filters.showUncertain && conf === "uncertain") return false;
      if (str < filters.minStrength) return false;
      return true;
    }).map(({ edge }) => edge);
  }, [edgeDataArray, filters]);
  const highlightedEdges = useMemo3(() => visibleEdges.map((e) => {
    if (!selectedId) return e;
    if (e.source !== selectedId && e.target !== selectedId) return e;
    return { ...e, data: { ...e.data, highlighted: true } };
  }), [visibleEdges, selectedId]);
  const diffFileSet = useMemo3(() => {
    if (!diffFiles) return null;
    const map = /* @__PURE__ */ new Map();
    for (const f of diffFiles) map.set(f.path, f.status);
    return map;
  }, [diffFiles]);
  const annotatedNodes = useMemo3(() => nodes.map((n) => {
    var _a;
    const ann = annotations[n.id];
    let diffStatus;
    if (diffFileSet && ((_a = n.data) == null ? void 0 : _a.files)) {
      const filePaths = n.data.files;
      for (const fp of filePaths) {
        const status = diffFileSet.get(fp);
        if (status) {
          diffStatus = status;
          break;
        }
      }
    }
    return {
      ...n,
      data: {
        ...n.data,
        label: (ann == null ? void 0 : ann.customLabel) ?? n.data.label,
        statusTag: (ann == null ? void 0 : ann.statusTag) !== "none" ? ann == null ? void 0 : ann.statusTag : void 0,
        diffStatus
        // 'added' | 'modified' | 'deleted'
      }
    };
  }), [nodes, annotations, diffFileSet]);
  const nodeMap = useMemo3(() => {
    const map = /* @__PURE__ */ new Map();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);
  const onConnect = useCallback3(
    (params) => setEdges((eds) => addEdge({ ...params, type: "repoEdge" }, eds)),
    [setEdges]
  );
  const onNodeClick = useCallback3((_, node) => {
    if (connectingFromId && connectingFromId !== node.id) {
      if (!isOnBranch || !resolvedGraph || !activeBranch || !graph) return;
      const current = resolvedToRepoGraph(graph, resolvedGraph, activeBranch.name);
      const edgeId = `edge__manual__${connectingFromId}__${node.id}__${Date.now()}`;
      current.edges.push({
        id: edgeId,
        source: connectingFromId,
        target: node.id,
        edgeType: "engineering",
        strength: 3,
        confidence: "high",
        label: ""
      });
      replaceActiveBranchGraph(current);
      setConnectingFromId(null);
      return;
    }
    setSelectedId(node.id);
    setSidebarTab("node");
  }, [connectingFromId, isOnBranch, resolvedGraph, activeBranch, graph, replaceActiveBranchGraph]);
  function handleDeleteSelectedNode() {
    if (!selectedId || !isOnBranch || !resolvedGraph || !activeBranch || !graph) return;
    const current = resolvedToRepoGraph(graph, resolvedGraph, activeBranch.name);
    current.nodes = current.nodes.filter((n) => n.id !== selectedId);
    current.edges = current.edges.filter((e) => e.source !== selectedId && e.target !== selectedId);
    replaceActiveBranchGraph(current);
    setSelectedId(null);
  }
  function handleAddNode() {
    if (!newNodeForm.label.trim() || !isOnBranch || !resolvedGraph || !activeBranch || !graph) return;
    const slug = newNodeForm.label.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") || "node";
    const newNode = {
      id: `manual__${newNodeForm.type}__${slug}__${Date.now()}`,
      label: newNodeForm.label.trim(),
      type: newNodeForm.type,
      parentId: null,
      depth: newNodeForm.type === "layer" ? 0 : newNodeForm.type === "module" ? 1 : 2,
      files: [],
      detectedRole: "",
      patterns: [],
      metadata: {}
    };
    const current = resolvedToRepoGraph(graph, resolvedGraph, activeBranch.name);
    replaceActiveBranchGraph({ ...current, nodes: [...current.nodes, newNode] });
    setNewNodeForm((f) => ({ ...f, label: "" }));
    setSelectedId(null);
  }
  function handleDeleteEdge(edgeId) {
    if (!isOnBranch || !resolvedGraph || !activeBranch || !graph) return;
    const current = resolvedToRepoGraph(graph, resolvedGraph, activeBranch.name);
    current.edges = current.edges.filter((e) => e.id !== edgeId);
    replaceActiveBranchGraph(current);
  }
  const connectedEdges = useMemo3(() => {
    if (!selectedId) return [];
    return edges.filter((e) => e.source === selectedId || e.target === selectedId).map((e) => {
      var _a, _b;
      const otherId = e.source === selectedId ? e.target : e.source;
      const otherNode = nodeMap.get(otherId);
      return { edgeId: e.id, otherId, otherLabel: ((_a = otherNode == null ? void 0 : otherNode.data) == null ? void 0 : _a.label) ?? otherId, otherType: ((_b = otherNode == null ? void 0 : otherNode.data) == null ? void 0 : _b.nodeType) ?? "?" };
    });
  }, [edges, nodeMap, selectedId]);
  const selectedNode = useMemo3(
    () => nodeMap.get(selectedId ?? "") ?? null,
    [nodeMap, selectedId]
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
  const edgeCounts = useMemo3(() => {
    const c = { engineering: 0, architecture: 0, both: 0, uncertain: 0 };
    for (const e of edges) {
      const d = e.data;
      const type = (d == null ? void 0 : d.edgeType) ?? "engineering";
      const conf = (d == null ? void 0 : d.confidence) ?? "high";
      if (type === "engineering") c.engineering++;
      if (type === "architecture") c.architecture++;
      if (type === "both") c.both++;
      if (conf === "uncertain") c.uncertain++;
    }
    return c;
  }, [edges]);
  const nodeCounts = useMemo3(() => {
    const c = { layer: 0, module: 0, file: 0, component: 0 };
    for (const n of nodes) {
      const type = n.data.nodeType;
      if (type && type in c) c[type]++;
    }
    return c;
  }, [nodes]);
  return /* @__PURE__ */ React.createElement("div", { style: { width: "100%", height: "100%", display: "flex", background: "#0b0f1a", fontFamily: '"Inter", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif' } }, /* @__PURE__ */ React.createElement("div", { style: sidebarStyle }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#3b82f6", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 14 } }, "{", /* @__PURE__ */ React.createElement("span", { style: { color: "#a78bfa" } }, "repo"), "map", "}"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", borderBottom: "1px solid #1e293b", marginBottom: 16 } }, ["filters", "node", "export", "branches"].map((tab) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: tab,
      onClick: () => setSidebarTab(tab),
      style: {
        ...tabBtnStyle,
        color: sidebarTab === tab ? "#93c5fd" : "#475569",
        borderBottom: sidebarTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
        position: "relative"
      }
    },
    tab === "filters" ? "\u2699" : tab === "node" ? "\u25CE" : tab === "export" ? "\u2197" : "\u2442",
    " ",
    tab,
    tab === "branches" && isOnBranch && /* @__PURE__ */ React.createElement("span", { style: {
      position: "absolute",
      top: 4,
      right: 2,
      width: 5,
      height: 5,
      borderRadius: "50%",
      background: (activeBranch == null ? void 0 : activeBranch.color) ?? "#60a5fa",
      display: "block"
    } })
  ))), sidebarTab === "filters" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 20 } }, /* @__PURE__ */ React.createElement(Section, { title: "Connection type", subtitle: "Toggle edge layers" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement(ToggleRow, { label: "Runtime calls", color: "#60a5fa", count: edgeCounts.engineering, value: filters.showEngineering, onChange: (v) => setFilters((f) => ({ ...f, showEngineering: v })) }), /* @__PURE__ */ React.createElement(ToggleRow, { label: "Design structure", color: "#c084fc", count: edgeCounts.architecture, value: filters.showArchitecture, onChange: (v) => setFilters((f) => ({ ...f, showArchitecture: v })) }), /* @__PURE__ */ React.createElement(ToggleRow, { label: "Mixed", color: "#f472b6", count: edgeCounts.both, value: filters.showBoth, onChange: (v) => setFilters((f) => ({ ...f, showBoth: v })) }), /* @__PURE__ */ React.createElement(ToggleRow, { label: "Uncertain", color: "#64748b", count: edgeCounts.uncertain, value: filters.showUncertain, onChange: (v) => setFilters((f) => ({ ...f, showUncertain: v })) }))), /* @__PURE__ */ React.createElement(Section, { title: "Min strength" }, /* @__PURE__ */ React.createElement(
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
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 9, color: "#334155", marginTop: 2 } }, [1, 2, 3, 4, 5].map((v) => /* @__PURE__ */ React.createElement("span", { key: v, style: { color: filters.minStrength === v ? "#93c5fd" : void 0 } }, v)))), /* @__PURE__ */ React.createElement(Section, { title: "View" }, /* @__PURE__ */ React.createElement(ViewSwitcher, { current: viewType, recommended: recommendedView(graph.meta.layoutTemplate), onChange: setViewType })), isOnBranch && /* @__PURE__ */ React.createElement(Section, { title: "Add node" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 4 } }, ["layer", "module", "file"].map((type) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: type,
      onClick: () => setNewNodeForm((f) => ({ ...f, type })),
      style: {
        flex: 1,
        fontSize: 10,
        fontFamily: "inherit",
        background: newNodeForm.type === type ? "rgba(59,130,246,0.15)" : "transparent",
        border: `1px solid ${newNodeForm.type === type ? "#3b82f6" : "#1e293b"}`,
        borderRadius: 5,
        color: newNodeForm.type === type ? "#93c5fd" : "#475569",
        padding: "5px 4px",
        cursor: "pointer"
      }
    },
    type
  ))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 4 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      value: newNodeForm.label,
      onChange: (e) => setNewNodeForm((f) => ({ ...f, label: e.target.value })),
      onKeyDown: (e) => e.key === "Enter" && handleAddNode(),
      style: { flex: 1, ...sidebarInputStyle },
      placeholder: "Node name\u2026"
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: handleAddNode,
      disabled: !newNodeForm.label.trim(),
      style: {
        background: newNodeForm.label.trim() ? "rgba(59,130,246,0.15)" : "transparent",
        border: `1px solid ${newNodeForm.label.trim() ? "#3b82f6" : "#1e293b"}`,
        borderRadius: 5,
        color: newNodeForm.label.trim() ? "#93c5fd" : "#475569",
        padding: "0 10px",
        cursor: newNodeForm.label.trim() ? "pointer" : "not-allowed",
        fontFamily: "inherit",
        fontSize: 11,
        whiteSpace: "nowrap"
      }
    },
    "\u2795"
  ))))), sidebarTab === "node" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 16 } }, !selectedNode ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#334155", paddingTop: 8 } }, "Click a node to inspect it.") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: "#e2e8f0" } }, selectedNode.data.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#475569", marginTop: 2 } }, selectedNode.id)), selectedNode.data.isBranchNode && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#60a5fa", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.15)", borderRadius: 6, padding: "6px 10px" } }, "\u2442 Added in branch"), /* @__PURE__ */ React.createElement(Section, { title: "Custom label" }, /* @__PURE__ */ React.createElement("input", { style: sidebarInputStyle, placeholder: selectedNode.data.label, value: selectedAnn.customLabel ?? "", onChange: (e) => updateAnnotation(selectedNode.id, { customLabel: e.target.value || void 0 }) })), /* @__PURE__ */ React.createElement(Section, { title: "Annotation" }, /* @__PURE__ */ React.createElement("textarea", { style: { ...sidebarInputStyle, resize: "vertical", minHeight: 60 }, placeholder: "Add a note\u2026", value: selectedAnn.annotation ?? "", onChange: (e) => updateAnnotation(selectedNode.id, { annotation: e.target.value || void 0 }) })), /* @__PURE__ */ React.createElement(Section, { title: "Status tag" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } }, ["none", "stable", "in_refactor", "legacy", "deprecated"].map((tag) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: tag,
      onClick: () => updateAnnotation(selectedNode.id, { statusTag: tag }),
      style: {
        ...ghostBtn,
        color: selectedAnn.statusTag === tag || !selectedAnn.statusTag && tag === "none" ? "#93c5fd" : "#475569",
        borderColor: selectedAnn.statusTag === tag || !selectedAnn.statusTag && tag === "none" ? "#3b82f6" : "#1e293b"
      }
    },
    tag === "none" ? "none" : tag.replace("_", " ")
  )))), isOnBranch && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: handleDeleteSelectedNode,
      style: {
        ...ghostBtn,
        background: "rgba(239,68,68,0.1)",
        borderColor: "#ef4444",
        color: "#f87171",
        marginTop: 8,
        width: "100%",
        textAlign: "center"
      }
    },
    "\u2715 Delete node"
  ), isOnBranch && /* @__PURE__ */ React.createElement(Section, { title: connectingFromId ? `Connecting ${selectedNode.data.label}\u2026` : "Connections" }, connectingFromId ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#60a5fa", background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.15)", borderRadius: 6, padding: "6px 10px" } }, "Click the target node in the graph, or press Esc to cancel."), /* @__PURE__ */ React.createElement("button", { onClick: () => setConnectingFromId(null), style: { ...ghostBtn, width: "100%", textAlign: "center", fontSize: 10, color: "#94a3b8" } }, "Cancel")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setConnectingFromId(selectedNode.id),
      style: { ...ghostBtn, width: "100%", textAlign: "center", fontSize: 10, color: "#93c5fd", borderColor: "#3b82f6", marginBottom: 8 }
    },
    "\u27F7 Create connection"
  ), connectedEdges.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#334155" } }, "No connections yet.") : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } }, connectedEdges.map((ce) => /* @__PURE__ */ React.createElement("div", { key: ce.edgeId, style: { display: "flex", alignItems: "center", gap: 4, fontSize: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#94a3b8" } }, ce.otherLabel), /* @__PURE__ */ React.createElement("span", { style: { color: "#334155", marginLeft: 4 } }, "(", ce.otherType, ")")), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => handleDeleteEdge(ce.edgeId),
      title: "Delete connection",
      style: {
        background: "none",
        border: "none",
        cursor: "pointer",
        color: "#ef4444",
        fontSize: 12,
        padding: "2px 4px",
        fontFamily: "inherit",
        flexShrink: 0
      }
    },
    "\u2715"
  )))))))), sidebarTab === "export" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement(Section, { title: "Export graph" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement(ExportBtn, { label: "Export SVG", sub: "Vector, scalable", onClick: handleExportSVG }), /* @__PURE__ */ React.createElement(ExportBtn, { label: "Export PNG", sub: "Raster, 2\xD7 density", onClick: handleExportPNG }))), isOnBranch && activeBranch && /* @__PURE__ */ React.createElement(Section, { title: "Branch note" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#60a5fa", background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.15)", borderRadius: 6, padding: "8px 10px" } }, "Exporting ", /* @__PURE__ */ React.createElement("strong", null, activeBranch.name), " \u2014 branch nodes included."))), sidebarTab === "branches" && /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", margin: "0 -14px", overflow: "hidden" } }, /* @__PURE__ */ React.createElement(
    BranchPanel,
    {
      graph,
      activeGitBranch: diffBranch,
      onSelectGitBranch: handleSelectGitBranch
    }
  ))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, position: "relative", overflow: "hidden" } }, diffBranch && /* @__PURE__ */ React.createElement("div", { style: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    background: "rgba(15,23,42,0.92)",
    borderBottom: "2px solid #f87171",
    padding: "5px 14px",
    display: "flex",
    alignItems: "center",
    gap: 10,
    backdropFilter: "blur(6px)",
    fontSize: 12,
    fontFamily: "inherit"
  } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#f87171", fontWeight: 700 } }, "\u2442 ", diffBranch), /* @__PURE__ */ React.createElement("span", { style: { color: "#9ca3af", fontSize: 11 } }, diffLoading ? "Loading diff..." : `Showing file diff (${(diffFiles == null ? void 0 : diffFiles.length) ?? 0} files changed)`), /* @__PURE__ */ React.createElement("span", { style: {
    marginLeft: "auto",
    fontSize: 10,
    color: "#d97706",
    background: "rgba(217,119,6,0.1)",
    border: "1px solid rgba(217,119,6,0.25)",
    borderRadius: 4,
    padding: "2px 8px"
  } }, "Diff only \u2014 ask agent for full analysis"), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => handleSelectGitBranch(null),
      style: { background: "none", border: "1px solid #475569", borderRadius: 4, color: "#9ca3af", fontSize: 10, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }
    },
    "\u2715"
  )), isOnBranch && activeBranch && /* @__PURE__ */ React.createElement("div", { style: {
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
  } }, /* @__PURE__ */ React.createElement("span", { style: { width: 8, height: 8, borderRadius: "50%", background: activeBranch.color ?? "#60a5fa", flexShrink: 0, display: "inline-block" } }), /* @__PURE__ */ React.createElement("span", { style: { color: "#60a5fa", fontWeight: 700 } }, "\u2442 ", activeBranch.name), activeBranch.description && /* @__PURE__ */ React.createElement("span", { style: { color: "#374151", borderLeft: "1px solid #1e293b", paddingLeft: 10 } }, activeBranch.description), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setSidebarTab("branches"),
      style: { marginLeft: "auto", background: "none", border: "1px solid #1e293b", borderRadius: 4, color: "#475569", fontSize: 10, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }
    },
    "manage"
  )), viewType === "graph" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
    ReactFlow,
    {
      key: flowKey,
      nodes: annotatedNodes,
      edges: highlightedEdges,
      onNodesChange,
      onEdgesChange,
      onConnect,
      onNodeClick,
      nodeTypes,
      edgeTypes,
      fitView: true,
      minZoom: 0.25,
      maxZoom: 2,
      onlyRenderVisibleElements: true,
      style: { background: "#0b0f1a", paddingTop: isOnBranch || diffBranch ? 36 : 0 }
    },
    /* @__PURE__ */ React.createElement(Background, { variant: BackgroundVariant.Dots, gap: 24, size: 1.5, color: "#1e2a3a" }),
    /* @__PURE__ */ React.createElement(Controls, { style: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 } }),
    /* @__PURE__ */ React.createElement(
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
  ), /* @__PURE__ */ React.createElement(Legend, { nodeCounts, edgeCounts })), viewType !== "graph" && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", inset: 0, paddingTop: isOnBranch || diffBranch ? 256 : 220, boxSizing: "border-box" } }, viewType === "onion" && /* @__PURE__ */ React.createElement(OnionView, { graph, onNodeClick: (n) => {
    setSelectedId(n.id);
    setSidebarTab("node");
  } }), viewType === "layers" && /* @__PURE__ */ React.createElement(LayerStackView, { graph, onNodeClick: (n) => {
    setSelectedId(n.id);
    setSidebarTab("node");
  } }), viewType === "clusters" && /* @__PURE__ */ React.createElement(ClusterView, { graph, onNodeClick: (n) => {
    setSelectedId(n.id);
    setSidebarTab("node");
  } }), viewType === "pipeline" && /* @__PURE__ */ React.createElement(PipelineView, { graph, onNodeClick: (n) => {
    setSelectedId(n.id);
    setSidebarTab("node");
  } }))));
}
var Section = memo3(function Section2({ title, subtitle, children }) {
  return /* @__PURE__ */ React.createElement("div", { style: { animation: "fadeUp 0.25s ease both" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 } }, title), subtitle && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#475569", marginBottom: 8 } }, subtitle), children);
});
var ToggleRow = memo3(function ToggleRow2({ label, color, count, value, onChange }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 7 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 10, height: 10, borderRadius: 2, background: color, opacity: value ? 1 : 0.25, flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: value ? "#cbd5e1" : "#475569" } }, label), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#334155", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 4, padding: "1px 5px" } }, count)), /* @__PURE__ */ React.createElement("button", { onClick: () => onChange(!value), style: { width: 32, height: 18, borderRadius: 9, border: "none", cursor: "pointer", background: value ? "#1d4ed8" : "#1e293b", position: "relative", transition: "background 0.2s", flexShrink: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", top: 3, width: 12, height: 12, borderRadius: "50%", background: value ? "#93c5fd" : "#475569", left: value ? 17 : 3, transition: "left 0.2s" } })));
});
var ExportBtn = memo3(function ExportBtn2({ label, sub, onClick }) {
  return /* @__PURE__ */ React.createElement("button", { className: "repo-control", onClick, style: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "12px 14px", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#93c5fd", fontWeight: 700 } }, label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#64748b", marginTop: 2 } }, sub));
});
var Legend = memo3(function Legend2({
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
  return /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: 16, left: 16, background: "rgba(15,23,42,0.9)", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", backdropFilter: "blur(8px)", zIndex: 10, display: "flex", gap: 20 } }, nodeItems.length > 0 && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 } }, "Nodes"), nodeItems.map(({ key, label, color }) => /* @__PURE__ */ React.createElement("div", { key, style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.9 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#94a3b8" } }, label), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#475569" } }, nodeCounts[key])))), edgeItems.length > 0 && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 } }, "Connections"), edgeItems.map(({ key, label, color, dash }) => /* @__PURE__ */ React.createElement("div", { key, style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 } }, /* @__PURE__ */ React.createElement("svg", { width: 22, height: 10 }, /* @__PURE__ */ React.createElement("line", { x1: 0, y1: 5, x2: 22, y2: 5, stroke: color, strokeWidth: 1.5, strokeDasharray: dash })), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#94a3b8" } }, label), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#475569" } }, edgeCounts[key]))), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid #1e293b", color: "#475569", fontSize: 9, lineHeight: 1.5, marginTop: 6, paddingTop: 5 } }, "solid high \xB7 dashed medium \xB7 dotted uncertain")));
});
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

// src/components/graph/ManualEditor.tsx
import {
  useCallback as useCallback4,
  useState as useState5,
  useRef as useRef4,
  useMemo as useMemo4,
  useEffect as useEffect4
} from "react";
import {
  ReactFlow as ReactFlow2,
  Background as Background2,
  Controls as Controls2,
  BackgroundVariant as BackgroundVariant2,
  useNodesState as useNodesState2,
  useEdgesState as useEdgesState2,
  addEdge as addEdge2,
  MiniMap as MiniMap2
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
      position: (ov == null ? void 0 : ov.position) ?? {
        x: i % col * 280,
        y: Math.floor(i / col) * 140
      },
      data: {
        label: (ov == null ? void 0 : ov.customLabel) ?? n.label,
        nodeType: n.type,
        detectedRole: n.detectedRole,
        patterns: n.patterns,
        fileCount: n.files.length,
        files: n.files,
        complexity: n.metadata.complexity,
        depth: n.depth,
        parentId: n.parentId,
        statusTag: (ov == null ? void 0 : ov.statusTag) ?? n.metadata.statusTag
      }
    };
  });
  const rfEdges = allEdges.filter((e) => {
    var _a;
    return !((_a = graph.overlay.edgeOverrides[e.id]) == null ? void 0 : _a.hidden);
  }).map((e) => ({
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
  const edges = rfEdges.map((e) => {
    var _a, _b, _c;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      edgeType: ((_a = e.data) == null ? void 0 : _a.edgeType) ?? "engineering",
      strength: ((_b = e.data) == null ? void 0 : _b.strength) ?? 3,
      confidence: ((_c = e.data) == null ? void 0 : _c.confidence) ?? "high",
      label: typeof e.label === "string" ? e.label : void 0
    };
  });
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
  return /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 } }, children);
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
  var _a, _b;
  const baseGraph = useMemo4(
    () => initialGraph ?? emptyGraph(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const { nodes: initRFNodes, edges: initRFEdges } = useMemo4(
    () => graphToRF(baseGraph),
    [baseGraph]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState2(initRFNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState2(initRFEdges);
  const [diagramName, setDiagramName] = useState5(baseGraph.meta.repoName);
  const [layout, setLayout] = useState5(baseGraph.meta.layoutTemplate);
  const [selectedNodeId, setSelectedNodeId] = useState5(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState5(null);
  const [tab, setTab] = useState5("add");
  const [newNode, setNewNode] = useState5({
    label: "",
    type: "module",
    role: ""
  });
  const [edgeState, setEdgeState] = useState5({
    active: false,
    sourceId: null,
    edgeType: "engineering",
    strength: 3,
    label: ""
  });
  const reactFlowRef = useRef4(null);
  const selectedNode = useMemo4(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );
  const selectedEdge = useMemo4(
    () => edges.find((e) => e.id === selectedEdgeId) ?? null,
    [edges, selectedEdgeId]
  );
  const lockedNodeSet = useMemo4(() => new Set(lockedNodeIds), [lockedNodeIds]);
  const lockedEdgeSet = useMemo4(() => new Set(lockedEdgeIds), [lockedEdgeIds]);
  const highlightedEdges = useMemo4(() => edges.map((e) => {
    if (!selectedNodeId) return e;
    if (e.source !== selectedNodeId && e.target !== selectedNodeId) return e;
    return { ...e, data: { ...e.data, highlighted: true } };
  }), [edges, selectedNodeId]);
  const selectedNodeLocked = selectedNodeId ? lockedNodeSet.has(selectedNodeId) : false;
  const selectedEdgeLocked = selectedEdgeId ? lockedEdgeSet.has(selectedEdgeId) : false;
  const onNodeClick = useCallback4((_, node) => {
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
  const onEdgeClick = useCallback4((_, edge) => {
    if (edgeState.active) return;
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setTab("inspect");
  }, [edgeState.active]);
  function handleAddNode() {
    var _a2;
    if (!newNode.label.trim()) return;
    const id = makeNodeId(newNode.type, newNode.label);
    const depth = ((_a2 = NODE_TYPES_LIST.find((t) => t.type === newNode.type)) == null ? void 0 : _a2.depth) ?? 1;
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
    if (selectedNodeId) {
      setNodes((ns) => ns.filter((n) => n.id !== selectedNodeId));
      setEdges((es) => es.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
      setSelectedNodeId(null);
    }
    if (selectedEdgeId) {
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
  const onConnect = useCallback4((params) => {
    setEdges((es) => addEdge2({
      ...params,
      type: "repoEdge",
      data: {
        edgeType: edgeState.edgeType,
        confidence: "high",
        strength: edgeState.strength
      }
    }, es));
  }, [setEdges, edgeState.edgeType, edgeState.strength]);
  useEffect4(() => {
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
  return /* @__PURE__ */ React.createElement("div", { style: { width: "100%", height: "100%", display: "flex", background: "#0b0f1a", fontFamily: '"Inter", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif' } }, /* @__PURE__ */ React.createElement("div", { style: {
    width: 240,
    flexShrink: 0,
    background: "#080e1a",
    borderRight: "1px solid #1e293b",
    display: "flex",
    flexDirection: "column",
    padding: "16px 14px",
    gap: 16,
    overflowY: "auto"
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#3b82f6", fontWeight: 700, letterSpacing: "0.08em" } }, "{", /* @__PURE__ */ React.createElement("span", { style: { color: "#a78bfa" } }, "repo"), "map", "}"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: mode === "edit" ? "#a78bfa" : "#475569", background: mode === "edit" ? "rgba(167,139,250,0.1)" : "rgba(71,85,105,0.1)", border: `1px solid ${mode === "edit" ? "rgba(167,139,250,0.3)" : "#1e293b"}`, borderRadius: 4, padding: "2px 6px" } }, mode === "edit" ? "\u270E edit mode" : "\u2726 manual")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 } }, "Diagram name"), /* @__PURE__ */ React.createElement(
    "input",
    {
      value: diagramName,
      onChange: (e) => setDiagramName(e.target.value),
      style: inputStyle,
      placeholder: "My architecture"
    }
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", borderBottom: "1px solid #1e293b" } }, ["add", "inspect", "settings"].map((t) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: t,
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
      }
    },
    t === "add" ? "\uFF0B add" : t === "inspect" ? "\u25CE node" : "\u2699 settings"
  ))), tab === "add" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(SectionTitle, null, "Node type"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 5 } }, NODE_TYPES_LIST.map(({ type, label, color }) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: type,
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
      }
    },
    label
  )))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(SectionTitle, null, "Label"), /* @__PURE__ */ React.createElement(
    "input",
    {
      autoFocus: true,
      value: newNode.label,
      onChange: (e) => setNewNode((f) => ({ ...f, label: e.target.value })),
      onKeyDown: (e) => e.key === "Enter" && handleAddNode(),
      style: inputStyle,
      placeholder: `e.g. "Auth module"`
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(SectionTitle, null, "Role (optional)"), /* @__PURE__ */ React.createElement(
    "input",
    {
      value: newNode.role,
      onChange: (e) => setNewNode((f) => ({ ...f, role: e.target.value })),
      onKeyDown: (e) => e.key === "Enter" && handleAddNode(),
      style: inputStyle,
      placeholder: `e.g. "authentication"`
    }
  )), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: handleAddNode,
      disabled: !newNode.label.trim(),
      style: {
        ...actionBtnStyle,
        opacity: newNode.label.trim() ? 1 : 0.4,
        cursor: newNode.label.trim() ? "pointer" : "not-allowed"
      }
    },
    "\uFF0B Add ",
    newNode.type
  ), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid #1e293b", paddingTop: 12, marginTop: 4 } }, /* @__PURE__ */ React.createElement(SectionTitle, null, "Connect nodes"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 } }, EDGE_TYPES_LIST.map(({ type, label, color }) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: type,
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
      }
    },
    /* @__PURE__ */ React.createElement("svg", { width: 18, height: 8 }, /* @__PURE__ */ React.createElement("line", { x1: 0, y1: 4, x2: 18, y2: 4, stroke: color, strokeWidth: 1.5, strokeDasharray: type === "architecture" ? "5,3" : void 0 })),
    label
  ))), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#334155", marginBottom: 4 } }, "Strength: ", edgeState.strength), /* @__PURE__ */ React.createElement(
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
  )), /* @__PURE__ */ React.createElement(
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
      }
    },
    isEdgeMode ? edgeState.sourceId ? `\u25B8 click target node\u2026` : `\u25B8 click source node\u2026` : "\u27F5 draw connection"
  ), isEdgeMode && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#334155", marginTop: 5, lineHeight: 1.5 } }, "Click two nodes to connect them. Press Esc to exit."))), tab === "inspect" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, !hasSelected ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#334155" } }, "Click a node or edge to inspect.") : selectedNode ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, selectedNode.data.label), selectedNodeLocked && /* @__PURE__ */ React.createElement("div", { style: { background: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.14)", borderRadius: 6, color: "#64748b", fontSize: 10, lineHeight: 1.5, padding: "6px 8px" } }, "This node belongs to the base graph or a parent branch. You can connect to it, but edits are saved only for this branch's own nodes."), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(SectionTitle, null, "Label"), /* @__PURE__ */ React.createElement(
    "input",
    {
      value: selectedNode.data.label ?? "",
      onChange: (e) => updateSelectedNode({ label: e.target.value }),
      style: inputStyle,
      disabled: selectedNodeLocked
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(SectionTitle, null, "Type"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 4 } }, NODE_TYPES_LIST.map(({ type, label, color, depth }) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: type,
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
      }
    },
    label
  )))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(SectionTitle, null, "Role"), /* @__PURE__ */ React.createElement(
    "input",
    {
      value: selectedNode.data.detectedRole ?? "",
      onChange: (e) => updateSelectedNode({ detectedRole: e.target.value }),
      style: inputStyle,
      disabled: selectedNodeLocked,
      placeholder: "e.g. authentication"
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(SectionTitle, null, "Status tag"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 4 } }, [void 0, "stable", "legacy", "in_refactor", "deprecated"].map((tag) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: tag ?? "none",
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
      }
    },
    tag ?? "none"
  )))), /* @__PURE__ */ React.createElement("button", { onClick: handleDeleteSelected, disabled: selectedNodeLocked, style: { ...deleteBtnStyle, opacity: selectedNodeLocked ? 0.35 : 1, cursor: selectedNodeLocked ? "not-allowed" : "pointer" } }, "\u2715 Delete node")) : selectedEdge ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: "#e2e8f0" } }, "Edge"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#475569" } }, selectedEdge.source, " \u2192 ", selectedEdge.target), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(SectionTitle, null, "Label"), /* @__PURE__ */ React.createElement(
    "input",
    {
      value: typeof selectedEdge.label === "string" ? selectedEdge.label : "",
      onChange: (e) => updateSelectedEdge({ label: e.target.value }),
      style: inputStyle,
      placeholder: "e.g. calls, implements\u2026"
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(SectionTitle, null, "Type"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } }, EDGE_TYPES_LIST.map(({ type, label, color }) => {
    var _a2, _b2, _c;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: type,
        onClick: () => updateSelectedEdge({ edgeType: type }),
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: ((_a2 = selectedEdge.data) == null ? void 0 : _a2.edgeType) === type ? `rgba(${hexToRgb(color)},0.1)` : "transparent",
          border: `1px solid ${((_b2 = selectedEdge.data) == null ? void 0 : _b2.edgeType) === type ? color : "#1e293b"}`,
          borderRadius: 5,
          padding: "5px 9px",
          cursor: "pointer",
          color: ((_c = selectedEdge.data) == null ? void 0 : _c.edgeType) === type ? color : "#475569",
          fontSize: 10,
          fontFamily: "inherit"
        }
      },
      /* @__PURE__ */ React.createElement("svg", { width: 18, height: 8 }, /* @__PURE__ */ React.createElement("line", { x1: 0, y1: 4, x2: 18, y2: 4, stroke: color, strokeWidth: 1.5, strokeDasharray: type === "architecture" ? "5,3" : void 0 })),
      label
    );
  }))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(SectionTitle, null, "Strength: ", ((_a = selectedEdge.data) == null ? void 0 : _a.strength) ?? 3), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "range",
      min: 1,
      max: 5,
      step: 1,
      value: ((_b = selectedEdge.data) == null ? void 0 : _b.strength) ?? 3,
      onChange: (e) => updateSelectedEdge({ strength: Number(e.target.value) }),
      style: { width: "100%", accentColor: "#3b82f6" }
    }
  )), /* @__PURE__ */ React.createElement("button", { onClick: handleDeleteSelected, style: deleteBtnStyle }, "\u2715 Delete edge")) : null), tab === "settings" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(SectionTitle, null, "Layout"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } }, LAYOUT_OPTIONS.map(({ value, label }) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: value,
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
      }
    },
    layout === value ? "\u25B8 " : "  ",
    label
  )))), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid #1e293b", paddingTop: 12 } }, /* @__PURE__ */ React.createElement(SectionTitle, null, "Stats"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 5 } }, /* @__PURE__ */ React.createElement(Stat, { label: "Nodes", value: nodes.length }), /* @__PURE__ */ React.createElement(Stat, { label: "Connections", value: edges.length }), /* @__PURE__ */ React.createElement(Stat, { label: "Layers", value: nodes.filter((n) => n.data.nodeType === "layer").length }), /* @__PURE__ */ React.createElement(Stat, { label: "Modules", value: nodes.filter((n) => n.data.nodeType === "module").length })))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 } }, nodes.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#1e3a5f", textAlign: "center", padding: "8px 0" } }, "Add at least one node to save"), /* @__PURE__ */ React.createElement(
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
      }
    },
    mode === "edit" ? "\u2713 Save changes" : "\u2713 Create diagram"
  ), onCancel && /* @__PURE__ */ React.createElement("button", { onClick: onCancel, style: { ...actionBtnStyle, background: "transparent", color: "#334155", borderColor: "#1e293b" } }, "\u2715 Cancel"))), /* @__PURE__ */ React.createElement(
    "div",
    {
      ref: reactFlowRef,
      style: {
        flex: 1,
        position: "relative",
        cursor: isEdgeMode ? "crosshair" : "default"
      }
    },
    isEdgeMode && /* @__PURE__ */ React.createElement("div", { style: {
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
    } }, edgeState.sourceId ? `\u25B8 Now click the target node` : `\u25B8 Click the source node`, " \xB7 ", /* @__PURE__ */ React.createElement("span", { style: { color: "#475569" } }, "Esc to cancel")),
    nodes.length === 0 && /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: 5,
      textAlign: "center",
      pointerEvents: "none",
      color: "#1e293b",
      fontFamily: '"JetBrains Mono", monospace'
    } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28, marginBottom: 10 } }, "\u2B21"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, "Empty canvas"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11 } }, "Add your first node from the sidebar \u2192")),
    /* @__PURE__ */ React.createElement(
      ReactFlow2,
      {
        nodes,
        edges: highlightedEdges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        onNodeClick,
        onEdgeClick,
        nodeTypes,
        edgeTypes,
        fitView: true,
        minZoom: 0.25,
        maxZoom: 2,
        onlyRenderVisibleElements: true,
        fitViewOptions: { padding: 0.3 },
        deleteKeyCode: null,
        style: { background: "#0b0f1a" },
        defaultEdgeOptions: {
          type: "repoEdge",
          data: { edgeType: "engineering", confidence: "high", strength: 3 }
        }
      },
      /* @__PURE__ */ React.createElement(Background2, { variant: BackgroundVariant2.Dots, gap: 24, size: 1.5, color: "#1e2a3a" }),
      /* @__PURE__ */ React.createElement(Controls2, { style: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 } }),
      /* @__PURE__ */ React.createElement(
        MiniMap2,
        {
          style: { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 },
          nodeColor: (n) => {
            const t = n.data.nodeType;
            return t === "layer" ? "#60a5fa" : t === "module" ? "#a78bfa" : t === "file" ? "#34d399" : "#fb923c";
          },
          maskColor: "rgba(0,0,0,0.6)"
        }
      )
    ),
    /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      bottom: 14,
      right: 14,
      fontSize: 9,
      color: "#1e3a5f",
      fontFamily: '"JetBrains Mono", monospace',
      lineHeight: 1.8,
      textAlign: "right",
      pointerEvents: "none"
    } }, "Delete / Backspace \u2192 remove selected", /* @__PURE__ */ React.createElement("br", null), "Drag node handles \u2192 connect nodes", /* @__PURE__ */ React.createElement("br", null), "Esc \u2192 deselect / exit edge mode")
  ));
}
function Stat({ label, value }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "#334155" } }, label), /* @__PURE__ */ React.createElement("span", { style: { color: "#60a5fa", fontWeight: 700 } }, value));
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
export {
  BranchPanel,
  BranchProvider,
  GraphRenderer,
  ManualEditor,
  recommendedView,
  useBranches
};
