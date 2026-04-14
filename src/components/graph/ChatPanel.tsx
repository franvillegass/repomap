'use client'

import { useChat } from 'ai/react'
import { useEffect, useRef, useState } from 'react'
import type { RepoGraph } from '@/lib/pipeline/schemas/graph'

// ------------------------------------------------------------
// Suggested starter questions based on the graph
// ------------------------------------------------------------

function buildSuggestions(graph: RepoGraph): string[] {
  const pattern  = graph.meta.detectedPattern
  const nodeNames = graph.nodes.slice(0, 3).map((n) => n.label)

  const base = [
    `What is the overall architecture of ${graph.meta.repoName}?`,
    'Which module has the most dependencies and why?',
    'Where would I add a new feature?',
    'Are there any architectural red flags in this codebase?',
  ]

  const patternSpecific: Record<string, string> = {
    clean_architecture: 'How are the domain and infrastructure layers separated?',
    hexagonal:          'What are the ports and adapters in this codebase?',
    mvc:                'How does data flow from the controller to the view?',
    microservices:      'Which services are most tightly coupled?',
    layered_monolith:   'Is the layering strictly enforced, or are there shortcuts?',
    feature_modules:    'Do feature modules share code, or are they fully isolated?',
    pipeline_etl:       'What happens if a pipeline stage fails?',
  }

  const suggestions = [...base]
  if (patternSpecific[pattern]) suggestions.splice(1, 0, patternSpecific[pattern])
  if (nodeNames.length > 0) {
    suggestions.push(`Explain what ${nodeNames[0]} does and how it connects to the rest.`)
  }

  return suggestions.slice(0, 5)
}

// ------------------------------------------------------------
// Props
// ------------------------------------------------------------

interface ChatPanelProps {
  graph:    RepoGraph
  onClose?: () => void
}

// ------------------------------------------------------------
// ChatPanel
// ------------------------------------------------------------

