import { createGroq } from '@ai-sdk/groq'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import type { ZodSchema } from 'zod'

// ------------------------------------------------------------
// AI client — swap provider via env vars, no code changes needed
//
// For development (free):
//   AI_PROVIDER=groq
//   AI_MODEL=gpt-4o
//   GROQ_API_KEY=your_key
//
// For production:
//   AI_PROVIDER=anthropic
//   AI_MODEL=claude-sonnet-4-20250514
//   ANTHROPIC_API_KEY=your_key
// ------------------------------------------------------------

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

/**
 * Calls the AI model and validates the response against a Zod schema.
 * Uses generateObject() which enables structured output / JSON mode
 * automatically for both Groq and Anthropic.
 *
 * Throws a descriptive error if the model returns invalid JSON or
 * a response that doesn't match the schema.
 */
export async function callModelWithSchema<T>(
  prompt: string,
  schema: ZodSchema<T>,
  options?: {
    maxRetries?: number   // default: 2
    temperature?: number  // default: 0 (more deterministic for structured output)
  }
): Promise<T> {
  const { maxRetries = 2, temperature = 0 } = options ?? {}

  try {
    const result = await generateObject({
      model: getModel(),
      schema,
      prompt,
      temperature,
      maxRetries,
    })

    return result.object
  } catch (error) {
    // Wrap with context so pipeline errors are easy to trace
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`AI model call failed: ${message}`)
  }
}
