import { NextRequest, NextResponse } from 'next/server'
import { parseGithubUrl, fetchFileTree, fetchFileContent } from '@/lib/github/githubClient'
import { runAnalysisPipeline } from '@/lib/pipeline/pipeline'
import type { RepoGraph } from '@/lib/pipeline/schemas/graph'
import { buildSystemPrompt } from '../chat/route'
import { getModel } from '../chat/route'
import { streamText } from 'ai'


// ------------------------------------------------------------
// POST /api/analyze
//
// Body (JSON):
//   repoUrl     string  — required, e.g. "https://github.com/owner/repo"
//   githubToken string  — optional, overrides GITHUB_TOKEN env var
//                         (useful for private repos; NOT persisted server-side)
//
// Response:
//   200  RepoGraph JSON
//   400  { error: string }  — bad input
//   500  { error: string }  — pipeline or GitHub API failure
// ------------------------------------------------------------

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
      system:      systemPrompt,
      messages,
      maxTokens:   1024,
      temperature: 0.3,
      maxRetries:  0,          // ← clave: sin reintentos
      onError:     (err) => console.error('[chat stream error]', err), // ← log del error real
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


// --- Only POST is supported ---
export function GET() {
  return json400('Use POST with a JSON body: { repoUrl: "https://github.com/owner/repo" }')
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function json400(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}