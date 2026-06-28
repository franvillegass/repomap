// src/app/api/chat/route.ts
import { NextRequest } from 'next/server'
import type { RepoGraph } from '@/lib/pipeline/schemas/graph'

export async function POST(req: NextRequest) {
  try {
    const { messages, graph, modelConfig } = (await req.json()) as {
      messages: { role: 'user' | 'assistant'; content: string }[]
      graph: RepoGraph
      modelConfig?: { provider: string }
    }

    if (!graph) {
      return new Response('Missing graph context', { status: 400 })
    }

    const provider = modelConfig?.provider || 'local'
    
    if (provider === 'local') {
      const lastMessage = messages[messages.length - 1]?.content || ''
      const response = generateLocalResponse(graph, lastMessage)
      
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: response })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
      })
    }

    return new Response(JSON.stringify({ error: 'Chat requires an AI provider. Set provider to anthropic or groq in settings.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[chat/route] error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

function generateLocalResponse(graph: RepoGraph, question: string): string {
  const q = question.toLowerCase()
  const nodeCount = graph.nodes.length
  const edgeCount = graph.edges.length
  const pattern = graph.meta.detectedPattern.replace(/_/g, ' ')
  const langs = [...new Set(graph.nodes.map(n => n.metadata.language).filter(Boolean))]

  if (q.includes('summary') || q.includes('overview') || q.includes('describe')) {
    return `This repository (${graph.meta.repoName}) has ${nodeCount} nodes and ${edgeCount} connections. 
Detected pattern: **${pattern}** (${Math.round(graph.meta.patternConfidence * 100)}% confidence).
Languages: ${langs.join(', ') || 'Unknown'}.`
  }

  if (q.includes('node') || q.includes('component') || q.includes('module')) {
    const modules = graph.nodes.filter(n => n.type === 'module').slice(0, 10)
    return `Top modules:\n${modules.map(m => `- **${m.label}** (${m.files.length} files)`).join('\n')}`
  }

  if (q.includes('pattern') || q.includes('architectur')) {
    return `Architecture: **${pattern}**\nConfidence: ${Math.round(graph.meta.patternConfidence * 100)}%\nLayout: ${graph.meta.layoutTemplate.replace(/_/g, ' ')}`
  }

  if (q.includes('dependenc') || q.includes('coupl') || q.includes('edge')) {
    const engEdges = graph.edges.filter(e => e.edgeType === 'engineering').length
    const archEdges = graph.edges.filter(e => e.edgeType === 'architecture').length
    return `Dependencies: ${edgeCount} total\n- Engineering (imports/calls): ${engEdges}\n- Architectural (structural): ${archEdges}\n- Both: ${graph.edges.filter(e => e.edgeType === 'both').length}`
  }

  return `I can answer questions about this repository's architecture. Try asking about:\n- **Summary/overview** of the codebase\n- **Modules** and components\n- **Architecture pattern** (${pattern})\n- **Dependencies** and coupling\n- Specific **nodes** or **files**`
}

export function GET() {
  return new Response(JSON.stringify({ error: 'Use POST' }), { status: 400 })
}