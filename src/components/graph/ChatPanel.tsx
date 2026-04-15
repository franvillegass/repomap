'use client'

import { useChat }   from 'ai/react'
import { useEffect, useRef, useState, useMemo } from 'react'
import type { Message } from 'ai'
import type { RepoGraph } from '@/lib/pipeline/schemas/graph'
import {
  loadChatSession,
  saveChatSession,
  clearChatSession,
  type PersistedMessage,
} from '@/lib/storage/chatStore'

// ─────────────────────────────────────────────────────────────
// Markdown renderer
// ─────────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let rest = text
  let k    = 0
  while (rest.length > 0) {
    const bold = rest.match(/^\*\*(.+?)\*\*/)
    if (bold) {
      parts.push(<strong key={k++} style={{ color: '#e2e8f0', fontWeight: 700 }}>{bold[1]}</strong>)
      rest = rest.slice(bold[0].length); continue
    }
    const italic = rest.match(/^\*(.+?)\*/)
    if (italic) {
      parts.push(<em key={k++} style={{ color: '#cbd5e1', fontStyle: 'italic' }}>{italic[1]}</em>)
      rest = rest.slice(italic[0].length); continue
    }
    const code = rest.match(/^`([^`]+)`/)
    if (code) {
      parts.push(
        <code key={k++} style={{ background: 'rgba(125,211,252,0.1)', border: '1px solid rgba(125,211,252,0.15)', borderRadius: 3, color: '#7dd3fc', fontFamily: '"JetBrains Mono",monospace', fontSize: 10, padding: '1px 5px' }}>
          {code[1]}
        </code>
      )
      rest = rest.slice(code[0].length); continue
    }
    const next = rest.search(/\*\*|\*|`/)
    if (next === -1) { parts.push(<span key={k++}>{rest}</span>); break }
    if (next > 0) parts.push(<span key={k++}>{rest.slice(0, next)}</span>)
    rest = rest.slice(next)
  }
  return <>{parts}</>
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let listBuf: string[] = []
  let i = 0

  function flushList() {
    if (!listBuf.length) return
    nodes.push(
      <ul key={'ul' + i} style={{ margin: '4px 0', paddingLeft: 18, listStyle: 'disc' }}>
        {listBuf.map((item, j) => (
          <li key={j} style={{ marginBottom: 2, color: '#cbd5e1' }}>{renderInline(item)}</li>
        ))}
      </ul>
    )
    listBuf = []
  }

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      flushList()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++ }
      nodes.push(
        <pre key={'pre' + i} style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, color: '#7dd3fc', fontSize: 10, lineHeight: 1.6, margin: '6px 0', overflowX: 'auto', padding: '8px 10px' }}>
          <code style={{ fontFamily: '"JetBrains Mono",monospace' }}>{codeLines.join('\n')}</code>
        </pre>
      )
      i++; continue
    }
    if (line.startsWith('### ')) { flushList(); nodes.push(<div key={i} style={{ color: '#93c5fd', fontSize: 11, fontWeight: 700, margin: '8px 0 3px' }}>{renderInline(line.slice(4))}</div>); i++; continue }
    if (line.startsWith('## '))  { flushList(); nodes.push(<div key={i} style={{ color: '#bfdbfe', fontSize: 12, fontWeight: 700, margin: '10px 0 4px' }}>{renderInline(line.slice(3))}</div>); i++; continue }
    if (line.startsWith('# '))   { flushList(); nodes.push(<div key={i} style={{ color: '#e0f2fe', fontSize: 13, fontWeight: 700, margin: '10px 0 4px' }}>{renderInline(line.slice(2))}</div>); i++; continue }
    if (line.startsWith('- ') || line.startsWith('* '))  { listBuf.push(line.slice(2)); i++; continue }
    if (/^\d+\.\s/.test(line))                           { listBuf.push(line.replace(/^\d+\.\s/, '')); i++; continue }
    if (line.trim() === '') { flushList(); nodes.push(<div key={i} style={{ height: 5 }} />); i++; continue }
    flushList()
    nodes.push(<div key={i} style={{ color: '#cbd5e1', lineHeight: 1.65, marginBottom: 1 }}>{renderInline(line)}</div>)
    i++
  }
  flushList()
  return <>{nodes}</>
}

// ─────────────────────────────────────────────────────────────
// Suggestions
// ─────────────────────────────────────────────────────────────

