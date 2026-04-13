import type {
  RepoGraph,
  GraphMeta,
  Node,
  Overlay,
} from './schemas/graph'
import {
  Pass1OutputSchema,
  Pass2OutputSchema,
  Pass3OutputSchema,
  type Pass1Output,
  type Pass2Output,
} from './schemas/validation'
import { buildPass1Prompt, formatFileTree } from './prompts/pass1'
import { buildPass2Prompt } from './prompts/pass2'
import { buildPass3Prompt } from './prompts/pass3'
import { formatSampledFiles } from './sampler/fileSampler'
import { callModelWithSchema } from './aiClient'

// ------------------------------------------------------------
// Pipeline inputs
// ------------------------------------------------------------
export interface PipelineInput {
  repoUrl: string
  repoName: string
  fileTree: string[]                                  // all paths in the repo
  fetchFileContent: (path: string) => Promise<string> // GitHub API fetcher injected here
}

// ------------------------------------------------------------
// Main pipeline
// ------------------------------------------------------------
export async function runAnalysisPipeline(input: PipelineInput): Promise<RepoGraph> {
  const { repoUrl, repoName, fileTree, fetchFileContent } = input
  const analysisVersion = hashFileTree(fileTree)
  const analyzedAt = new Date().toISOString()

  // --- Pass 1: Structure ---
  console.log('[Pipeline] Pass 1: Structure analysis...')
  const pass1Prompt = buildPass1Prompt(repoName, formatFileTree(fileTree))
  const pass1: Pass1Output = await callModelWithSchema(pass1Prompt, Pass1OutputSchema)

  // --- Fetch file contents for Pass 2 ---
  console.log(`[Pipeline] Fetching ${pass1.relevantFiles.length} files...`)
  const fileContents = await Promise.all(
    pass1.relevantFiles.map(async (path) => ({
      path,
      content: await fetchFileContent(path),
    }))
  )
  const sampledContents = formatSampledFiles(fileContents, pass1.estimatedSize)

  // --- Pass 2: Dependencies ---
  console.log('[Pipeline] Pass 2: Dependency mapping...')
  const pass2Prompt = buildPass2Prompt(repoName, pass1.tentativeModules, sampledContents)
  const pass2: Pass2Output = await callModelWithSchema(pass2Prompt, Pass2OutputSchema)

  // --- Pass 3: Semantics ---
  console.log('[Pipeline] Pass 3: Semantic enrichment...')
  const pass3Prompt = buildPass3Prompt(repoName, pass2)
  const pass3 = await callModelWithSchema(pass3Prompt, Pass3OutputSchema)

  // --- Assemble final graph ---
  const nodes: Node[] = pass2.nodes.map((node) => ({
    ...node,
    detectedRole: pass3.nodeEnrichments[node.id]?.detectedRole ?? 'unknown',
    patterns:     pass3.nodeEnrichments[node.id]?.patterns     ?? [],
  }))

  const meta: GraphMeta = {
    repoUrl,
    repoName,
    analysisVersion,
    analyzedAt,
    ...pass3.meta,
    // If confidence < 0.6, force_directed (also enforced in Pass 3 prompt,
    // but we double-check here as a safety net)
    layoutTemplate:
      pass3.meta.patternConfidence < 0.6
        ? 'force_directed'
        : pass3.meta.layoutTemplate,
  }

  const overlay: Overlay = {
    version: 0,
    nodeOverrides: {},
    edgeOverrides: {},
    manualNodes: [],
    manualEdges: [],
  }

  const graph: RepoGraph = {
    meta,
    nodes,
    edges: pass2.edges,
    overlay,
  }

  console.log('[Pipeline] Analysis complete.', {
    nodes: nodes.length,
    edges: pass2.edges.length,
    pattern: meta.detectedPattern,
    confidence: meta.patternConfidence,
  })

  return graph
}

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------
function hashFileTree(paths: string[]): string {
  // Simple deterministic hash of the sorted file tree
  // Used to detect when re-analysis is needed
  const sorted = [...paths].sort().join('|')
  let hash = 0
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16)
}
