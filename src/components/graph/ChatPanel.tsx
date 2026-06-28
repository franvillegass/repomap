'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { RepoGraph } from '@/lib/pipeline/schemas/graph'
import {
  loadChatSession,
  saveChatSession,
  clearChatSession,
  type PersistedMessage,
} from '@/lib/storage/chatStore'
import { loadModelConfig, modelBadge } from '../../lib/modelConfig'

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
      if (i < lines.length) i++
    } else if (line.match(/^[\s]*[-*]\s/)) {
      listBuf.push(line.replace(/^[\s]*[-*]\s/, ''))
      i++
    } else {
      flushList()
      if (line.trim() === '') {
        nodes.push(<div key={'br' + i} style={{ height: 8 }} />)
      } else {
        nodes.push(<p key={'p' + i} style={{ margin: '4px 0', lineHeight: 1.6, color: '#cbd5e1' }}>{renderInline(line)}</p>)
      }
      i++
    }
  }
  flushList()
  return <>{nodes}</>
}

function ThinkingDots() {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', color: '#64748b' }}>
      <span style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>●</span>
      <span style={{ animation: 'pulse 1.2s ease-in-out 0.2s infinite' }}>●</span>
      <span style={{ animation: 'pulse 1.2s ease-in-out 0.4s infinite' }}>●</span>
    </div>
  )
}