function buildSuggestions(graph: RepoGraph): string[] {
  const extras: Record<string, string> = {
    clean_architecture: 'How are domain and infrastructure layers separated?',
    hexagonal:          'What are the ports and adapters in this codebase?',
    mvc:                'How does data flow from controller to view?',
    microservices:      'Which services are most tightly coupled?',
    layered_monolith:   'Is the layering strictly enforced?',
    feature_modules:    'Are feature modules fully isolated or do they share code?',
    pipeline_etl:       'What happens if a pipeline stage fails?',
  }
  const base = [
    'What is the overall architecture of ' + graph.meta.repoName + '?',
    'Which module has the most dependencies and why?',
    'Where would I add a new feature?',
    'Are there any architectural red flags?',
  ]
  if (extras[graph.meta.detectedPattern]) base.splice(1, 0, extras[graph.meta.detectedPattern])
  if (graph.nodes[0]) base.push('Explain what ' + graph.nodes[0].label + ' does.')
  return base.slice(0, 5)
}

// ─────────────────────────────────────────────────────────────
// ChatPanel — loads history, then mounts ChatInner
// ─────────────────────────────────────────────────────────────

interface ChatPanelProps {
  graph:    RepoGraph
  onClose?: () => void
}

export function ChatPanel({ graph, onClose }: ChatPanelProps) {
  const [initialMessages, setInitialMessages] = useState<PersistedMessage[] | null>(null)

  useEffect(() => {
    loadChatSession(graph.meta.repoName).then((s) => setInitialMessages(s?.messages ?? []))
  }, [graph.meta.repoName])

  if (initialMessages === null) {
    return (
      <div style={shellStyle}>
        <ChatHeader graph={graph} onClose={onClose} onClear={() => {}} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ThinkingDots />
        </div>
      </div>
    )
  }

  return (
    <ChatInner
      key={graph.meta.repoName}
      graph={graph}
      initialMessages={initialMessages as unknown as Message[]}
      onClose={onClose}
    />
  )
}

// ─────────────────────────────────────────────────────────────
// ChatInner
// ─────────────────────────────────────────────────────────────

