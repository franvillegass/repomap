import type {
  RepoGraph,
  GraphMeta,
  Node,
  Overlay,
} from './schemas/graph'
import {
  Pass1OutputSchema,
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
import type { ModelConfig } from '@/lib/modelConfig'
import type { PipelineProgress } from '@/lib/storage/graphStore'
import { RateLimitExceededError } from '@/lib/pipeline/aiClient'

// ------------------------------------------------------------
// Pipeline inputs
// ------------------------------------------------------------
export interface PipelineInput {
  repoUrl:          string
  repoName:         string
  fileTree:         string[]
  fetchFileContent: (path: string) => Promise<string>
  modelConfig?:     ModelConfig
  resumeFrom?:      PipelineProgress
}

// ------------------------------------------------------------
// Main pipeline
// ------------------------------------------------------------
export async function runAnalysisPipeline(input: PipelineInput): Promise<RepoGraph> {
  const { repoUrl, repoName, fileTree, fetchFileContent, modelConfig, resumeFrom } = input
  const analysisVersion = hashFileTree(fileTree)
  const analyzedAt      = new Date().toISOString()

  if (resumeFrom && hashFileTree(resumeFrom.fileTree) !== analysisVersion) {
    throw new Error('Saved progress is outdated because the repository file tree changed. Start a new analysis.')
  }

  let progress: PipelineProgress = resumeFrom || {
    repoUrl,
    repoName,
    fileTree,
    lastStep: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  let pass1: Pass1Output
  let fileContents: { path: string; content: string }[]
  let pass2Nodes: any
  let pass2Edges: any
  let pass3: any

  // --- Pass 1: Structure ---

  if (progress.lastStep >= 1 && progress.pass1) {
    console.log('[Pipeline] Resuming from Pass 1…')
    pass1 = progress.pass1
  } else {
    console.log('[Pipeline] Pass 1: Structure analysis…')
    const pass1Prompt = buildPass1Prompt(repoName, formatFileTree(fileTree))
    try {
      pass1 = await callModelWithSchema(
  pass1Prompt,
  Pass1OutputSchema,
  { modelConfig, pass: '1' }
)
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new RateLimitExceededError(error.message, { ...progress, lastStep: 0 })
      }
      throw error
    }
    progress.pass1 = pass1
    progress.lastStep = 1
  }

  // --- Fetch file contents ---
  if (progress.fileContents) {
    console.log('[Pipeline] Using cached file contents…')
    fileContents = progress.fileContents
  } else {
    console.log(`[Pipeline] Fetching ${pass1.relevantFiles.length} files…`)
    fileContents = await Promise.all(
      pass1.relevantFiles.map(async (path) => ({
        path,
        content: await fetchFileContent(path),
      }))
    )
    progress.fileContents = fileContents
  }
  const sampledContents = formatSampledFiles(fileContents, pass1.estimatedSize)

  // --- Pass 2a: Nodes ---
  if (progress.pass2Nodes) {
    console.log('[Pipeline] Resuming from Pass 2a…')
    pass2Nodes = progress.pass2Nodes
  } else {
    console.log('[Pipeline] Pass 2a: Node mapping…')
    const pass2NodesPrompt = buildPass2NodesPrompt(repoName, pass1.tentativeModules, sampledContents)
    try {
      pass2Nodes = await callModelWithSchema(
  pass2NodesPrompt,
  Pass2NodesSchema,
  { modelConfig, pass: '2' }
)
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new RateLimitExceededError(error.message, { ...progress, lastStep: 1 })
      }
      throw error
    }
    progress.pass2Nodes = pass2Nodes
    progress.lastStep = 2
  }

  // --- Pass 2b: Edges ---
  if (progress.pass2Edges) {
    console.log('[Pipeline] Resuming from Pass 2b…')
    pass2Edges = progress.pass2Edges
  } else {
    if (!pass2Nodes) {
      throw new Error('pass2Nodes is required for Pass 2b but not available')
    }
    console.log('[Pipeline] Pass 2b: Edge mapping…')
    const pass2EdgesPrompt = buildPass2EdgesPrompt(repoName, pass2Nodes.nodes, sampledContents)
    try {
      pass2Edges = await callModelWithSchema(
  pass2EdgesPrompt,
  Pass2EdgesSchema,
  { modelConfig, pass: '2' }
)
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new RateLimitExceededError(error.message, { ...progress, lastStep: 2 })
      }
      throw error
    }
    progress.pass2Edges = pass2Edges
    progress.lastStep = 2
  }

  const pass2: Pass2Output = {
    nodes: pass2Nodes.nodes,
    edges: pass2Edges.edges,
  }

  // --- Pass 3: Semantics ---
  if (progress.pass3) {
    console.log('[Pipeline] Resuming from Pass 3…')
    pass3 = progress.pass3
  } else {
    if (!pass2Nodes || !pass2Edges) {
      throw new Error('pass2 is required for Pass 3 but not available')
    }
    console.log('[Pipeline] Pass 3: Semantic enrichment…')
    const pass3Prompt = buildPass3Prompt(repoName, pass2)
    try {
      pass3 = await callModelWithSchema(
  pass3Prompt,
  Pass3OutputSchema,
  { modelConfig, pass: '3' }
)
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new RateLimitExceededError(error.message, { ...progress, lastStep: 2 })
      }
      throw error
    }
    progress.pass3 = pass3

    progress.lastStep = 3
  }

  // --- Final validation ---
  if (!pass2Nodes || !pass2Edges || !pass3) {
    throw new Error(`Incomplete pipeline state: pass2Nodes=${!!pass2Nodes}, pass2Edges=${!!pass2Edges}, pass3=${!!pass3}`)
  }

  // --- Assemble final graph ---
  const nodes: Node[] = pass2.nodes.map((node) => ({
    ...node,
    detectedRole: pass3?.nodeEnrichments?.[node.id]?.detectedRole ?? 'unknown',
    patterns:     pass3?.nodeEnrichments?.[node.id]?.patterns     ?? [],
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
    version:       0,
    nodeOverrides: {},
    edgeOverrides: {},
    manualNodes:   [],
    manualEdges:   [],
  }

  const graph: RepoGraph = { meta, nodes, edges: pass2.edges, overlay }

  console.log('[Pipeline] Analysis complete.', {
    nodes:      nodes.length,
    edges:      pass2.edges.length,
    pattern:    meta.detectedPattern,
    confidence: meta.patternConfidence,
    provider:   modelConfig?.provider ?? 'env-default',
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
