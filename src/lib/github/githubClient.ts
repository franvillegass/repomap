import { Octokit } from 'octokit'

// ------------------------------------------------------------
// GitHub URL parsing
// ------------------------------------------------------------

export interface ParsedRepo {
  owner: string
  repo:  string
}

/**
 * Parses a GitHub URL into owner + repo.
 * Handles:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/main/subfolder  (ignores the rest)
 *   github.com/owner/repo
 */
export function parseGithubUrl(url: string): ParsedRepo | null {
  const match = url
    .trim()
    .match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(\/.*)?$/)

  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

// ------------------------------------------------------------
// File tree — uses Git Trees API (single request, recursive)
// ------------------------------------------------------------

/**
 * Returns all blob paths in the repository.
 * Falls back gracefully if the tree is truncated (very large repos).
 *
 * @param branch  defaults to the repo's default branch via an extra API call
 */
export async function fetchFileTree(
  owner:   string,
  repo:    string,
  token?:  string,
  branch?: string,
): Promise<string[]> {
  const octokit = new Octokit({ auth: token })

  // Resolve the default branch if not provided
  const ref = branch ?? await resolveDefaultBranch(octokit, owner, repo)

  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: ref,
    recursive: '1',
  })

  if (data.truncated) {
    // Extremely large repos (>100k entries). We still return what we got —
    // Pass 1 will prioritise the relevant slice anyway.
    console.warn('[GitHub] Tree response was truncated — very large repo.')
  }

  return (data.tree ?? [])
    .filter((item) => item.type === 'blob' && typeof item.path === 'string')
    .map((item) => item.path as string)
}

// ------------------------------------------------------------
// File content — base64 → UTF-8
// ------------------------------------------------------------

/**
 * Fetches a single file's content as a UTF-8 string.
 * Throws a descriptive error for binary files or missing paths.
 */
export async function fetchFileContent(
  owner:  string,
  repo:   string,
  path:   string,
  token?: string,
): Promise<string> {
  const octokit = new Octokit({ auth: token })

  const { data } = await octokit.rest.repos.getContent({ owner, repo, path })

  // getContent can return a file, directory, symlink, or submodule
  if (Array.isArray(data)) {
    throw new Error(`Path "${path}" is a directory, not a file.`)
  }
  if (data.type !== 'file') {
    throw new Error(`Path "${path}" is not a regular file (type: ${data.type}).`)
  }
  if (!('content' in data) || typeof data.content !== 'string') {
    throw new Error(`No content returned for "${path}".`)
  }

  // GitHub returns content in base64 with newlines — clean before decoding
  const cleaned = data.content.replace(/\n/g, '')
  try {
    return Buffer.from(cleaned, 'base64').toString('utf-8')
  } catch {
    throw new Error(`Could not decode file content for "${path}" — may be binary.`)
  }
}

// ------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------

async function resolveDefaultBranch(
  octokit: Octokit,
  owner:   string,
  repo:    string,
): Promise<string> {
  const { data } = await octokit.rest.repos.get({ owner, repo })
  return data.default_branch  // typically "main" or "master"
}