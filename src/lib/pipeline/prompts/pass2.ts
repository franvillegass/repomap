import type { Pass1Output } from '@/lib/pipeline/schemas/graph'

// pass2.ts — reemplazar buildPass2NodesPrompt completo

export function buildPass2NodesPrompt(
  repoName: string,
  tentativeModules: Pass1Output['tentativeModules'],
  sampledFileContents: string,
): string {
  const modulesJson = JSON.stringify(tentativeModules, null, 2)

  return `You are analyzing the source code of a software repository to map its node structure.

REPOSITORY: ${repoName}

MODULES IDENTIFIED IN PREVIOUS ANALYSIS:
${modulesJson}

SOURCE FILES:
${sampledFileContents}

Your task: Create nodes for the architecture graph.

FIELD NAMES — use exactly these, no substitutions:
- "label" (NOT "name", NOT "title") — a short human-readable display name
- "id" — unique identifier
- "type" — one of: "layer", "module", "file", "component"
- "parentId" — string id or null
- "depth" — integer 0, 1, 2, or 3
- "files" — array of file path strings
- "metadata" — object with optional fields:
    - "language": string (e.g. "TypeScript")
    - "lineCount": number
    - "complexity": MUST be the string "low", "medium", or "high" — never a number

STRUCTURE RULES:
- Detected architectural layers → type "layer", parentId: null, depth: 0
- Each module → type "module", parentId: layer id or null, depth: 1
- Each file → type "file", parentId: its module id, depth: 2
- Node ID format: layer__<name>, module__<name>, file__<path>
- file nodes: "files" = [that file path]
- module/layer nodes: "files" = all contained file paths
- If metadata is unknown, use {}

Return ONLY a valid JSON object with a "nodes" array. No markdown, no code blocks, no explanation.

Example of a valid node:
{
  "id": "module__auth",
  "label": "Auth Module",
  "type": "module",
  "parentId": "layer__domain",
  "depth": 1,
  "files": ["src/auth/index.ts", "src/auth/guard.ts"],
  "metadata": { "language": "TypeScript", "complexity": "medium" }
}`
}

export function buildPass2EdgesPrompt(
  repoName: string,
  nodes: Array<{ id: string; label: string; type: string; files: string[] }>,
): string {
  const nodesJson = JSON.stringify(
    nodes.map(n => ({ id: n.id, label: n.label, type: n.type, files: n.files })),
    null,
    2
  )

  return `You are mapping dependencies between modules in a software repository.

REPOSITORY: ${repoName}

NODES:
${nodesJson}

Based on the node names, labels, file paths, and your knowledge of common software patterns, identify the most likely dependencies between these nodes.

Edge classification:
- "engineering": runtime behavioral dependency — direct calls, instantiations, data passing
- "architecture": structural design dependency — inheritance, interface implementation, composition
- "both": clearly both simultaneously

// Reemplazar la línea "For each edge:"

For each edge, use EXACTLY these field names (no substitutions):
- "id": format edge__<source>__<target>
- "source": valid node id
- "target": valid node id
- "edgeType" (NOT "type") — one of: "engineering", "architecture", "both"
- "strength": integer 1–5
- "confidence": "high", "medium", or "uncertain"
- "label": short verb phrase e.g. "calls", "implements", "depends on"

Return ONLY a JSON object with an "edges" array. No markdown, no explanation.`
}