function ChatInner({ graph, initialMessages, onClose }: {
  graph:           RepoGraph
  initialMessages: Message[]
  onClose?:        () => void
}) {
  const suggestions = useMemo(() => buildSuggestions(graph), [graph])
  const bottomRef   = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLInputElement>(null)
  const [showSugg, setShowSugg] = useState(initialMessages.length === 0)

  // FIX 1: body estable — nunca cambia de referencia después del mount
  const graphRef = useRef(graph)
  useEffect(() => { graphRef.current = graph }, [graph])
  const chatBody = useMemo(() => ({
  graph,
}), [graph])

  const { messages, input, handleInputChange, handleSubmit, isLoading, error, setInput, reload } = useChat({
    api:            '/api/chat',
    body:           chatBody,
    initialMessages,
    onError: (err) => console.error('[useChat error]', err), // FIX 3
  })

  // FIX 2: messages fuera de deps — se lee via ref al momento de persistir
  const messagesRef = useRef(messages)
  useEffect(() => { messagesRef.current = messages }, [messages])

  useEffect(() => {
    if (isLoading) return
    const msgs = messagesRef.current
    if (msgs.length === 0) return
    saveChatSession({
      repoName:  graph.meta.repoName,
      messages:  msgs.map((m) => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content })),
      updatedAt: new Date().toISOString(),
    })
  }, [isLoading, graph.meta.repoName]) // messages fuera

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, isLoading])
  useEffect(() => { if (messages.length > 0) setShowSugg(false) }, [messages.length])

  async function handleClear() {
    await clearChatSession(graph.meta.repoName)
    window.location.reload()
  }

  function handleSuggestion(text: string) {
    setInput(text)
    setShowSugg(false)
    setTimeout(() => inputRef.current?.form?.requestSubmit(), 30)
  }

  return (
    <div style={shellStyle}>
      <ChatHeader graph={graph} onClose={onClose} onClear={handleClear} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {showSugg && (
          <div>
            <div style={{ color: '#334155', fontSize: 10, marginBottom: 8 }}>Ask anything about this codebase:</div>
            {suggestions.map((s) => (
              <button key={s} onClick={() => handleSuggestion(s)} style={suggStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#e2e8f0' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = '#64748b' }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) => {
  const isUser = m.role === 'user'

  if (isUser) {
    return (
      <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={userBubble}>{m.content}</div>
      </div>
    )
  }

  return (
    <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={aiBadge}>AI</div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.6 }}>
        <MarkdownContent text={m.content} />
      </div>
    </div>
  )
})}

        {isLoading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={aiBadge}>AI</div>
            <ThinkingDots />
          </div>
        )}

        {error && (
          <div style={errorBox}>
            <span style={{ flex: 1 }}>Failed to get response.</span>
            <button onClick={() => reload()} style={retryBtn}>retry</button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} style={inputRow}>
        <input
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          placeholder="Ask about the architecture…"
          disabled={isLoading}
          style={inputStyle}
          onFocus={(e) => { e.target.style.borderColor = 'rgba(99,102,241,0.5)' }}
          onBlur={(e)  => { e.target.style.borderColor = 'rgba(255,255,255,0.08)' }}
        />
        <button type="submit" disabled={isLoading || !input.trim()}
          style={{ ...sendBtn, background: isLoading || !input.trim() ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.6)', color: isLoading || !input.trim() ? '#3730a3' : '#e0e7ff', cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer' }}
        >↑</button>
      </form>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────
// ChatHeader
// ─────────────────────────────────────────────────────────────

function ChatHeader({ graph, onClose, onClear }: { graph: RepoGraph; onClose?: () => void; onClear: () => void }) {
  return (
    <div style={{ alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexShrink: 0, justifyContent: 'space-between', padding: '10px 14px' }}>
      <div>
        <div style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 700 }}>Repo Chat</div>
        <div style={{ color: '#334155', fontSize: 10, marginTop: 1 }}>
          {graph.meta.repoName} · {graph.meta.detectedPattern.replace(/_/g, ' ')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={onClear} title="Clear history" style={iconBtn}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#94a3b8' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#334155' }}
        >↺</button>
        {onClose && (
          <button onClick={onClose} title="Close" style={iconBtn}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#94a3b8' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#334155' }}
          >×</button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ThinkingDots
// ─────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div style={{ alignItems: 'center', display: 'flex', gap: 4, height: 22 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ animation: 'chatDot 1.2s ease-in-out ' + (i * 0.2) + 's infinite', background: '#334155', borderRadius: '50%', height: 5, width: 5 }} />
      ))}
      <style>{`@keyframes chatDot { 0%,80%,100%{opacity:.2;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const shellStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', background: '#080e1a', fontFamily: '"JetBrains Mono","Fira Mono",monospace', fontSize: 13, overflow: 'hidden' }
const userBubble: React.CSSProperties = { background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.28)', borderRadius: '10px 10px 2px 10px', color: '#c7d2fe', fontSize: 12, lineHeight: 1.5, maxWidth: '85%', padding: '7px 11px', wordBreak: 'break-word' }
const aiBadge: React.CSSProperties = { background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '50%', color: '#818cf8', flexShrink: 0, fontSize: 8, fontWeight: 700, height: 20, lineHeight: '20px', marginTop: 2, textAlign: 'center', width: 20 }
const suggStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, color: '#64748b', cursor: 'pointer', display: 'block', fontSize: 11, fontFamily: 'inherit', lineHeight: 1.4, marginBottom: 5, padding: '7px 10px', textAlign: 'left', transition: 'background 0.12s,color 0.12s', width: '100%' }
const inputRow: React.CSSProperties = { borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexShrink: 0, gap: 7, padding: '9px 12px' }
const inputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, color: '#f1f5f9', flex: 1, fontSize: 12, fontFamily: 'inherit', outline: 'none', padding: '7px 10px', transition: 'border-color 0.15s' }
const sendBtn: React.CSSProperties = { border: 'none', borderRadius: 7, fontSize: 14, padding: '0 12px', transition: 'background 0.15s,color 0.15s' }
const errorBox: React.CSSProperties = { alignItems: 'center', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: '#f87171', display: 'flex', fontSize: 11, gap: 8, padding: '6px 10px' }
const retryBtn: React.CSSProperties = { background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, color: '#fca5a5', cursor: 'pointer', flexShrink: 0, fontSize: 10, fontFamily: 'inherit', padding: '3px 8px' }
const iconBtn: React.CSSProperties = { background: 'none', border: 'none', borderRadius: 4, color: '#334155', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '3px 5px', transition: 'color 0.15s' }