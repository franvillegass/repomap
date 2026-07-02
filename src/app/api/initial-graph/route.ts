import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'

export async function GET() {
  const graphPath = process.env.REPOMAP_GRAPH_FILE

  if (!graphPath) {
    return NextResponse.json({ error: 'No initial graph configured' }, { status: 404 })
  }

  try {
    const content = readFileSync(graphPath, 'utf-8')
    const graph = JSON.parse(content)
    return NextResponse.json(graph)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
