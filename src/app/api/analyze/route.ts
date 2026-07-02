import { NextRequest, NextResponse } from 'next/server'
import { parseGithubUrl, fetchFileTree, fetchFileContent } from '@/lib/github/githubClient'
import { analyzeRepository } from '@/lib/analyzer/localAnalyzer'
import { runAnalysisPipeline } from '@/lib/pipeline/pipeline'
import { RateLimitExceededError } from '@/lib/pipeline/aiClient'
import type { ModelConfig } from '@/lib/modelConfig'
import type { PipelineProgress } from '@/lib/storage/graphStore'

export async function POST(req: NextRequest) {
  try {
    const { repoUrl, githubToken, localPath, modelConfig, resumeFrom } = (await req.json()) as {
      repoUrl?:      string
      githubToken?:  string
      localPath?:    string
      modelConfig?:  ModelConfig
      resumeFrom?:   PipelineProgress
    }

    const useAI = modelConfig?.provider === 'anthropic' || modelConfig?.provider === 'groq'

    if (useAI) {
      if (!repoUrl?.trim()) {
        return NextResponse.json({ error: 'repoUrl is required for AI analysis' }, { status: 400 })
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

    } else {
      if (!repoUrl?.trim() && !localPath?.trim()) {
        return NextResponse.json({ error: 'repoUrl or localPath is required' }, { status: 400 })
      }

      if (resumeFrom && resumeFrom.repoUrl !== (repoUrl || localPath)) {
        return NextResponse.json({ error: 'Progress does not match requested repo' }, { status: 400 })
      }

      const graph = await analyzeRepository({
        repoUrl,
        localPath,
        githubToken,
        resumeFrom,
      })

      return NextResponse.json(graph)
    }
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return NextResponse.json({
        error: (error as RateLimitExceededError).message,
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
    { error: 'Use POST: { repoUrl?, localPath?, githubToken?, resumeFrom? }' },
    { status: 400 },
  )
}