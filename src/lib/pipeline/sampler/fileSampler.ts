import type { EstimatedSize } from '../schemas/graph'

interface SamplerConfig {
  maxLines:     number
  skeleton:     boolean
  maxFileChars: number
}

const SAMPLER_CONFIG: Record<EstimatedSize, SamplerConfig> = {
  small:  { maxLines: 300, skeleton: false, maxFileChars: 12_000 },
  medium: { maxLines: 150, skeleton: true,  maxFileChars:  6_000 },
  large:  { maxLines: 80,  skeleton: true,  maxFileChars:  3_000 },
}

const GROQ_SAMPLER_CONFIG: Record<EstimatedSize, SamplerConfig> = {
  small:  { maxLines: 60,  skeleton: false, maxFileChars: 2_000 },
  medium: { maxLines: 30,  skeleton: true,  maxFileChars: 1_000 },
  large:  { maxLines: 15,  skeleton: true,  maxFileChars:   500 },
}

const MAX_TOTAL_CHARS_GROQ     = 20_000
const MAX_TOTAL_CHARS_STANDARD = 400_000

export type ProviderHint = 'groq' | 'standard'

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

  if (result.length > config.maxFileChars) {
    result = result.slice(0, config.maxFileChars) + '\n  // [truncated]'
  }

  return result
}

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
