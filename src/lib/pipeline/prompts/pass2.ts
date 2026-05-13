import type { Pass1Output } from '@/lib/pipeline/schemas/graph'

export function buildPass2NodesPrompt(
  repoName: string,
  tentativeModules: Pass1Output['tentativeModules'],
  sampledFileContents: string,
): string {
  const modulesJson = JSON.stringify(tentativeModules, null, 2)

  return `Analyze source code to create architecture graph nodes.

REPO: ${repoName}

MODULES:
${modulesJson}

SOURCE:
${sampledFileContents}

Create nodes with these fields (exact names):
- id: layer__X, module__X, file__X, or component__X
- label: short display name
- type: layer, module, file, or component
- parentId: null or parent node id
- depth: 0-3 (0=layer, 1=module, 2=file, 3=component)
- files: [paths]
- metadata: {language?, lineCount?, complexity?}

Rules:
- Layers have depth 0, parentId null
- Modules under layers, depth 1
- Files under modules, depth 2
- Complexity: "low", "medium", or "high" only

Return JSON with "nodes" array only. No markdown.`
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

  return `Map dependencies between nodes. Analyze imports, calls, and architecture patterns.

REPO: ${repoName}

NODES:
${nodesJson}

SOURCE:
${sampledFileContents}

Edge types:
- "engineering": direct import/call (runtime dependency only)
- "architecture": structural relationship (no direct call) - containment, layer boundary, ownership
- "both": crosses architectural boundary (UI→service, service→adapter, etc)

Rules:
- "engineering" for same-layer helpers
- "both" for UI/presentation→backend, service→integration, service→config
- "architecture" for parent-child/containment without direct calls

Confidence: "high" for explicit imports, "medium" for path/name evidence, "uncertain" for inference only.
Strength: 1-5 (1=weak, 5=critical)

Fields (exact):
- id: edge__source__target
- source, target: node ids
- edgeType: engineering|architecture|both
- strength: 1-5
- confidence: high|medium|uncertain
- label?: verb phrase like "calls" or "implements"

Return JSON with "edges" array only. No markdown.`
}
