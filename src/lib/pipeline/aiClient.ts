import { createAnthropic } from '@ai-sdk/anthropic'
import { createGroq } from '@ai-sdk/groq'
import { generateText } from 'ai'
import type { ZodSchema } from 'zod'

function getModel() {
  const provider = process.env.AI_PROVIDER ?? 'groq'
  const modelId  = process.env.AI_MODEL    ?? 'openai/gpt-oss-120b'

  if (provider === 'anthropic') {
    const anthropic = createAnthropic()
    return anthropic(modelId)
  }

  const groq = createGroq()
  return groq(modelId)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function callModelWithSchema<T>(
  prompt: string,
  schema: ZodSchema<T>,
  options?: {
    maxRetries?: number
    temperature?: number
  }
): Promise<T> {
  const { maxRetries = 2, temperature = 0 } = options ?? {}

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Wait 65 seconds before retrying to reset the TPM window
    if (attempt > 0) {
      console.log(`[aiClient] Waiting 65s before retry ${attempt}/${maxRetries}...`)
      await sleep(65000)
    }

    try {
      const result = await generateText({
        model: getModel(),
        prompt: prompt + '\n\nRespond with ONLY valid JSON. No markdown, no code blocks, no explanation.',
        temperature,
        maxTokens: 16000,
      })

      const raw = result.text.trim()

      // Strip markdown code blocks if present
      const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim()

      let parsed: unknown
      try {
        parsed = JSON.parse(cleaned)
      } catch {
        console.error(`[aiClient] JSON parse failed on attempt ${attempt + 1}:`, cleaned.slice(0, 300))
        lastError = new Error(`Invalid JSON from model: ${cleaned.slice(0, 200)}`)
        continue
      }

      const validated = schema.safeParse(parsed)
      if (!validated.success) {
        console.error(`[aiClient] Schema validation failed on attempt ${attempt + 1}:`, JSON.stringify(validated.error.issues, null, 2))
        console.error('[aiClient] Full parsed value:', JSON.stringify(parsed, null, 2))
        lastError = new Error(`Schema validation failed: ${JSON.stringify(validated.error.issues)}`)
        continue
      }

      return validated.data

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[aiClient] API call failed on attempt ${attempt + 1}:`, message)
      lastError = new Error(message)
    }
  }

  throw new Error(`AI model call failed after ${maxRetries + 1} attempts: ${lastError?.message}`)
}