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
- For files: set "files" array to [the file path]. For modules/layers: set "files" to all file paths they contain.
- metadata: include language if detectable, lineCount if estimable, complexity if assessable.

Return ONLY the nodes array. Do not include edges.`
}

export function buildPass2EdgesPrompt(
  repoName: string,
  nodes: Array<{ id: string; label: string; type: string }>,
  sampledFileContents: string,
): string {
  const nodesJson = JSON.stringify(nodes.map(n => ({ id: n.id, label: n.label, type: n.type })), null, 2)

  return `You are analyzing the source code of a software repository to map its dependency edges.

REPOSITORY: ${repoName}

NODES IN THE GRAPH:
${nodesJson}

SOURCE FILES:
${sampledFileContents}

Your task: Identify all dependencies between the nodes listed above.

Edge classification:
- "engineering": runtime behavioral dependency — direct calls, instantiations, data passing between concrete components
- "architecture": structural design dependency — inheritance, interface implementation, composition, dependency injection  
- "both": edge that is clearly both simultaneously

For each edge:
- id: format edge__<source>__<target>
- source and target must be valid node IDs from the list above
- strength (1–5): how central is this dependency (5 = system breaks without it)
- confidence: "high" if unambiguous, "medium" if reasonable but debatable, "uncertain" if you cannot determine
- label: short verb phrase, e.g. "calls", "implements", "depends on"

Return ONLY the edges array. Do not include nodes.`
}