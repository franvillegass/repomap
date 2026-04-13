import type { Pass1Output } from '@/lib/pipeline/schemas/graph'

export function buildPass2Prompt(
  repoName: string,
  tentativeModules: Pass1Output['tentativeModules'],
  sampledFileContents: string,
): string {
  const modulesJson = JSON.stringify(tentativeModules, null, 2)

  return `You are analyzing the source code of a software repository to map its dependency structure.

REPOSITORY: ${repoName}

MODULES IDENTIFIED IN PREVIOUS ANALYSIS:
${modulesJson}

SOURCE FILES:
${sampledFileContents}

Your tasks:

1. Refine the module grouping from the previous analysis if the source code reveals a better grouping. You may split or merge modules. The previous grouping was based only on file paths — your analysis of actual code takes precedence.

2. Create nodes for the graph:
   - If you detect clear architectural layers (e.g. presentation, domain, infrastructure), create layer nodes: type "layer", parentId = null, depth = 0
   - Create a node for each module: type "module", parentId = layer node id if applicable or null, depth = 1
   - Create a node for each individual file within a module: type "file", parentId = their module id, depth = 2
   - Node ID format: layer__<name>, module__<name>, file__<path> (use the actual file path for files)

3. Identify dependencies between nodes and classify each edge:
   - "engineering": runtime behavioral dependency — direct calls, instantiations, data passing between concrete components
   - "architecture": structural design dependency — inheritance, interface implementation, composition, dependency injection
   - "both": edge that is clearly both simultaneously

4. For each edge assign:
   - id: unique string, format edge__<source>__<target>
   - strength (1–5): how central is this dependency (5 = system breaks without it)
   - confidence: "high" if unambiguous, "medium" if reasonable but debatable, "uncertain" if you cannot determine the type reliably
   - label (optional): short verb phrase, e.g. "calls", "implements", "depends on"`
}