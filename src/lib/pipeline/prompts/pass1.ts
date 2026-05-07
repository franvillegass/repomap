import type { ZodSchema }   from 'zod'
import { Pass1OutputSchema } from '@/lib/pipeline/schemas/validation'
import type { Pass1Output }  from '@/lib/pipeline/schemas/validation'
import { callModelWithSchema } from '@/lib/pipeline/aiClient'
import type { ModelConfig }    from '@/lib/modelConfig'

// ─────────────────────────────────────────────────────────────
// Prompt builders
// ─────────────────────────────────────────────────────────────

export function buildPass1Prompt(repoName: string, fileTree: string): string {
  return `You are analyzing the file tree of a software repository to identify its architectural structure.

REPOSITORY: ${repoName}
FILE TREE:
${fileTree}

Your tasks:

1. Identify which files are architecturally relevant. Exclude: tests, build artifacts, generated files, lockfiles, assets, and configuration files that don't reveal architecture (e.g. .eslintrc, .prettierrc, package-lock.json, *.min.js, dist/, .next/, __pycache__, *.pyc).

2. Group relevant files into logical modules. A module is a cohesive set of files with a single architectural responsibility.

3. List all programming languages detected.

4. Estimate repository size based on relevant file count:
   - small: under 20 relevant files
   - medium: 20–80 relevant files
   - large: over 80 relevant files

Respond with ONLY a JSON object with this EXACT structure — no other fields, no renaming:

{
  "relevantFiles": ["path/to/file.py", "path/to/other.py"],
  "ignoredReasons": {
    "path/to/ignored.pyc": "Python bytecode",
    "path/to/lockfile": "lockfile"
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
- Use exactly these field names: relevantFiles, ignoredReasons, tentativeModules, detectedLanguages, estimatedSize
- tentativeModules items must have: id (starting with "module__"), label, filePaths, description
- ignoredReasons must be an object (key = file path, value = reason string), NOT an array
- estimatedSize must be exactly "small", "medium", or "large"`
}

// Chunk variant — usado cuando el file tree es demasiado grande
// Le dice al modelo que es una parte de un análisis mayor
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

// ─────────────────────────────────────────────────────────────
// Chunk size estimation
// ─────────────────────────────────────────────────────────────

// Groq free tier context: ~8k tokens. 1 token ≈ 4 chars.
// We leave room for the prompt template (~800 tokens) and response (~1500 tokens).
// So max file tree chars ≈ (8000 - 2300) * 4 = ~22000 chars.
// We use 18000 to be safe.
const MAX_FILETREE_CHARS = 6_000

function splitIntoChunks(paths: string[], maxChars: number): string[][] {
  const chunks: string[][] = []
  let current: string[]    = []
  let currentLen           = 0

  for (const p of paths) {
    const lineLen = p.length + 1 // +1 for newline
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

// ─────────────────────────────────────────────────────────────
// Merge multiple Pass1 chunk results into one
// ─────────────────────────────────────────────────────────────

function mergePass1Results(results: Pass1Output[]): Pass1Output {
  const relevantFiles  = [...new Set(results.flatMap(r => r.relevantFiles))]
  const ignoredReasons = Object.assign({}, ...results.map(r => r.ignoredReasons))
  const detectedLanguages = [...new Set(results.flatMap(r => r.detectedLanguages))]

  // Merge modules — if same id appears in multiple chunks, merge their filePaths
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

  // Estimate total size from merged relevant files
  const total         = relevantFiles.length
  const estimatedSize = total < 20 ? 'small' : total < 80 ? 'medium' : 'large'

  return { relevantFiles, ignoredReasons, tentativeModules, detectedLanguages, estimatedSize }
}

// ─────────────────────────────────────────────────────────────
// Main export — drop-in replacement for callModelWithSchema on Pass 1
// Automatically chunks if the file tree is too large
// ─────────────────────────────────────────────────────────────

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

  // If it fits in one call, use the standard prompt
  if (treeText.length <= MAX_FILETREE_CHARS) {
    console.log('[Pass1] File tree fits in one call — single pass')
    const prompt = buildPass1Prompt(repoName, treeText)
    return callModelWithSchema(prompt, Pass1OutputSchema as ZodSchema<Pass1Output>, options)
  }

  // Otherwise chunk it
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