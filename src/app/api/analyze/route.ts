import { NextRequest, NextResponse } from 'next/server'
import { parseGithubUrl, fetchFileTree, fetchFileContent } from '@/lib/github/githubClient'
import { runAnalysisPipeline } from '@/lib/pipeline/pipeline'

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
  // --- Parse body ---
  let body: { repoUrl?: string; githubToken?: string }
  try {
    body = await req.json()
  } catch {
    return json400('Request body must be valid JSON.')
  }

  const { repoUrl, githubToken } = body

  if (!repoUrl || typeof repoUrl !== 'string') {
    return json400('"repoUrl" is required and must be a string.')
  }

  // --- Parse GitHub URL ---
  const parsed = parseGithubUrl(repoUrl)
  if (!parsed) {
    return json400(
      `"${repoUrl}" does not look like a valid GitHub repository URL. ` +
      'Expected format: https://github.com/owner/repo'
    )
  }

  const { owner, repo } = parsed
  console.log('[API] Token present:', !!process.env.GITHUB_TOKEN)
  console.log('[API] Token prefix:', process.env.GITHUB_TOKEN?.slice(0, 6))
  // Prefer token from request body (private repos), fall back to env var
  const token = githubToken || process.env.GITHUB_TOKEN || undefined

  try {
    // --- Fetch file tree (single GitHub API call) ---
    console.log(`[API] Fetching file tree for ${owner}/${repo}...`)
    const fileTree = await fetchFileTree(owner, repo, token)

    if (fileTree.length === 0) {
      return json400('The repository appears to be empty.')
    }

    console.log(`[API] File tree fetched: ${fileTree.length} files.`)

    // --- Run analysis pipeline ---
    const graph = await runAnalysisPipeline({
      repoUrl,
      repoName: `${owner}/${repo}`,
      fileTree,
      // fetchFileContent is injected so the pipeline stays testable
      fetchFileContent: (path) => fetchFileContent(owner, repo, path, token),
    })

    return NextResponse.json(graph, { status: 200 })

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Surface GitHub 404s and 403s with friendlier messages
    if (message.includes('Not Found') || message.includes('404')) {
      return json400(
        `Repository "${owner}/${repo}" not found. ` +
        'Check the URL and make sure your token has the correct permissions.'
      )
    }
    if (message.includes('Bad credentials') || message.includes('401')) {
      return json400('GitHub token is invalid or expired.')
    }
    if (message.includes('rate limit') || message.includes('403')) {
      return NextResponse.json(
        { error: 'GitHub API rate limit exceeded. Provide a token or wait a moment.' },
        { status: 429 }
      )
    }

    console.error('[API] Pipeline error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
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