import type { Pass2Output } from '@/lib/pipeline/schemas/graph'

const PATTERN_TO_LAYOUT: Record<string, string> = {
  clean_architecture: 'concentric_rings',
  hexagonal:          'concentric_rings',
  mvc:                'horizontal_three_column',
  microservices:      'cluster',
  layered_monolith:   'vertical_layers',
  feature_modules:    'grid_clusters',
  pipeline_etl:       'left_right_flow',
  unknown:            'force_directed',
}

export function buildPass3Prompt(repoName: string, pass2Output: Pass2Output): string {
  // Send only what's needed — strip metadata to reduce tokens
  const lightNodes = pass2Output.nodes.map(n => ({
    id: n.id,
    label: n.label,
    type: n.type,
    depth: n.depth,
    parentId: n.parentId,
  }))

  const lightEdges = pass2Output.edges.map(e => ({
    source: e.source,
    target: e.target,
    edgeType: e.edgeType,
  }))

  const graphJson = JSON.stringify({ nodes: lightNodes, edges: lightEdges }, null, 2)

  return `You are performing semantic analysis of a software architecture graph.

REPOSITORY: ${repoName}

GRAPH:
${graphJson}

Your tasks:

1. For each node, determine:
   - detectedRole: concise architectural responsibility e.g. "authentication", "data_access", "api_gateway", "domain_model"
   - patterns: design patterns in snake_case e.g. ["repository_pattern"]. Empty array if none detected.

2. Detect the top-level architectural pattern:
   - "clean_architecture", "hexagonal", "mvc", "microservices", "layered_monolith", "feature_modules", "pipeline_etl", "unknown"

3. Select layout template matching the pattern:
${Object.entries(PATTERN_TO_LAYOUT).map(([k, v]) => `   - ${k} → "${v}"`).join('\n')}

4. Assign patternConfidence (0.0 to 1.0).

Respond with ONLY this exact JSON structure:

{
  "meta": {
    "detectedPattern": "mvc",
    "layoutTemplate": "horizontal_three_column",
    "patternConfidence": 0.85
  },
  "nodeEnrichments": {
    "module__user_interface": {
      "detectedRole": "presentation",
      "patterns": []
    }
  }
}

Include one entry in nodeEnrichments for EVERY node id in the graph.`
}

export { PATTERN_TO_LAYOUT }