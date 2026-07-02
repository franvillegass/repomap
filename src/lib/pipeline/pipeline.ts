import type {
  RepoGraph,
  GraphMeta,
  Node,
  Overlay,
} from './schemas/graph'
import {
  Pass2NodesSchema,
  Pass2EdgesSchema,
  Pass3OutputSchema,
  type Pass1Output,
  type Pass2Output,
} from './schemas/validation'
import { runPass1 }                                     from './prompts/pass1'
import { buildPass2NodesPrompt, buildPass2EdgesPrompt } from './prompts/pass2'
import { buildPass3Prompt }                             from './prompts/pass3'
import { chunkSampledFiles, formatSampledFiles }        from './sampler/fileSampler'
import type { ProviderHint }                            from './sampler/fileSampler'
import { callModelWithSchema }                          from './aiClient'
import { RateLimitExceededError }                       from '@/lib/pipeline/aiClient'
import type { ModelConfig }                             from '@/lib/modelConfig'
import type { PipelineProgress }                        from '@/lib/storage/graphStore'

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
// Helpers
// ------------------------------------------------------------

function getProviderHint(modelConfig?: ModelConfig): ProviderHint {
  return modelConfig?.provider === 'groq' ? 'groq' : 'standard'
}

/**
 * Runs Pass 2a (nodes) over one or more chunks of file contents.
 * If provider is Groq, splits into chunks to stay under TPM limit.
 * Merges node arrays from all chunks.
 */
async function runPass2Nodes(
  repoName:     string,
  tentativeModules: Pass1Output['tentativeModules'],
  fileContents: { path: string; content: string }[],
  estimatedSize: Pass1Output['estimatedSize'],
  provider:     ProviderHint,
  options:      { modelConfig?: ModelConfig; partialNodes?: any[]; startAtChunk?: number }
) {
  const chunks   = chunkSampledFiles(fileContents, estimatedSize, provider)
  const allNodes: any[] = [...(options.partialNodes ?? [])]
  const startAt  = options.startAtChunk ?? 0

  console.log(`[Pipeline] Pass 2a: ${chunks.length} chunk(s), starting from chunk ${startAt + 1}`)

  for (let i = startAt; i < chunks.length; i++) {
    console.log(`[Pipeline] Pass 2a chunk ${i+1}/${chunks.length} — ${chunks[i].length} chars (~${Math.round(chunks[i].length/4)} tokens)`)
    const prompt = buildPass2NodesPrompt(repoName, tentativeModules, chunks[i])
    
    try {
      const result = await callModelWithSchema(prompt, Pass2NodesSchema, { modelConfig: options.modelConfig, pass: '2a' })
      allNodes.push(...result.nodes)
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new RateLimitExceededError(error.message, {
          pass2NodesPartial: allNodes,
          pass2NodesChunk:   i,
        })
      }
      throw error
    }
  }

  const seen = new Set<string>()
  return {
    nodes: allNodes.filter(n => {
      if (seen.has(n.id)) return false
      seen.add(n.id)
      return true
    })
  }
}

/**
 * Runs Pass 2b (edges) over one or more chunks of file contents.
 * Merges edge arrays from all chunks, deduplicating by id.
 */
async function runPass2Edges(
  repoName:      string,
  nodes:         any[],
  fileContents:  { path: string; content: string }[],
  estimatedSize: Pass1Output['estimatedSize'],
  provider:      ProviderHint,
  options:       { modelConfig?: ModelConfig; partialEdges?: any[]; startAtChunk?: number }
) {
  const chunks   = chunkSampledFiles(fileContents, estimatedSize, provider)
  const allEdges: any[] = [...(options.partialEdges ?? [])]
  const startAt  = options.startAtChunk ?? 0

  console.log(`[Pipeline] Pass 2b: ${chunks.length} chunk(s), starting from chunk ${startAt + 1}`)

  for (let i = startAt; i < chunks.length; i++) {
    if (chunks.length > 1) console.log(`[Pipeline] Pass 2b chunk ${i+1}/${chunks.length}`)
    const prompt = buildPass2EdgesPrompt(repoName, nodes, chunks[i])
    console.log(`[Pass2b chunk ${i+1}] prompt length: ${prompt.length} chars (~${Math.round(prompt.length/4)} tokens)`)

    try {
      const result = await callModelWithSchema(prompt, Pass2EdgesSchema, { modelConfig: options.modelConfig, pass: '2b' })
      allEdges.push(...result.edges)
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new RateLimitExceededError(error.message, {
          pass2EdgesPartial: allEdges,
          pass2EdgesChunk:   i,
        })
      }
      throw error
    }
  }

  const seen = new Set<string>()
  return {
    edges: allEdges.filter(e => {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })
  }
}


