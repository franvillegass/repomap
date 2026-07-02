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
    nodes.map(n => ({ id: n.id, label: n.label, type: n.type })),
    null,
    2,
  )

  return `Map edges between nodes by analyzing imports and calls in source code.

REPO: ${repoName}

NODES:
${nodesJson}

SOURCE:
${sampledFileContents}

Classify edges:
- "engineering": direct import/call
- "architecture": structural (no direct call)
- "both": crosses design boundary (UI→backend, service→adapter)

Strength 1-5, Confidence: high|medium|uncertain

Return: {"edges": [{id, source, target, edgeType, strength, confidence, label?}]}`
}
