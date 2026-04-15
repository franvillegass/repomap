import { createAnthropic } from '@ai-sdk/anthropic'
import { createGroq } from '@ai-sdk/groq'
import { NextRequest } from 'next/server'
import type { RepoGraph } from '@/lib/pipeline/schemas/graph'
import { anthropic } from '@ai-sdk/anthropic'
import { buildSystemPrompt, getModel } from '@/lib/ai'
import { streamText } from 'ai'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'




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