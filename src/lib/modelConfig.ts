// ============================================================
// RepoMap — Model Configuration
//
// Shared type that flows from the UI selection through every
// API request. Stored in sessionStorage on the client.
// ============================================================

export type ModelProvider = 'anthropic' | 'groq'

export interface ModelConfig {
  provider:    ModelProvider
  groqApiKey?: string   // only present when provider === 'groq'
}

// ── SessionStorage key ──
const STORAGE_KEY = 'repomap_model_config'

export function saveModelConfig(config: ModelConfig): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function loadModelConfig(): ModelConfig {
  if (typeof window === 'undefined') return { provider: 'anthropic' }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { provider: 'anthropic' }
    return JSON.parse(raw) as ModelConfig
  } catch {
    return { provider: 'anthropic' }
  }
}

export function clearModelConfig(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(STORAGE_KEY)
}

// ── Display helpers ──
export function modelLabel(config: ModelConfig): string {
  return config.provider === 'groq' ? 'ask llama' : 'ask claude'
}

export function modelBadge(config: ModelConfig): string {
  return config.provider === 'groq' ? 'Llama 3.3 70B · Groq' : 'Claude · Anthropic'
}