export function ChatPanel({ graph, onClose }: ChatPanelProps) {
  const suggestions  = buildSuggestions(graph)
  const bottomRef    = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)
  const [showSuggestions, setShowSuggestions] = useState(true)

  const { messages, input, handleInputChange, handleSubmit, isLoading, error, setInput } = useChat({
    api: '/api/chat',
    // Pass the graph as extra body — received by the route as req.json().graph
    body: { graph },
  })

  // Auto-scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // Hide suggestions once the user sends their first message
  useEffect(() => {
    if (messages.length > 0) setShowSuggestions(false)
  }, [messages.length])

  function handleSuggestionClick(text: string) {
    setInput(text)
    setShowSuggestions(false)
    // Small delay so state flushes before submit
    setTimeout(() => inputRef.current?.form?.requestSubmit(), 50)
  }

  return (
    <div
      style={{
        display:       'flex',
        flexDirection: 'column',
        height:        '100%',
        background:    '#0f172a',
        fontFamily:    '"JetBrains Mono", "Fira Mono", monospace',
        fontSize:      13,
      }}
    >
      {/* ---- Header ---- */}
      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '12px 16px',
          borderBottom:   '1px solid rgba(255,255,255,0.06)',
          flexShrink:     0,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 13 }}>
            Repo Chat
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>
            {graph.meta.repoName} · {graph.meta.detectedPattern}
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border:     'none',
              color:      '#475569',
              cursor:     'pointer',
              fontSize:   16,
              lineHeight: 1,
              padding:    4,
            }}
            title="Close chat"
          >
            ×
          </button>
        )}
      </div>

      {/* ---- Messages ---- */}
      <div
        style={{
          flex:       1,
          overflowY:  'auto',
          padding:    '12px 16px',
          display:    'flex',
          flexDirection: 'column',
          gap:        12,
        }}
      >
        {/* Empty state + suggestions */}
        {messages.length === 0 && showSuggestions && (
          <div>
            <div style={{ color: '#475569', fontSize: 11, marginBottom: 10 }}>
              Ask anything about the architecture:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSuggestionClick(s)}
                  style={{
                    background:  'rgba(255,255,255,0.04)',
                    border:      '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 6,
                    color:       '#94a3b8',
                    cursor:      'pointer',
                    fontSize:    11,
                    padding:     '7px 10px',
                    textAlign:   'left',
                    lineHeight:  1.4,
                    transition:  'background 0.15s, color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                    e.currentTarget.style.color = '#e2e8f0'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                    e.currentTarget.style.color = '#94a3b8'
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation */}
        {messages.map((m) => (
          <div key={m.id}>
            {m.role === 'user' ? (
              // User bubble
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div
                  style={{
                    background:   'rgba(99,102,241,0.2)',
                    border:       '1px solid rgba(99,102,241,0.3)',
                    borderRadius: '10px 10px 2px 10px',
                    color:        '#c7d2fe',
                    fontSize:     12,
                    lineHeight:   1.5,
                    maxWidth:     '85%',
                    padding:      '8px 12px',
                  }}
                >
                  {m.content}
                </div>
              </div>
            ) : (
              // AI bubble
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div
                  style={{
                    background:   'rgba(99,102,241,0.15)',
                    border:       '1px solid rgba(99,102,241,0.25)',
                    borderRadius: '50%',
                    color:        '#818cf8',
                    flexShrink:   0,
                    fontSize:     9,
                    fontWeight:   700,
                    height:       22,
                    lineHeight:   '22px',
                    textAlign:    'center',
                    width:        22,
                  }}
                >
                  AI
                </div>
                <div
                  style={{
                    color:      '#e2e8f0',
                    fontSize:   12,
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    wordBreak:  'break-word',
                  }}
                >
                  {m.content}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div
              style={{
                background:   'rgba(99,102,241,0.15)',
                border:       '1px solid rgba(99,102,241,0.25)',
                borderRadius: '50%',
                color:        '#818cf8',
                flexShrink:   0,
                fontSize:     9,
                fontWeight:   700,
                height:       22,
                lineHeight:   '22px',
                textAlign:    'center',
                width:        22,
              }}
            >
              AI
            </div>
            <ThinkingDots />
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              background:   'rgba(239,68,68,0.1)',
              border:       '1px solid rgba(239,68,68,0.2)',
              borderRadius: 6,
              color:        '#f87171',
              fontSize:     11,
              padding:      '6px 10px',
            }}
          >
            {error.message}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ---- Input ---- */}
      <form
        onSubmit={handleSubmit}
        style={{
          borderTop:  '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
          padding:    '10px 12px',
          display:    'flex',
          gap:        8,
        }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          placeholder="Ask about the architecture…"
          disabled={isLoading}
          style={{
            background:   'rgba(255,255,255,0.05)',
            border:       '1px solid rgba(255,255,255,0.1)',
            borderRadius: 7,
            color:        '#f1f5f9',
            flex:         1,
            fontSize:     12,
            outline:      'none',
            padding:      '8px 10px',
            fontFamily:   'inherit',
          }}
          onFocus={(e) => { e.target.style.borderColor = 'rgba(99,102,241,0.5)' }}
          onBlur={(e)  => { e.target.style.borderColor = 'rgba(255,255,255,0.1)' }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            background:   isLoading || !input.trim()
              ? 'rgba(99,102,241,0.2)'
              : 'rgba(99,102,241,0.7)',
            border:       'none',
            borderRadius: 7,
            color:        isLoading || !input.trim() ? '#4c4f69' : '#e0e7ff',
            cursor:       isLoading || !input.trim() ? 'not-allowed' : 'pointer',
            fontSize:     14,
            padding:      '0 12px',
            transition:   'background 0.15s',
          }}
          title="Send"
        >
          ↑
        </button>
      </form>
    </div>
  )
}

// ------------------------------------------------------------
// Thinking animation
// ------------------------------------------------------------

function ThinkingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 22 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width:            5,
            height:           5,
            borderRadius:     '50%',
            background:       '#475569',
            animation:        `chatPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes chatPulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40%            { opacity: 1;   transform: scale(1);   }
        }
      `}</style>
    </div>
  )
}