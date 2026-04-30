// src/app/api/chat/route.ts
import { NextRequest }    from 'next/server'
import { streamText }     from 'ai'
import type { RepoGraph } from '@/lib/pipeline/schemas/graph'
import { buildSystemPrompt, getModel } from '@/lib/ai'
import type { ModelConfig } from '@/lib/modelConfig'

export async function POST(req: NextRequest) {
  try {
    const { messages, graph, modelConfig } = (await req.json()) as {
      messages:     { role: 'user' | 'assistant'; content: string }[]
      graph:        RepoGraph
      modelConfig?: ModelConfig
    }

    if (!graph) {
      return new Response('Missing graph context', { status: 400 })
    }

    const systemPrompt = buildSystemPrompt(graph)
    console.log('[chat] system chars:', systemPrompt.length, '| provider:', modelConfig?.provider ?? 'env-default')

    const result = streamText({
      model:       getModel(modelConfig),
      system:      systemPrompt,
      messages,
      maxTokens:   1024,
      temperature: 0.3,
      maxRetries:  0,
      onError:     (err) => console.error('[chat stream error]', err),
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

export function GET() {
  return new Response(JSON.stringify({ error: 'Use POST' }), { status: 400 })
}