import { Octokit } from 'octokit'

export interface ParsedRepo {
  owner: string
  repo:  string
}

export function parseGithubUrl(url: string): ParsedRepo | null {
  const match = url
    .trim()
    .match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(\/.*)?$/)

  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

export async function fetchFileTree(
  owner:   string,
  repo:    string,
  token?:  string,
  branch?: string,
): Promise<string[]> {
  const octokit = new Octokit({ auth: token })

  const ref = branch ?? await resolveDefaultBranch(octokit, owner, repo)

  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: ref,
    recursive: '1',
  })

  if (data.truncated) {
    console.warn('[GitHub] Tree response was truncated — very large repo.')
  }

  return (data.tree ?? [])
    .filter((item) => item.type === 'blob' && typeof item.path === 'string')
    .map((item) => item.path as string)
}

export async function fetchFileContent(
  owner:  string,
  repo:   string,
  path:   string,
  token?: string,
): Promise<string> {
  const octokit = new Octokit({ auth: token })

  const { data } = await octokit.rest.repos.getContent({ owner, repo, path })

  if (Array.isArray(data)) {
    throw new Error(`Path "${path}" is a directory, not a file.`)
  }
  if (data.type !== 'file') {
    throw new Error(`Path "${path}" is not a regular file (type: ${data.type}).`)
  }
  if (!('content' in data) || typeof data.content !== 'string') {
    throw new Error(`No content returned for "${path}".`)
  }

  const cleaned = data.content.replace(/\n/g, '')
  try {
    return Buffer.from(cleaned, 'base64').toString('utf-8')
  } catch {
    throw new Error(`Could not decode file content for "${path}" — may be binary.`)
  }
}

async function resolveDefaultBranch(
  octokit: Octokit,
  owner:   string,
  repo:    string,
): Promise<string> {
  const { data } = await octokit.rest.repos.get({ owner, repo })
  return data.default_branch
}
