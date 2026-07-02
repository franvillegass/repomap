import type { ZodSchema }   from 'zod'
import { Pass1OutputSchema } from '@/lib/pipeline/schemas/validation'
import type { Pass1Output }  from '@/lib/pipeline/schemas/validation'
import { callModelWithSchema } from '@/lib/pipeline/aiClient'
import type { ModelConfig }    from '@/lib/modelConfig'

export function buildPass1Prompt(repoName: string, fileTree: string): string {
  return `Analyze a repository's file tree to identify architecture.

REPO: ${repoName}

FILE TREE:
${fileTree}

Tasks:
1. Identify architecturally relevant files (exclude: tests, build, lockfiles, assets, generated, *.min.*, dist/, __pycache__, *.pyc, .eslintrc, .prettierrc, etc)
2. Group relevant files into logical modules (each with single responsibility)
3. List all programming languages detected
4. Estimate repo size: "small" (<20 files), "medium" (20-80), "large" (>80 relevant files)

Return JSON with these exact fields:
{
  "relevantFiles": ["path/file.py"],
  "ignoredReasons": {"path/ignored.pyc": "Python bytecode"},
  "tentativeModules": [
    {
      "id": "module__auth",
      "label": "Auth",
      "filePaths": ["path/auth.py"],
      "description": "User login and session management"
    }
  ],
  "detectedLanguages": ["Python"],
  "estimatedSize": "medium"
}

IMPORTANT: Module IDs must start with "module__". ignoredReasons is an object, not array.`
}

function buildPass1ChunkPrompt(repoName: string, fileTree: string, chunkIndex: number, totalChunks: number): string {
  return `You are analyzing PART ${chunkIndex + 1} of ${totalChunks} of a large repository's file tree.

REPOSITORY: ${repoName}
FILE TREE (chunk ${chunkIndex + 1}/${totalChunks}):
${fileTree}

Your tasks for THIS CHUNK ONLY:

1. Identify which files in this chunk are architecturally relevant. Exclude: tests, build artifacts, generated files, lockfiles, assets, config files (e.g. .eslintrc, package-lock.json, *.min.js, dist/, .next/, __pycache__, *.pyc).

2. Group relevant files from this chunk into logical modules.

3. List programming languages detected in this chunk.

Respond with ONLY a JSON object with this EXACT structure:

{
  "relevantFiles": ["path/to/file.py"],
  "ignoredReasons": {
    "path/to/ignored.pyc": "Python bytecode"
  },
  "tentativeModules": [
    {
      "id": "module__authentication",
      "label": "Authentication",
      "filePaths": ["path/to/auth.py"],
      "description": "Handles user login and session management"
    }
  ],
  "detectedLanguages": ["Python"],
  "estimatedSize": "small"
}

IMPORTANT:
- estimatedSize refers to this chunk only — use "small", "medium", or "large"
- Module ids must start with "module__"
- ignoredReasons must be an object, NOT an array`
}

export function formatFileTree(paths: string[]): string {
  return paths.sort().join('\n')
}

const MAX_FILETREE_CHARS = 6_000

function splitIntoChunks(paths: string[], maxChars: number): string[][] {
  const chunks: string[][] = []
  let current: string[]    = []
  let currentLen           = 0

  for (const p of paths) {
    const lineLen = p.length + 1
    if (currentLen + lineLen > maxChars && current.length > 0) {
      chunks.push(current)
      current    = []
      currentLen = 0
    }
    current.push(p)
    currentLen += lineLen
  }

  if (current.length > 0) chunks.push(current)
  return chunks
}

function mergePass1Results(results: Pass1Output[]): Pass1Output {
  const relevantFiles  = [...new Set(results.flatMap(r => r.relevantFiles))]
  const ignoredReasons = Object.assign({}, ...results.map(r => r.ignoredReasons))
  const detectedLanguages = [...new Set(results.flatMap(r => r.detectedLanguages))]

  const moduleMap = new Map<string, Pass1Output['tentativeModules'][number]>()
  for (const result of results) {
    for (const mod of result.tentativeModules) {
      if (moduleMap.has(mod.id)) {
        const existing = moduleMap.get(mod.id)!
        existing.filePaths = [...new Set([...existing.filePaths, ...mod.filePaths])]
      } else {
        moduleMap.set(mod.id, { ...mod })
      }
    }
  }
  const tentativeModules = [...moduleMap.values()]

  const total         = relevantFiles.length
  const estimatedSize = total < 20 ? 'small' : total < 80 ? 'medium' : 'large'

  return { relevantFiles, ignoredReasons, tentativeModules, detectedLanguages, estimatedSize }
}

export async function runPass1(
  repoName:    string,
  filePaths:   string[],
  options?: {
    modelConfig?: ModelConfig
    maxRetries?:  number
  }
): Promise<Pass1Output> {
  const sorted   = [...filePaths].sort()
  const treeText = formatFileTree(sorted)

  if (treeText.length <= MAX_FILETREE_CHARS) {
    console.log('[Pass1] File tree fits in one call — single pass')
    const prompt = buildPass1Prompt(repoName, treeText)
    return callModelWithSchema(prompt, Pass1OutputSchema as ZodSchema<Pass1Output>, options)
  }

  const chunks = splitIntoChunks(sorted, MAX_FILETREE_CHARS)
  console.log(`[Pass1] File tree too large (${treeText.length} chars) — splitting into ${chunks.length} chunks`)

  const results: Pass1Output[] = []

  for (let i = 0; i < chunks.length; i++) {
    console.log(`[Pass1] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} files)`)
    const chunkTree = chunks[i].join('\n')
    const prompt    = buildPass1ChunkPrompt(repoName, chunkTree, i, chunks.length)
    const result    = await callModelWithSchema(prompt, Pass1OutputSchema as ZodSchema<Pass1Output>, options)
    results.push(result)
  }

  const merged = mergePass1Results(results)
  console.log(`[Pass1] Merged ${chunks.length} chunks → ${merged.relevantFiles.length} relevant files, ${merged.tentativeModules.length} modules`)
  return merged
}
