'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import type { RepoGraph, GraphMeta } from '@/lib/pipeline/schemas/graph'
import { saveGraph, loadGraph, listGraphs, deleteGraph } from '@/lib/storage/graphStore'
import { BranchProvider } from '@/lib/branches/useBranches'

const GraphRenderer = dynamic(
  () => import('@/components/graph/GraphRenderer'),
  { ssr: false, loading: () => <FullscreenSpinner /> },
)

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

type Status = 'idle' | 'loading' | 'error' | 'success'

interface PassStep {
  id:    number
  label: string
  desc:  string
  state: 'pending' | 'running' | 'done'
}

const PASS_STEPS: Omit<PassStep, 'state'>[] = [
  { id: 1, label: 'Pass 1 — Structure',    desc: 'Identifying relevant files and modules' },
  { id: 2, label: 'Pass 2 — Dependencies', desc: 'Mapping nodes and edges from source code' },
  { id: 3, label: 'Pass 3 — Semantics',    desc: 'Inferring roles, patterns and layout' },
]

const PASS_DURATIONS = [8000, 18000, 6000]

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

export default function Page() {
  const [url,       setUrl]       = useState('')
  const [token,     setToken]     = useState('')
  const [showToken, setShowToken] = useState(false)
  const [status,    setStatus]    = useState<Status>('idle')
  const [errorMsg,  setErrorMsg]  = useState('')
  const [graph,     setGraph]     = useState<RepoGraph | null>(null)
  const [steps,     setSteps]     = useState<PassStep[]>(
    PASS_STEPS.map((s) => ({ ...s, state: 'pending' })),
  )
  const [history, setHistory] = useState<GraphMeta[]>([])

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    listGraphs().then(setHistory).catch(() => {})
  }, [])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  async function handleLoadSaved(repoUrl: string) {
    const saved = await loadGraph(repoUrl)
    if (saved) { setGraph(saved); setStatus('success') }
  }

  async function handleDelete(repoUrl: string, e: React.MouseEvent) {
    e.stopPropagation()
    await deleteGraph(repoUrl)
    setHistory((prev) => prev.filter((m) => m.repoUrl !== repoUrl))
  }

  async function handleAnalyze() {
    const trimmed = url.trim()
    if (!trimmed) return

    setStatus('loading')
    setErrorMsg('')
    setSteps(PASS_STEPS.map((s) => ({ ...s, state: 'pending' })))

    const timer = simulateProgress(setSteps)
    const ctrl  = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ repoUrl: trimmed, githubToken: token || undefined }),
        signal:  ctrl.signal,
      })

      clearTimers(timer)

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      setSteps(PASS_STEPS.map((s) => ({ ...s, state: 'done' })))
      await sleep(400)

      const data: RepoGraph = await res.json()

      await saveGraph(data)
      const updated = await listGraphs()
      setHistory(updated)

      setGraph(data)
      setStatus('success')

    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      clearTimers(timer)
      setErrorMsg((err as Error).message)
      setStatus('error')
    }
  }

  function handleReset() {
    abortRef.current?.abort()
    setStatus('idle')
    setGraph(null)
    setErrorMsg('')
    setUrl('')
    setSteps(PASS_STEPS.map((s) => ({ ...s, state: 'pending' })))
  }

  if (status === 'success' && graph) {
    return (
      <BranchProvider baseGraph={graph}>
        <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
          <GraphRenderer graph={graph} />
          <button onClick={handleReset} style={resetButtonStyle}>
            ← new repo
          </button>
        </div>
      </BranchProvider>
    )
  }

  return (
    <div style={pageStyle}>
      <GridBackground />

      <div style={cardStyle}>
        <div style={{ marginBottom: 28, animation: 'fadeUp 0.4s ease both' }}>
          <div style={logoStyle}>
            <span style={{ color: '#3b82f6' }}>{'{'}</span>
            repo<span style={{ color: '#a78bfa' }}>map</span>
            <span style={{ color: '#3b82f6' }}>{'}'}</span>
          </div>
          <div style={subtitleStyle}>architecture diagrams from github repositories</div>
        </div>

        {status === 'idle' || status === 'error' ? (
          <InputForm
            url={url} token={token} showToken={showToken}
            onUrlChange={setUrl} onTokenChange={setToken}
            onToggleToken={() => setShowToken((v) => !v)}
            onSubmit={handleAnalyze}
            error={status === 'error' ? errorMsg : ''}
            onReset={() => setStatus('idle')}
          />
        ) : (
          <LoadingView steps={steps} onCancel={handleReset} />
        )}

        {history.length > 0 && (status === 'idle' || status === 'error') && (
          <HistoryList items={history} onLoad={handleLoadSaved} onDelete={handleDelete} />
        )}
      </div>

      <div style={footerStyle}>
        works with public repos · provide a token for private repos
      </div>
    </div>
  )
}