// ------------------------------------------------------------
// Main pipeline
// ------------------------------------------------------------
export async function runAnalysisPipeline(input: PipelineInput): Promise<RepoGraph> {
  const { repoUrl, repoName, fileTree, fetchFileContent, modelConfig, resumeFrom } = input
  const analysisVersion = hashFileTree(fileTree)
  const analyzedAt      = new Date().toISOString()
  const provider        = getProviderHint(modelConfig)

  if (resumeFrom && hashFileTree(resumeFrom.fileTree) !== analysisVersion) {
    throw new Error('Saved progress is outdated because the repository file tree changed. Start a new analysis.')
  }

  let progress: PipelineProgress = resumeFrom || {
    repoUrl,
    repoName,
    fileTree,
    lastStep:  0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  let pass1:        Pass1Output
  let fileContents: { path: string; content: string }[]
  let pass2Nodes:   any
  let pass2Edges:   any
  let pass3:        any

  // --- Pass 1: Structure ---

  if (progress.lastStep >= 1 && progress.pass1) {
    console.log('[Pipeline] Resuming from Pass 1…')
    pass1 = progress.pass1
  } else {
    console.log('[Pipeline] Pass 1: Structure analysis…')
    try {
      pass1 = await runPass1(repoName, fileTree, { modelConfig })
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new RateLimitExceededError(error.message, { ...progress, lastStep: 0 })
      }
      throw error
    }
    progress.pass1    = pass1
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

  if (progress.pass2Nodes) {
  console.log('[Pipeline] Resuming from Pass 2a…')
  pass2Nodes = progress.pass2Nodes
} else {
  try {
    pass2Nodes = await runPass2Nodes(
      repoName,
      pass1.tentativeModules,
      fileContents,
      pass1.estimatedSize,
      provider,
      {
        modelConfig,
        partialNodes: progress.pass2NodesPartial,
        startAtChunk: progress.pass2NodesChunk ?? 0,
      }
    )
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      const partial = (error as RateLimitExceededError).progress
      throw new RateLimitExceededError(error.message, {
        ...progress,
        lastStep: 1,
        pass2NodesPartial: partial?.pass2NodesPartial ?? progress.pass2NodesPartial,
        pass2NodesChunk:   partial?.pass2NodesChunk   ?? progress.pass2NodesChunk,
      })
    }
    throw error
  }
  progress.pass2Nodes = pass2Nodes
  progress.pass2NodesPartial = undefined
  progress.pass2NodesChunk   = undefined
  progress.lastStep = 2
}

  // --- Pass 2b: Edges (chunked for Groq) ---
if (progress.pass2Edges) {
  console.log('[Pipeline] Resuming from Pass 2b…')
  pass2Edges = progress.pass2Edges
} else {
  if (!pass2Nodes) throw new Error('pass2Nodes is required for Pass 2b but not available')
  try {
    pass2Edges = await runPass2Edges(
      repoName,
      pass2Nodes.nodes,
      fileContents,
      pass1.estimatedSize,
      provider,
      {
        modelConfig,
        partialEdges: progress.pass2EdgesPartial,
        startAtChunk: progress.pass2EdgesChunk ?? 0,
      }
    )
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      const partial = (error as RateLimitExceededError).progress
      throw new RateLimitExceededError(error.message, {
        ...progress,
        lastStep: 2,
        pass2EdgesPartial: partial?.pass2EdgesPartial ?? progress.pass2EdgesPartial,
        pass2EdgesChunk:   partial?.pass2EdgesChunk   ?? progress.pass2EdgesChunk,
      })
    }
    throw error
  }
  progress.pass2Edges        = pass2Edges
  progress.pass2EdgesPartial = undefined
  progress.pass2EdgesChunk   = undefined
  progress.lastStep          = 2
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
    if (!pass2Nodes || !pass2Edges) throw new Error('pass2 is required for Pass 3 but not available')
    console.log('[Pipeline] Pass 3: Semantic enrichment…')
    const pass3Prompt = buildPass3Prompt(repoName, pass2)
    try {
      pass3 = await callModelWithSchema(pass3Prompt, Pass3OutputSchema, { modelConfig, pass: '3' })
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new RateLimitExceededError(error.message, { ...progress, lastStep: 2 })
      }
      throw error
    }
    progress.pass3    = pass3
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
    provider,
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
