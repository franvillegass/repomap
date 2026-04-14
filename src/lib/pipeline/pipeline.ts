import type {
  RepoGraph,
  GraphMeta,
  Node,
  Overlay,
} from './schemas/graph'
import {
  Pass1OutputSchema,
  Pass2OutputSchema,
  Pass2NodesSchema,
  Pass2EdgesSchema,
  Pass3OutputSchema,
  type Pass1Output,
  type Pass2Output,
} from './schemas/validation'
import { buildPass1Prompt, formatFileTree } from './prompts/pass1'
import { buildPass2NodesPrompt, buildPass2EdgesPrompt } from './prompts/pass2'
import { buildPass3Prompt } from './prompts/pass3'
import { formatSampledFiles } from './sampler/fileSampler'
import { callModelWithSchema } from './aiClient'

// ------------------------------------------------------------
// Pipeline inputs
// ------------------------------------------------------------
export interface PipelineInput {
  repoUrl: string
  repoName: string
  fileTree: string[]
  fetchFileContent: (path: string) => Promise<string>
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

  // --- Pass 2a: Nodes ---
  console.log('[Pipeline] Pass 2a: Node mapping...')
  const pass2NodesPrompt = buildPass2NodesPrompt(repoName, pass1.tentativeModules, sampledContents)
  const pass2Nodes = await callModelWithSchema(pass2NodesPrompt, Pass2NodesSchema)

  // --- Pass 2b: Edges ---
  console.log('[Pipeline] Pass 2b: Edge mapping...')
  const pass2EdgesPrompt = buildPass2EdgesPrompt(repoName, pass2Nodes.nodes, sampledContents)
  const pass2Edges = await callModelWithSchema(pass2EdgesPrompt, Pass2EdgesSchema)

  const pass2: Pass2Output = {
    nodes: pass2Nodes.nodes,
    edges: pass2Edges.edges,
  }

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
  const sorted = [...paths].sort().join('|')
  let hash = 0
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16)
}