// (resto del archivo igual, sin cambios)

// ------------------------------------------------------------
// InputForm
// ------------------------------------------------------------

interface InputFormProps {
  url: string; token: string; showToken: boolean
  onUrlChange: (v: string) => void; onTokenChange: (v: string) => void
  onToggleToken: () => void; onSubmit: () => void
  error: string; onReset: () => void
}

function InputForm({ url, token, showToken, onUrlChange, onTokenChange, onToggleToken, onSubmit, error, onReset }: InputFormProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'fadeUp 0.4s 0.1s ease both', opacity: 0 }}>
      <div style={{ position: 'relative' }}>
        <span style={inputPrefixStyle}>github.com/</span>
        <input
          type="text" value={url} autoFocus spellCheck={false}
          placeholder="owner/repository"
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          style={{ ...inputStyle, paddingLeft: 112 }}
        />
      </div>

      <button onClick={onToggleToken} style={ghostButtonStyle}>
        <span style={{ color: showToken ? '#3b82f6' : '#475569' }}>{showToken ? '▾' : '▸'}</span>
        {' '}<span style={{ color: '#475569' }}>
          {showToken ? 'hide token' : 'add github token'}{' '}
          <span style={{ color: '#334155', fontSize: 10 }}>(private repos)</span>
        </span>
      </button>

      {showToken && (
        <input
          type="password" value={token} spellCheck={false}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          onChange={(e) => onTokenChange(e.target.value)}
          style={inputStyle}
        />
      )}

      {error && (
        <div style={errorBoxStyle}>
          <span style={{ color: '#f87171' }}>✕</span> {error}
          <button onClick={onReset} style={{ ...ghostButtonStyle, marginLeft: 8, fontSize: 10 }}>clear</button>
        </div>
      )}

      <button onClick={onSubmit} disabled={!url.trim()} style={url.trim() ? submitButtonStyle : disabledButtonStyle}>
        analyze repository <span style={{ opacity: 0.6 }}>→</span>
      </button>
    </div>
  )
}

// ------------------------------------------------------------
// LoadingView
// ------------------------------------------------------------

function LoadingView({ steps, onCancel }: { steps: PassStep[]; onCancel: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', animation: 'fadeUp 0.3s ease both' }}>
      {steps.map((step, i) => {
        const isRunning = step.state === 'running'
        const isDone    = step.state === 'done'
        const isPending = step.state === 'pending'
        return (
          <div key={step.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 14,
            padding: '13px 0', borderBottom: i < 2 ? '1px solid #0f1f35' : 'none',
            opacity: isPending ? 0.3 : 1, transition: 'opacity 0.3s ease',
          }}>
            <div style={{ width: 20, marginTop: 1, flexShrink: 0, textAlign: 'center' }}>
              {isDone    && <span style={{ color: '#34d399', fontSize: 13 }}>✓</span>}
              {isRunning && <span style={{ color: '#3b82f6', fontSize: 11, animation: 'pulse 1s ease infinite' }}>●</span>}
              {isPending && <span style={{ color: '#1e3a5f', fontSize: 11 }}>○</span>}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, color: isDone ? '#34d399' : isRunning ? '#93c5fd' : '#334155' }}>
                {step.label}
                {isRunning && <span style={{ animation: 'blink 1s step-end infinite', marginLeft: 4, color: '#3b82f6' }}>_</span>}
              </div>
              <div style={{ fontSize: 11, color: '#334155' }}>{step.desc}</div>
            </div>
          </div>
        )
      })}
      <button onClick={onCancel} style={{ ...ghostButtonStyle, marginTop: 18, textAlign: 'center', width: '100%' }}>cancel</button>
    </div>
  )
}

// ------------------------------------------------------------
// HistoryList
// ------------------------------------------------------------

interface HistoryListProps {
  items:    GraphMeta[]
  onLoad:   (url: string) => void
  onDelete: (url: string, e: React.MouseEvent) => void
}

