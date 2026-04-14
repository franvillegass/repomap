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

Rules:
- If you detect clear architectural layers (e.g. presentation, domain, infrastructure), create layer nodes: type "layer", parentId = null, depth = 0
- Create a node for each module: type "module", parentId = layer node id if applicable or null, depth = 1
- Create a node for each individual file within a module: type "file", parentId = their module id, depth = 2
- Node ID format: layer__<name>, module__<name>, file__<path>
- For file nodes: set "files" to [the file path]. For module/layer nodes: set "files" to all file paths they contain.
- metadata: include language if detectable, lineCount if estimable, complexity if assessable. Use empty object {} if unknown.

Return ONLY a JSON object with a "nodes" array. Do not include edges.`
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

For each edge:
- id: format edge__<source>__<target>
- source and target must be valid node IDs from the list above
- strength (1–5): how central is this dependency
- confidence: "high", "medium", or "uncertain"
- label: short verb phrase e.g. "calls", "implements", "depends on"

Return ONLY a JSON object with an "edges" array. No markdown, no explanation.`
}