import { createAnthropic } from '@ai-sdk/anthropic'
import { createGroq }      from '@ai-sdk/groq'
import type { RepoGraph }  from '@/lib/pipeline/schemas/graph'
import type { ModelConfig } from '@/lib/modelConfig'

export function getModel(config?: ModelConfig) {
  if (config?.provider === 'groq' && config.groqApiKey) {
    return createGroq({ apiKey: config.groqApiKey })('llama-3.3-70b-versatile')
  }
  if (config?.provider === 'anthropic') {
    return createAnthropic()('claude-3-5-haiku-latest')
  }
  const provider = process.env.AI_PROVIDER ?? 'anthropic'
  const modelId  = process.env.AI_MODEL    ?? 'claude-3-5-haiku-latest'
  return provider === 'groq' ? createGroq()(modelId) : createAnthropic()(modelId)
}

export function buildSystemPrompt(graph: RepoGraph): string {
  const nodeLines = graph.nodes.map((n) => {
    const role     = n.detectedRole && n.detectedRole !== 'unknown' ? n.detectedRole : null
    const patterns = n.patterns.length > 0 ? n.patterns.join(', ') : null
    const files    = n.files.length > 0
      ? `files: ${n.files.slice(0, 3).join(', ')}${n.files.length > 3 ? ` +${n.files.length - 3}` : ''}`
      : null
    const parts = [role, patterns ? `patterns: ${patterns}` : null, files].filter(Boolean)
    return `  • [${n.type}] ${n.label}${parts.length ? ` — ${parts.join(' | ')}` : ''}`
  }).join('\n')

  const edgeCap   = 60
  const edgeLines = graph.edges.slice(0, edgeCap).map((e) =>
    `  ${e.source} → ${e.target} [${e.edgeType}, s${e.strength}, ${e.confidence}]${e.label ? ` (${e.label})` : ''}`
  ).join('\n')
  const edgeSuffix = graph.edges.length > edgeCap ? `\n  …and ${graph.edges.length - edgeCap} more` : ''

  const overlayNotes = Object.entries(graph.overlay.nodeOverrides)
    .filter(([, ov]) => ov.annotation || ov.statusTag)
    .map(([id, ov]) => {
      const parts = []
      if (ov.statusTag)  parts.push(`status: ${ov.statusTag}`)
      if (ov.annotation) parts.push(`note: "${ov.annotation}"`)
      return `  ${id} — ${parts.join(', ')}`
    }).join('\n')

  return `You are an expert software architect with full knowledge of "${graph.meta.repoName}".

REPO: ${graph.meta.repoUrl} · pattern: ${graph.meta.detectedPattern} (${Math.round(graph.meta.patternConfidence * 100)}%)

NODES
${nodeLines}

DEPENDENCIES (${graph.edges.length} total)
${edgeLines}${edgeSuffix}
${overlayNotes ? `\nUSER ANNOTATIONS\n${overlayNotes}` : ''}

Answer questions about this repository. Reference node names exactly. Be concise and technical. Use markdown. If something isn't visible in the graph, say so.`
}