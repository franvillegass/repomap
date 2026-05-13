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

  return `Semantic analysis of architecture graph.

REPO: ${repoName}

GRAPH:
${graphJson}

Tasks:
1. For each node: assign detectedRole (e.g. "authentication", "data_access", "api_gateway") and patterns (design patterns in snake_case, or [])
2. Detect architectural pattern: clean_architecture|hexagonal|mvc|microservices|layered_monolith|feature_modules|pipeline_etl|unknown
3. Select layout: concentric_rings|horizontal_three_column|cluster|vertical_layers|grid_clusters|left_right_flow|force_directed
4. Assign patternConfidence (0.0-1.0)

Return JSON:
{
  "meta": {
    "detectedPattern": "mvc",
    "layoutTemplate": "horizontal_three_column",
    "patternConfidence": 0.85
  },
  "nodeEnrichments": {
    "module__id": {
      "detectedRole": "presentation",
      "patterns": []
    }
  }
}

CRITICAL: Include nodeEnrichments entry for EVERY node.`
}

export { PATTERN_TO_LAYOUT }