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
  const graphJson = JSON.stringify(pass2Output, null, 2)

  return `You are performing a semantic analysis of a software repository's architecture graph.

REPOSITORY: ${repoName}

GRAPH (nodes and edges from structural analysis):
${graphJson}

Your tasks:

1. For each node, determine:
   - detectedRole: a concise description of the node's architectural responsibility, e.g. "authentication", "data_access", "api_gateway", "domain_model", "event_bus", "cache_layer", "dto_validation", "background_jobs"
   - patterns: design patterns detected in this node in snake_case, e.g. ["repository_pattern", "dependency_injection", "factory"]. Return an empty array if no clear patterns are detected — do not guess.

2. Detect the top-level architectural pattern of the entire repository by analyzing the graph topology:
   - "clean_architecture": domain at center, use cases ring, adapters at perimeter
   - "hexagonal": explicit ports (interfaces) and adapters, clear inside/outside boundary
   - "mvc": model, view, controller separation
   - "microservices": independent deployable services with explicit inter-service boundaries
   - "layered_monolith": clear presentation → business logic → data access layers
   - "feature_modules": vertical slices organized by feature, shared kernel at center
   - "pipeline_etl": sequential data transformation stages, left-to-right flow
   - "unknown": mixed, unclear, or does not fit any of the above — do NOT force a pattern

3. Select the layout template that matches the detected pattern:
${Object.entries(PATTERN_TO_LAYOUT).map(([k, v]) => `   - ${k} → "${v}"`).join('\n')}

4. Assign patternConfidence (0.0 to 1.0) reflecting how clearly the codebase follows the detected pattern. If confidence is below 0.6, the layout will be overridden to "force_directed" automatically — you should still report the most likely pattern and your honest confidence score.

Note: you are working only from the graph structure — node IDs, edge types, depths, and topology. You do not have access to the source code at this stage.`
}

export { PATTERN_TO_LAYOUT }