import type { Pass1Output } from '@/lib/pipeline/schemas/graph'

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

FIELD NAMES - use exactly these, no substitutions:
- "label" (NOT "name", NOT "title") - a short human-readable display name
- "id" - unique identifier
- "type" - one of: "layer", "module", "file", "component"
- "parentId" - string id or null
- "depth" - integer 0, 1, 2, or 3
- "files" - array of file path strings
- "metadata" - object with optional fields:
    - "language": string (e.g. "TypeScript")
    - "lineCount": number
    - "complexity": MUST be the string "low", "medium", or "high" - never a number

STRUCTURE RULES:
- Detected architectural layers -> type "layer", parentId: null, depth: 0
- Each module -> type "module", parentId: layer id or null, depth: 1
- Each file -> type "file", parentId: its module id, depth: 2
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
  sampledFileContents: string,
): string {
  const nodesJson = JSON.stringify(
    nodes.map(n => ({ id: n.id, label: n.label, type: n.type, files: n.files })),
    null,
    2,
  )

  return `You are mapping dependencies between modules in a software repository.

REPOSITORY: ${repoName}

NODES:
${nodesJson}

SOURCE FILES:
${sampledFileContents}

Based on the source files, imports, function calls, class usage, file paths, node names, and common software architecture patterns, identify the most useful dependencies between these nodes.

Edge classification:
- "engineering": runtime behavioral dependency only - direct imports, function calls, object creation, data passing, API calls.
- "architecture": structural design relationship without a direct runtime call - containment, layer boundary, abstraction/contract, adapter role, ownership, framework/plugin relationship, configuration relationship, generated artifact relationship.
- "both": direct runtime dependency that also expresses an architectural boundary or role - UI/presentation calling application/service modules, service/orchestrator using adapters, backend module using configuration, document generator/exporter used by orchestration, external integration used by a service.

Classification guidance:
- Prefer "both" when a presentation/UI file calls backend/service/generator/integration code.
- Prefer "both" when an orchestrator/service calls a specialized adapter such as Excel, Word, email, search, database, API, or file storage.
- Prefer "architecture" for parent-child or layer/module ownership relationships when there is no direct import/call.
- Prefer "engineering" for simple same-layer helpers or direct calls that do not imply a design boundary.
- Do not mark everything as "engineering". If a dependency crosses a clear boundary (front -> back, UI -> service, service -> adapter, service -> config), use "both" unless there is no runtime call.
- Use "confidence": "high" for explicit imports/calls visible in the source, "medium" for strong path/name evidence, and "uncertain" only for weak inference.

For repositories with a simple UI/backend split, still capture the design structure:
- entrypoint -> UI app: engineering
- UI/app -> AI/business service: both
- UI/app -> document generators/exporters: both
- service -> config/client: both
- service -> external data/search/email adapters: both or architecture, depending on whether the source shows a direct call

For each edge, use EXACTLY these field names (no substitutions):
- "id": format edge__<source>__<target>
- "source": valid node id
- "target": valid node id
- "edgeType" (NOT "type") - one of: "engineering", "architecture", "both"
- "strength": integer 1-5
- "confidence": "high", "medium", or "uncertain"
- "label": short verb phrase e.g. "calls", "implements", "depends on"

Return ONLY a JSON object with an "edges" array. No markdown, no explanation.`
}
