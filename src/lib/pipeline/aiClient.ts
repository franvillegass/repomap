import { createAnthropic } from '@ai-sdk/anthropic'
import { createGroq }      from '@ai-sdk/groq'
import { generateText }    from 'ai'
import type { ZodSchema }  from 'zod'
import type { ModelConfig } from '@/lib/modelConfig'

// ─────────────────────────────────────────────────────────────
// Model factory
// ─────────────────────────────────────────────────────────────

export function getModelFromConfig(config?: ModelConfig, pass?: string) {
  if (config?.provider === 'groq' && config.groqApiKey) {
    return createGroq({ apiKey: config.groqApiKey })('llama-3.3-70b-versatile')
  }

  if (config?.provider === 'anthropic') {
    return createAnthropic()('claude-sonnet-4-5')
  }

  // Fallback: env vars
  const provider = process.env.AI_PROVIDER ?? 'anthropic'
  const modelId  = process.env.AI_MODEL    ?? 'claude-sonnet-4-5'
  return provider === 'groq' ? createGroq()(modelId) : createAnthropic()(modelId)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')
}

// ─────────────────────────────────────────────────────────────
// Core call with retry + rate-limit handling
// ─────────────────────────────────────────────────────────────

export async function callModelWithSchema<T>(
  prompt:  string,
  schema:  ZodSchema<T>,
  options?: {
    maxRetries?:   number
    temperature?:  number
    modelConfig?:  ModelConfig
    pass?: string
  }
): Promise<T> {
  const { maxRetries = 2, temperature = 0, modelConfig, pass } = options ?? {}


  const model = getModelFromConfig(modelConfig, pass)

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[aiClient] Retry ${attempt}/${maxRetries}…`)
    }

    try {
      const result = await generateText({
        model,
        prompt:    prompt + '\n\nRespond with ONLY valid JSON. No markdown, no code blocks, no explanation.',
        temperature,
        maxTokens: 4096,
      })

      const cleaned = result.text.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

      let parsed: unknown
      try { parsed = JSON.parse(cleaned) } catch {
        console.error(`[aiClient] JSON parse failed on attempt ${attempt + 1}:`, cleaned.slice(0, 300))
        lastError = new Error(`Invalid JSON: ${cleaned.slice(0, 200)}`)
        continue
      }

      const validated = schema.safeParse(parsed)
      if (!validated.success) {
        console.error(`[aiClient] Schema validation failed:`, JSON.stringify(validated.error.issues, null, 2))
        lastError = new Error(`Schema validation failed: ${JSON.stringify(validated.error.issues)}`)
        continue
      }

      return validated.data

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[aiClient] API call failed on attempt ${attempt + 1}:`, message)
      lastError = new Error(message)

      if (isRateLimitError(error)) {
        console.log(`[aiClient] Rate limit detected — saving progress and stopping`)
        throw new RateLimitExceededError(`Rate limit exceeded. Please try again later. ${message}`)
      }
    }
  }

  throw new Error(`AI call failed after ${maxRetries + 1} attempts: ${lastError?.message}`)
}

export class RateLimitExceededError extends Error {
  constructor(message: string, public progress?: any) {
    super(message)
    this.name = 'RateLimitExceededError'
  }
}
