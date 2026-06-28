// src/app/api/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { parseGithubUrl, fetchFileTree, fetchFileContent } from '@/lib/github/githubClient'
import { analyzeRepository } from '@/lib/analyzer/localAnalyzer'
import type { PipelineProgress } from '@/lib/storage/graphStore'

export async function POST(req: NextRequest) {
  try {
    const { repoUrl, githubToken, localPath, resumeFrom } = (await req.json()) as {
      repoUrl?: string
      githubToken?: string
      localPath?: string
      resumeFrom?: PipelineProgress
    }

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
  } catch (error) {
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