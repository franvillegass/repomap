// src/app/api/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { parseGithubUrl, fetchFileTree, fetchFileContent } from '@/lib/github/githubClient'
import { runAnalysisPipeline } from '@/lib/pipeline/pipeline'
import { RateLimitExceededError } from '@/lib/pipeline/aiClient'
import type { ModelConfig } from '@/lib/modelConfig'
import type { PipelineProgress } from '@/lib/storage/graphStore'

export async function POST(req: NextRequest) {
  try {
    const { repoUrl, githubToken, modelConfig, resumeFrom } = (await req.json()) as {
      repoUrl:      string
      githubToken?: string
      modelConfig?: ModelConfig
      resumeFrom?:  PipelineProgress
    }

    if (!repoUrl?.trim()) {
      return NextResponse.json({ error: 'repoUrl is required' }, { status: 400 })
    }

    const parsed = parseGithubUrl(repoUrl)
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid GitHub URL format' }, { status: 400 })
    }
    const { owner, repo } = parsed
    const repoName        = `${owner}/${repo}`
    const token           = githubToken || process.env.GITHUB_TOKEN

    const fileTree = await fetchFileTree(owner, repo, token)

    if (resumeFrom && resumeFrom.repoUrl !== repoUrl) {
      return NextResponse.json({ error: 'Progress does not match requested repoUrl' }, { status: 400 })
    }

    const graph = await runAnalysisPipeline({
      repoUrl,
      repoName,
      fileTree,
      fetchFileContent: (path) => fetchFileContent(owner, repo, path, token),
      modelConfig,
      resumeFrom,
    })
    

    return NextResponse.json(graph)
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return NextResponse.json({ 
        error: error.message,
        rateLimit: true,
        canResume: true,
        progress: (error as RateLimitExceededError).progress
      }, { status: 429 })
    }
    const message = error instanceof Error ? error.message : String(error)
    console.error('[analyze/route] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export function GET() {
  return NextResponse.json(
    { error: 'Use POST: { repoUrl, githubToken?, modelConfig?, resumeFrom? }' },
    { status: 400 },
  )
}
