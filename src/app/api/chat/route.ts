import { streamText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGroq } from '@ai-sdk/groq'
import { NextRequest } from 'next/server'
import type { RepoGraph } from '@/lib/pipeline/schemas/graph'

// ------------------------------------------------------------
// POST /api/chat
// Body: { messages: CoreMessage[], graph: RepoGraph }
// Returns: streaming text response (Vercel AI SDK format)
// ------------------------------------------------------------

function getModel() {
  const provider = process.env.AI_PROVIDER ?? 'groq'
  const modelId  = process.env.AI_MODEL    ?? 'gpt-4o'

  if (provider === 'anthropic') {
    return createAnthropic()(modelId)
  }
  return createGroq()(modelId)
}

function buildSystemPrompt(graph: RepoGraph): string {
  const nodeLines = graph.nodes.map((n) => {
    const role     = n.detectedRole && n.detectedRole !== 'unknown' ? n.detectedRole : null
    const patterns = n.patterns.length > 0 ? n.patterns.join(', ') : null
    const files    = n.files.length > 0 ? `files: ${n.files.slice(0, 5).join(', ')}${n.files.length > 5 ? ` (+${n.files.length - 5} more)` : ''}` : null
    const parts    = [role, patterns ? `patterns: ${patterns}` : null, files].filter(Boolean)
    return `  • [${n.type}] ${n.label}${parts.length ? ` — ${parts.join(' | ')}` : ''}`
  }).join('\n')

  // Cap edges to avoid blowing up the context window
  const edgeLines = graph.edges.slice(0, 80).map((e) => {
    const label = e.label ? ` (${e.label})` : ''
    return `  ${e.source} → ${e.target} [${e.edgeType}, strength ${e.strength}/5, ${e.confidence}]${label}`
  }).join('\n')
  const edgeSuffix = graph.edges.length > 80
    ? `\n  ... and ${graph.edges.length - 80} more edges`
    : ''

  const overlayNotes = Object.entries(graph.overlay.nodeOverrides)
    .filter(([, ov]) => ov.annotation || ov.statusTag)
    .map(([id, ov]) => {
      const parts = []
      if (ov.statusTag)   parts.push(`status: ${ov.statusTag}`)
      if (ov.annotation)  parts.push(`note: "${ov.annotation}"`)
      return `  ${id} — ${parts.join(', ')}`
    }).join('\n')

  return `You are an expert software architect with full knowledge of the "${graph.meta.repoName}" codebase.

REPOSITORY OVERVIEW
  URL:              ${graph.meta.repoUrl}
  Detected pattern: ${graph.meta.detectedPattern} (confidence ${Math.round(graph.meta.patternConfidence * 100)}%)
  Analyzed at:      ${graph.meta.analyzedAt}

ARCHITECTURE NODES
${nodeLines}

DEPENDENCIES (${graph.edges.length} total)
${edgeLines}${edgeSuffix}
${overlayNotes ? `\nUSER ANNOTATIONS\n${overlayNotes}` : ''}

INSTRUCTIONS
You answer questions about this specific repository's architecture.
Reference node names exactly as they appear above.
Be concise and technical. When relevant, suggest specific files or modules.
If asked about something not visible in the graph, say so clearly rather than guessing.
Do not repeat the full node/edge list in your answers — the user can see the diagram.`
}

export async function POST(req: NextRequest) {
  try {
    const { messages, graph } = (await req.json()) as {
      messages: { role: 'user' | 'assistant'; content: string }[]
      graph: RepoGraph
    }

    if (!graph) {
      return new Response('Missing graph context', { status: 400 })
    }

    const result = streamText({
      model:       getModel(),
      system:      buildSystemPrompt(graph),
      messages,
      maxTokens:   1024,
      temperature: 0.3,
    })

    return result.toDataStreamResponse()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(`Chat error: ${message}`, { status: 500 })
  }
}