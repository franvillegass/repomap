import { streamText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGroq } from '@ai-sdk/groq'
import { NextRequest } from 'next/server'
import type { RepoGraph } from '@/lib/pipeline/schemas/graph'

export const dynamic = 'force-dynamic'

function getModel() {
  const provider = process.env.AI_PROVIDER ?? 'groq'
  const modelId  = process.env.AI_MODEL    ?? 'gpt-4o'
  if (provider === 'anthropic') return createAnthropic()(modelId)
  return createGroq()(modelId)
}

function buildSystemPrompt(graph: RepoGraph): string {
  const nodeLines = graph.nodes.map((n) => {
    const role     = n.detectedRole && n.detectedRole !== 'unknown' ? n.detectedRole : null
    const patterns = n.patterns.length > 0 ? n.patterns.join(', ') : null
    const files    = n.files.length > 0
      ? `files: ${n.files.slice(0, 5).join(', ')}${n.files.length > 5 ? ` +${n.files.length - 5}` : ''}`
      : null
    const parts = [role, patterns ? `patterns: ${patterns}` : null, files].filter(Boolean)
    return `  • [${n.type}] ${n.label}${parts.length ? ` — ${parts.join(' | ')}` : ''}`
  }).join('\n')

  const edgeLines = graph.edges.slice(0, 80).map((e) =>
    `  ${e.source} → ${e.target} [${e.edgeType}, strength ${e.strength}/5, ${e.confidence}]${e.label ? ` (${e.label})` : ''}`
  ).join('\n')
  const edgeSuffix = graph.edges.length > 80 ? `\n  ...and ${graph.edges.length - 80} more` : ''

  const overlayNotes = Object.entries(graph.overlay.nodeOverrides)
    .filter(([, ov]) => ov.annotation || ov.statusTag)
    .map(([id, ov]) => {
      const parts = []
      if (ov.statusTag)  parts.push(`status: ${ov.statusTag}`)
      if (ov.annotation) parts.push(`note: "${ov.annotation}"`)
      return `  ${id} — ${parts.join(', ')}`
    }).join('\n')

  return `You are an expert software architect with full knowledge of the "${graph.meta.repoName}" codebase.

REPOSITORY
  URL:     ${graph.meta.repoUrl}
  Pattern: ${graph.meta.detectedPattern} (confidence ${Math.round(graph.meta.patternConfidence * 100)}%)
  Analyzed: ${graph.meta.analyzedAt}

NODES
${nodeLines}

DEPENDENCIES (${graph.edges.length} total)
${edgeLines}${edgeSuffix}
${overlayNotes ? `\nUSER ANNOTATIONS\n${overlayNotes}` : ''}

INSTRUCTIONS
- Answer questions about this specific repository's architecture
- Reference node names exactly as they appear above
- Be concise and technical. Use markdown: **bold** for emphasis, \`code\` for names, ### for section headers if needed
- When relevant, suggest specific files or modules
- If something is not visible in the graph, say so clearly`
}

export async function POST(req: NextRequest) {
  try {
    const { messages, graph } = (await req.json()) as {
      messages: { role: 'user' | 'assistant'; content: string }[]
      graph:    RepoGraph
    }

    if (!graph) {
      return new Response('Missing graph context', { status: 400 })
    }
    const systemPrompt = buildSystemPrompt(graph)
    console.log('[chat] system chars:', systemPrompt.length, '| messages:', messages.length)

    const result = streamText({
      model:       getModel(),
      system:      systemPrompt, //buildSystemPrompt(graph),
      messages,
      maxTokens:   1024,
      temperature: 0.3   
    })

    return result.toDataStreamResponse()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[chat/route] error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status:  500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}