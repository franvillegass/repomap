import type { EstimatedSize } from '../schemas/graph'

interface SamplerConfig {
  maxLines:     number
  skeleton:     boolean
  maxFileChars: number   // hard cap per file regardless of lines
}

// Standard limits (Anthropic / large context models)
const SAMPLER_CONFIG: Record<EstimatedSize, SamplerConfig> = {
  small:  { maxLines: 300, skeleton: false, maxFileChars: 12_000 },
  medium: { maxLines: 150, skeleton: true,  maxFileChars:  6_000 },
  large:  { maxLines: 80,  skeleton: true,  maxFileChars:  3_000 },
}

// Groq free tier limits — much smaller to stay under 12k TPM
// ~1500 tokens per file max, 1 token ≈ 4 chars → ~6000 chars
// but we need room for many files so cap lower
const GROQ_SAMPLER_CONFIG: Record<EstimatedSize, SamplerConfig> = {
  small:  { maxLines: 60,  skeleton: false, maxFileChars: 2_000 },
  medium: { maxLines: 30,  skeleton: true,  maxFileChars: 1_000 },
  large:  { maxLines: 15,  skeleton: true,  maxFileChars:   500 },
}

// Max total chars for the entire sampledContents string sent to Pass 2
// Groq: ~8000 tokens available after prompt template → ~32000 chars, use 20000 to be safe
// Standard: much higher, not a concern
const MAX_TOTAL_CHARS_GROQ     = 20_000
const MAX_TOTAL_CHARS_STANDARD = 400_000

export type ProviderHint = 'groq' | 'standard'

/**
 * Reduces a file's content to fit within the token budget for Pass 2.
 * For skeleton mode: keeps imports/exports + function signatures.
 */
export function sampleFile(
  content:      string,
  size:         EstimatedSize,
  provider:     ProviderHint = 'standard'
): string {
  const config = provider === 'groq' ? GROQ_SAMPLER_CONFIG[size] : SAMPLER_CONFIG[size]
  const lines  = content.split('\n')

  let result: string

  if (!config.skeleton) {
    result = lines.slice(0, config.maxLines).join('\n')
  } else {
    const skeleton:          string[] = []
    let consecutiveBodyLines          = 0

    for (let i = 0; i < lines.length && skeleton.length < config.maxLines; i++) {
      const line    = lines[i]
      const trimmed = line.trim()

      if (
        trimmed.startsWith('import ')      ||
        trimmed.startsWith('export ')      ||
        trimmed.startsWith('from ')        ||
        trimmed.startsWith('class ')       ||
        trimmed.startsWith('abstract ')    ||
        trimmed.startsWith('interface ')   ||
        trimmed.startsWith('type ')        ||
        trimmed.startsWith('enum ')        ||
        trimmed.match(/^(public|private|protected|async|static)?\s*(function|class|const|let)\s/) ||
        trimmed.match(/^\w+\s*[:(]/)       ||
        trimmed === '}'                    ||
        trimmed === ''
      ) {
        skeleton.push(line)
        consecutiveBodyLines = 0
      } else {
        if (consecutiveBodyLines < 3) {
          skeleton.push(line)
          consecutiveBodyLines++
        } else if (consecutiveBodyLines === 3) {
          skeleton.push('  // ...')
          consecutiveBodyLines++
        }
      }
    }

    result = skeleton.join('\n')
  }

  // Hard cap per file
  if (result.length > config.maxFileChars) {
    result = result.slice(0, config.maxFileChars) + '\n  // [truncated]'
  }

  return result
}

/**
 * Formats multiple sampled files into a single string for the prompt.
 * Each file is clearly delimited.
 */
export function formatSampledFiles(
  files:    { path: string; content: string }[],
  size:     EstimatedSize,
  provider: ProviderHint = 'standard'
): string {
  const maxTotal = provider === 'groq' ? MAX_TOTAL_CHARS_GROQ : MAX_TOTAL_CHARS_STANDARD
  const parts:   string[] = []
  let total                = 0

  for (const { path, content } of files) {
    const sampled = sampleFile(content, size, provider)
    const block   = `=== FILE: ${path} ===\n${sampled}\n=== END: ${path} ===`

    if (total + block.length > maxTotal) {
      parts.push(`=== [${files.length - parts.length} more files omitted due to context limit] ===`)
      break
    }

    parts.push(block)
    total += block.length
  }

  return parts.join('\n\n')
}

/**
 * Splits sampled file contents into chunks that fit within Groq's TPM limit.
 * Used by Pass 2 chunked calls.
 * Each chunk is a subset of files formatted as a single string.
 */
export function chunkSampledFiles(
  files:        { path: string; content: string }[],
  size:         EstimatedSize,
  provider:     ProviderHint = 'standard',
  maxChunkChars: number = provider === 'groq' ? 16_000 : 300_000
): string[] {
  const chunks:  string[] = []
  let current:   string[] = []
  let currentLen           = 0

  for (const { path, content } of files) {
    const sampled = sampleFile(content, size, provider)
    const block   = `=== FILE: ${path} ===\n${sampled}\n=== END: ${path} ===\n\n`

    if (currentLen + block.length > maxChunkChars && current.length > 0) {
      chunks.push(current.join(''))
      current    = []
      currentLen = 0
    }

    current.push(block)
    currentLen += block.length
  }

  if (current.length > 0) chunks.push(current.join(''))
  return chunks
}