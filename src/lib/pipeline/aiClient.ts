import { createGroq } from '@ai-sdk/groq'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
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

export async function callModelWithSchema<T>(
  prompt: string,
  schema: ZodSchema<T>,
  options?: {
    maxRetries?: number
    temperature?: number
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
    // Log everything for debugging
    console.error('=== AI MODEL ERROR ===')
    console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error)
    console.error('Error message:', error instanceof Error ? error.message : String(error))
    
    // Log cause chain if exists
    if (error instanceof Error && error.cause) {
      console.error('Cause:', error.cause)
    }

    // Vercel AI SDK wraps the raw response in some error types
    if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>
      if (e.response) console.error('Raw response:', JSON.stringify(e.response, null, 2))
      if (e.text) console.error('Raw text:', e.text)
      if (e.value) console.error('Parsed value:', JSON.stringify(e.value, null, 2))
      if (e.errors) console.error('Zod errors:', JSON.stringify(e.errors, null, 2))
    }

    console.error('=== END AI MODEL ERROR ===')

    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`AI model call failed: ${message}`)
  }
}