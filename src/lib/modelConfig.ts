// src/lib/modelConfig.ts

export type ModelProvider = 'anthropic' | 'groq' | 'local'

export interface ModelConfig {
  provider: ModelProvider
  groqApiKey?: string
}

const STORAGE_KEY = 'repomap_model_config'

export function saveModelConfig(config: ModelConfig): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function loadModelConfig(): ModelConfig {
  if (typeof window === 'undefined') return { provider: 'local' }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { provider: 'local' }
    return JSON.parse(raw) as ModelConfig
  } catch {
    return { provider: 'local' }
  }
}

export function clearModelConfig(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(STORAGE_KEY)
}

export function modelLabel(config: ModelConfig): string {
  return config.provider === 'groq' ? 'ask llama' : config.provider === 'anthropic' ? 'ask claude' : 'local analysis'
}

export function modelBadge(config: ModelConfig): string {
  if (config.provider === 'groq') return 'Llama 3.3 70B · Groq'
  if (config.provider === 'anthropic') return 'Claude · Anthropic'
  return 'Local Analysis (no external API)'
}