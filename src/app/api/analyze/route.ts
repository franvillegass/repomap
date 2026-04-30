// src/app/api/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { parseGithubUrl, fetchFileTree, fetchFileContent } from '@/lib/github/githubClient'
import { runAnalysisPipeline } from '@/lib/pipeline/pipeline'
import type { ModelConfig } from '@/lib/modelConfig'

export async function POST(req: NextRequest) {
  try {
    const { repoUrl, githubToken, modelConfig } = (await req.json()) as {
      repoUrl:      string
      githubToken?: string
      modelConfig?: ModelConfig
    }

    if (!repoUrl?.trim()) {
      return NextResponse.json({ error: 'repoUrl is required' }, { status: 400 })
    }

    const { owner, repo } = parseGithubUrl(repoUrl)
    const repoName        = `${owner}/${repo}`
    const token           = githubToken || process.env.GITHUB_TOKEN

    const fileTree = await fetchFileTree(owner, repo, token)

    const graph = await runAnalysisPipeline({
      repoUrl,
      repoName,
      fileTree,
      fetchFileContent: (path) => fetchFileContent(owner, repo, path, token),
      modelConfig,
    })

    return NextResponse.json(graph)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[analyze/route] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export function GET() {
  return NextResponse.json(
    { error: 'Use POST: { repoUrl, githubToken?, modelConfig? }' },
    { status: 400 },
  )
}