function ChatHeader({ graph, onClose, onClear, modelBadge: badge }: {
  graph: RepoGraph
  onClose: () => void
  onClear: () => void
  modelBadge: string
}) {
  return (
    <div style={{ borderBottom: '1px solid #1e293b', padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={aiBadge} title={badge}>
          LM
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>Local Assistant</div>
          <div style={{ fontSize: 9, color: '#64748b' }}>{graph.meta.repoName}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={onClear} style={ghostBtn} title="Clear chat">✕</button>
        <button onClick={onClose} style={ghostBtn} title="Close">✕</button>
      </div>
    </div>
  )
}

const aiBadge: React.CSSProperties = {
  width: 20, height: 20, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'linear-gradient(135deg, #3b82f6, #a78bfa)', color: '#fff', fontSize: 9, fontWeight: 700,
}

const ghostBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #1e293b', borderRadius: 4,
  padding: '4px 8px', color: '#64748b', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
}

interface ChatPanelProps {
  graph: RepoGraph
  onClose: () => void
}

function buildSuggestions(graph: RepoGraph): string[] {
  const pattern = graph.meta.detectedPattern.replace(/_/g, ' ')
  const modules = graph.nodes.filter(n => n.type === 'module').slice(0, 5).map(n => n.label)
  return [
    `Give me a summary of this repository`,
    `What is the architecture pattern? (${pattern})`,
    `List the main modules`,
    `Show me the dependencies`,
    modules.length ? `Tell me about the ${modules[0]} module` : null,
  ].filter(Boolean) as string[]
}

function ChatMessage({ message, isUser }: { message: { id: string; content: string; role: 'user' | 'assistant' }; isUser: boolean }) {
  return (
    <div style={{
      display: 'flex', gap: 8, marginBottom: 8,
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isUser ? '#3b82f6' : 'linear-gradient(135deg, #3b82f6, #a78bfa)',
        color: '#fff', fontSize: 9, fontWeight: 700,
      }}>
        {isUser ? '?' : 'LM'}
      </div>
      <div style={{
        maxWidth: '85%', padding: '8px 12px', borderRadius: 12,
        background: isUser ? 'rgba(59,130,246,0.2)' : 'rgba(30,41,59,0.8)',
        border: isUser ? '1px solid rgba(59,130,246,0.3)' : '1px solid #1e293b',
      }}>
        <MarkdownContent text={message.content} />
      </div>
    </div>
  )
}

export function ChatPanel({ graph, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<{ id: string; content: string; role: 'user' | 'assistant' }[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [initialMessagesLoaded, setInitialMessagesLoaded] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [showSugg, setShowSugg] = useState(true)
  const messagesRef = useRef(messages)

  useEffect(() => { messagesRef.current = messages }, [messages])

  useEffect(() => {
    loadChatSession(graph.meta.repoName).then((s) => {
      setMessages(s?.messages ?? [])
      setInitialMessagesLoaded(true)
    })
  }, [graph.meta.repoName])

  useEffect(() => {
    if (isLoading) return
    if (messagesRef.current.length === 0) return
    saveChatSession({
      repoName: graph.meta.repoName,
      messages: messagesRef.current.map(m => ({ id: m.id, role: m.role, content: m.content })),
      updatedAt: new Date().toISOString(),
    })
  }, [isLoading, graph.meta.repoName])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, isLoading])
  useEffect(() => { if (messages.length > 0) setShowSugg(false) }, [messages.length])

  const suggestions = useMemo(() => buildSuggestions(graph), [graph])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage = { id: Date.now().toString(), content: input.trim(), role: 'user' as const }
    setMessages(prev => [...prev, userMessage])
    const question = input.trim()
    setInput('')
    setIsLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messagesRef.current, userMessage], graph, modelConfig: { provider: 'local' } }),
      })

      if (!res.ok) throw new Error('Chat request failed')

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      let assistantContent = ''
      const decoder = new TextDecoder()
      const assistantId = (Date.now() + 1).toString()

      setMessages(prev => [...prev, { id: assistantId, content: '', role: 'assistant' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.content) {
                assistantContent += data.content
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: assistantContent } : m))
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      console.error('[chat] error:', err)
      setMessages(prev => [...prev, { id: Date.now().toString(), content: 'Error: Could not get response. Make sure the server is running.', role: 'assistant' }])
    } finally {
      setIsLoading(false)
    }
  }

  async function handleClear() {
    await clearChatSession(graph.meta.repoName)
    setMessages([])
    setShowSugg(true)
  }

  function handleSuggestion(text: string) {
    setInput(text)
    setShowSugg(false)
    setTimeout(() => inputRef.current?.form?.requestSubmit(), 30)
  }

  const modelConfig = useMemo(() => loadModelConfig(), [])

  if (!initialMessagesLoaded) {
    return (
      <div style={shellStyle}>
        <ChatHeader graph={graph} onClose={onClose} onClear={handleClear} modelBadge={modelBadge(modelConfig)} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ThinkingDots />
        </div>
      </div>
    )
  }

  return (
    <div style={shellStyle}>
      <ChatHeader graph={graph} onClose={onClose} onClear={handleClear} modelBadge={modelBadge(modelConfig)} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {showSugg && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Suggestions</div>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSuggestion(s)}
                style={{
                  textAlign: 'left', padding: '8px 10px', background: '#0f172a', border: '1px solid #1e293b',
                  borderRadius: 6, color: '#94a3b8', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#93c5fd' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.color = '#94a3b8' }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <ChatMessage key={m.id} message={m} isUser={m.role === 'user'} />
        ))}

        {isLoading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={aiBadge}><span style={{fontSize:9}}>LM</span></div>
            <div style={{ padding: '8px 12px', background: 'rgba(30,41,59,0.8)', border: '1px solid #1e293b', borderRadius: 12 }}>
              <ThinkingDots />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} style={{ padding: '12px 14px', borderTop: '1px solid #1e293b', display: 'flex', gap: 8 }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about the architecture..."
          style={{
            flex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
            padding: '8px 12px', color: '#e2e8f0', fontSize: 12, fontFamily: 'inherit', outline: 'none',
          }}
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          style={{
            background: input.trim() && !isLoading ? '#1d4ed8' : '#0f1f35',
            border: 'none', borderRadius: 6, padding: '8px 16px',
            color: input.trim() && !isLoading ? '#eff6ff' : '#1e3a5f',
            fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed',
          }}
        >
          Send
        </button>
      </form>
    </div>
  )
}

const shellStyle: React.CSSProperties = {
  width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
  background: '#080e1a', borderLeft: '1px solid #1e293b', fontFamily: '"Inter", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
}