function HistoryList({ items, onLoad, onDelete }: HistoryListProps) {
  return (
    <div style={{ marginTop: 24, animation: 'fadeUp 0.4s 0.2s ease both', opacity: 0 }}>
      <div style={{ fontSize: 9, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
        recent
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((meta) => (
          <div key={meta.repoUrl} onClick={() => onLoad(meta.repoUrl)} style={historyRowStyle}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {meta.repoName}
              </div>
              <div style={{ fontSize: 10, color: '#334155', marginTop: 1 }}>
                {meta.detectedPattern.replace(/_/g, ' ')} · {formatDate(meta.analyzedAt)}
              </div>
            </div>
            <button
              onClick={(e) => onDelete(meta.repoUrl, e)}
              style={{ ...ghostButtonStyle, color: '#334155', fontSize: 16, lineHeight: 1, padding: '2px 6px' }}
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Misc components
// ------------------------------------------------------------

function GridBackground() {
  return (
    <div aria-hidden style={{
      position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
      backgroundImage: `
        radial-gradient(circle at 20% 50%, rgba(59,130,246,0.04) 0%, transparent 50%),
        radial-gradient(circle at 80% 20%, rgba(167,139,250,0.04) 0%, transparent 40%),
        linear-gradient(rgba(30,58,95,0.18) 1px, transparent 1px),
        linear-gradient(90deg, rgba(30,58,95,0.18) 1px, transparent 1px)
      `,
      backgroundSize: 'auto, auto, 40px 40px, 40px 40px',
    }} />
  )
}

function FullscreenSpinner() {
  return (
    <div style={{ ...pageStyle, gap: 0 }}>
      <span style={{ color: '#3b82f6', fontSize: 11, animation: 'pulse 1s ease infinite' }}>loading renderer…</span>
    </div>
  )
}

// ------------------------------------------------------------
// Utils
// ------------------------------------------------------------

function simulateProgress(setSteps: React.Dispatch<React.SetStateAction<PassStep[]>>) {
  function setRunning(id: number) {
    setSteps((prev) => prev.map((s) =>
      s.id === id ? { ...s, state: 'running' } : s.id < id ? { ...s, state: 'done' } : s
    ))
  }
  setRunning(1)
  const t1 = setTimeout(() => setRunning(2), PASS_DURATIONS[0])
  const t2 = setTimeout(() => setRunning(3), PASS_DURATIONS[0] + PASS_DURATIONS[1])
  const t3 = setTimeout(() => {}, PASS_DURATIONS[0] + PASS_DURATIONS[1] + PASS_DURATIONS[2])
  return { t1, t2, t3 }
}

function clearTimers(t: { t1: ReturnType<typeof setTimeout>; t2: ReturnType<typeof setTimeout>; t3: ReturnType<typeof setTimeout> }) {
  clearTimeout(t.t1); clearTimeout(t.t2); clearTimeout(t.t3)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

// ------------------------------------------------------------
// Styles
// ------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', padding: 24,
  position: 'relative', gap: 16,
}

const cardStyle: React.CSSProperties = {
  position: 'relative', zIndex: 1, width: '100%', maxWidth: 480,
  background: 'rgba(10,22,40,0.85)', border: '1px solid #1a2744',
  borderRadius: 14, padding: '36px 32px',
  backdropFilter: 'blur(12px)', boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
}

const logoStyle: React.CSSProperties = {
  fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: '#e2e8f0',
}

const subtitleStyle: React.CSSProperties = {
  fontSize: 11, color: '#334155', marginTop: 6, letterSpacing: '0.04em',
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#06111f', border: '1px solid #1a2744',
  borderRadius: 8, padding: '11px 14px', color: '#e2e8f0',
  fontSize: 13, fontFamily: 'inherit', outline: 'none',
}

const inputPrefixStyle: React.CSSProperties = {
  position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
  fontSize: 13, color: '#334155', pointerEvents: 'none', userSelect: 'none',
}

const ghostButtonStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 11, color: '#475569', fontFamily: 'inherit', padding: 0, textAlign: 'left',
}

const submitButtonStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '13px 0', background: '#1d4ed8',
  border: 'none', borderRadius: 8, color: '#eff6ff', fontSize: 13,
  fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.03em',
}

const disabledButtonStyle: React.CSSProperties = {
  ...submitButtonStyle, background: '#0f1f35', color: '#1e3a5f', cursor: 'not-allowed',
}

const errorBoxStyle: React.CSSProperties = {
  background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)',
  borderRadius: 7, padding: '10px 12px', fontSize: 11, color: '#fca5a5',
  display: 'flex', alignItems: 'center', gap: 6,
}

const historyRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
  borderRadius: 7, cursor: 'pointer', border: '1px solid transparent',
  transition: 'background 0.12s ease',
}

const resetButtonStyle: React.CSSProperties = {
  position: 'absolute', top: 16, right: 16,
  background: 'rgba(15,23,42,0.9)', border: '1px solid #1e293b',
  borderRadius: 7, padding: '7px 14px', color: '#64748b',
  fontSize: 11, fontFamily: 'inherit', cursor: 'pointer',
  backdropFilter: 'blur(8px)', zIndex: 20,
}

const footerStyle: React.CSSProperties = {
  position: 'relative', zIndex: 1, fontSize: 10, color: '#1e3a5f', letterSpacing: '0.05em',
}