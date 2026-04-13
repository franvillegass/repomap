import type { EstimatedSize } from '../schemas/graph'

interface SamplerConfig {
  maxLines: number
  skeleton: boolean   // if true, only imports/exports + function signatures
}

const SAMPLER_CONFIG: Record<EstimatedSize, SamplerConfig> = {
  small:  { maxLines: 300, skeleton: false },
  medium: { maxLines: 150, skeleton: true  },
  large:  { maxLines: 80,  skeleton: true  },
}

/**
 * Reduces a file's content to fit within the token budget for Pass 2.
 * For skeleton mode: keeps imports/exports + first 3 lines of each function/class.
 */
export function sampleFile(content: string, size: EstimatedSize): string {
  const config = SAMPLER_CONFIG[size]
  const lines = content.split('\n')

  if (!config.skeleton) {
    // Small repos: just truncate to maxLines
    return lines.slice(0, config.maxLines).join('\n')
  }

  // Skeleton mode: extract structural skeleton
  const skeleton: string[] = []
  let consecutiveBodyLines = 0

  for (let i = 0; i < lines.length && skeleton.length < config.maxLines; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Always keep: imports, exports, class/interface/type declarations, function signatures
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
      trimmed.match(/^\w+\s*[:(]/)       || // method signatures
      trimmed === '}'                    || // closing braces for context
      trimmed === ''                        // blank lines for readability
    ) {
      skeleton.push(line)
      consecutiveBodyLines = 0
    } else {
      // Allow up to 3 consecutive body lines after a signature (for context)
      if (consecutiveBodyLines < 3) {
        skeleton.push(line)
        consecutiveBodyLines++
      } else if (consecutiveBodyLines === 3) {
        skeleton.push('  // ...')
        consecutiveBodyLines++
      }
      // Skip remaining body lines
    }
  }

  return skeleton.join('\n')
}

/**
 * Formats multiple sampled files into a single string for the prompt.
 * Each file is clearly delimited.
 */
export function formatSampledFiles(
  files: { path: string; content: string }[],
  size: EstimatedSize
): string {
  return files
    .map(({ path, content }) => {
      const sampled = sampleFile(content, size)
      return `=== FILE: ${path} ===\n${sampled}\n=== END: ${path} ===`
    })
    .join('\n\n')
}
