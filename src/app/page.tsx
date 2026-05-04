'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import type { RepoGraph, GraphMeta } from '@/lib/pipeline/schemas/graph'
import {
  saveGraph,
  loadGraph,
  listGraphs,
  deleteGraph,
  saveProgress,
  loadProgress,
  listProgress,
  deleteProgress,
  type PipelineProgress,
} from '@/lib/storage/graphStore'
import { BranchProvider } from '../../src/branches/UseBranches'
import {
  type ModelConfig,
  saveModelConfig,
  loadModelConfig,
} from '../../src/lib/modelConfig'

const ManualEditor = dynamic(
  () => import('@/components/graph/ManualEditor'),
  { ssr: false, loading: () => <FullscreenSpinner /> },
)

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
  const [progressList, setProgressList] = useState<PipelineProgress[]>([])

  const [manualMode, setManualMode] = useState(false)

  const [modelConfig,      setModelConfigState] = useState<ModelConfig>({ provider: 'anthropic' })
  const [showModelPicker,  setShowModelPicker]  = useState(false)
  const [groqKeyInput,     setGroqKeyInput]     = useState('')

  // Load from sessionStorage after mount
  useEffect(() => {
    const saved = loadModelConfig()
    setModelConfigState(saved)
    if (saved.provider === 'groq') setGroqKeyInput(saved.groqApiKey ?? '')
  }, [])

  function applyModelConfig(config: ModelConfig) {
    saveModelConfig(config)
    setModelConfigState(config)
    setShowModelPicker(false)
  }

  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    listGraphs().then(setHistory).catch(() => {})
    listProgress().then(setProgressList).catch(() => {})
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

  async function handleResume(repoUrl: string) {
    setUrl(repoUrl)
    setStatus('loading')
    setErrorMsg('')
    setSteps(PASS_STEPS.map((s) => ({ ...s, state: 'pending' })))

    const timer = simulateProgress(setSteps)
    const ctrl  = new AbortController()
    abortRef.current = ctrl

    try {
      const resumeFrom = await loadProgress(repoUrl)
      if (!resumeFrom) {
        throw new Error('No progress found to resume')
      }

      const res = await fetch('/api/analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ repoUrl, githubToken: token || undefined, modelConfig, resumeFrom }),
        signal:  ctrl.signal,
      })

      clearTimers(timer)

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        await handleAnalyzeErrorBody(body)
        return
      }

      setSteps(PASS_STEPS.map((s) => ({ ...s, state: 'done' })))
      await sleep(400)

      const data: RepoGraph = await res.json()

      await saveGraph(data)
      await deleteProgress(repoUrl)
      const updated = await listGraphs()
      setHistory(updated)
      const updatedProgress = await listProgress()
      setProgressList(updatedProgress)

      setGraph(data)
      setStatus('success')

    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      clearTimers(timer)
      setErrorMsg((err as Error).message)
      setStatus('error')
    }
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
        body:    JSON.stringify({ repoUrl: trimmed, githubToken: token || undefined, modelConfig }),
        signal:  ctrl.signal,
      })

      clearTimers(timer)

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        await handleAnalyzeErrorBody(body)
        return
      }

      setSteps(PASS_STEPS.map((s) => ({ ...s, state: 'done' })))
      await sleep(400)

      const data: RepoGraph = await res.json()

      await saveGraph(data)
      await deleteProgress(trimmed)
      const updated = await listGraphs()
      setHistory(updated)
      const updatedProgress = await listProgress()
      setProgressList(updatedProgress)

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

  async function handleAnalyzeErrorBody(body: any) {
    if (body?.rateLimit) {
      if (body.progress) {
        await saveProgress(body.progress)
        const updatedProgress = await listProgress()
        setProgressList(updatedProgress)
      }
      setErrorMsg('Rate limit exceeded. Progress saved. You can resume tomorrow when limits reset.')
      setStatus('error')
      return
    }

    throw new Error(body?.error ?? 'Analysis request failed')
  }

  // ── Manual mode ──
  if (manualMode) {
    return (
      <div style={{ width: '100vw', height: '100vh' }}>
        <ManualEditor
          mode="create"
          onComplete={async (g) => {
            await saveGraph(g)
            const updated = await listGraphs()
            setHistory(updated)
            setGraph(g)
            setManualMode(false)
            setStatus('success')
          }}
          onCancel={() => setManualMode(false)}
        />
      </div>
    )
  }

  if (status === 'success' && graph) {
    return (
      <BranchProvider baseGraph={graph}>
        <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
          <GraphRenderer graph={graph} />
          <button className="repo-control" onClick={handleReset} style={resetButtonStyle}>
            ← new repo
          </button>
        </div>
      </BranchProvider>
    )
  }

  return (
    <div style={pageStyle}>
      <GridBackground />

      <div className="repo-card" style={cardStyle}>
        <div style={{ marginBottom: 28, animation: 'fadeUp 0.4s ease both' }}>
          <div style={logoStyle}>
            <span style={{ color: '#3b82f6' }}>{'{'}</span>
            repo<span style={{ color: '#a78bfa' }}>map</span>
            <span style={{ color: '#3b82f6' }}>{'}'}</span>
          </div>
          <div style={subtitleStyle}>architecture diagrams from github repositories</div>
        </div>

        {status === 'idle' || status === 'error' ? (
          <>
            {/* Model selector */}
            <div style={{ marginBottom: 18, animation: 'fadeUp 0.4s 0.05s ease both', opacity: 0 }}>
              <div style={{ fontSize: 9, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                Analysis model
              </div>

              {/* Compact selector row */}
              {!showModelPicker ? (
                <button
                  className="repo-control"
                  onClick={() => setShowModelPicker(true)}
                  style={{
                    width:          '100%',
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'space-between',
                    background:     'rgba(255,255,255,0.02)',
                    border:         '1px solid #1e293b',
                    borderRadius:   7,
                    padding:        '9px 12px',
                    cursor:         'pointer',
                    fontFamily:     'inherit',
                    color:          '#475569',
                    fontSize:       11,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
                      background: modelConfig.provider === 'groq' ? '#a78bfa' : '#3b82f6',
                    }} />
                    {modelConfig.provider === 'groq'
                      ? `Llama 3.3 70B · Groq${modelConfig.groqApiKey ? ' ✓' : ' (no key)'}`
                      : 'Claude · Anthropic (premium)'}
                  </span>
                  <span style={{ fontSize: 9, color: '#1e3a5f' }}>change ›</span>
                </button>
              ) : (
                <div className="repo-picker" style={{ background: '#0a111f', border: '1px solid #1e293b', borderRadius: 8, padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

                  {/* Premium option */}
                  <button
                    className="repo-control"
                    onClick={() => applyModelConfig({ provider: 'anthropic' })}
                    style={{
                      background:   modelConfig.provider === 'anthropic' ? 'rgba(59,130,246,0.1)' : 'transparent',
                      border:       `1px solid ${modelConfig.provider === 'anthropic' ? '#1d4ed8' : '#1e293b'}`,
                      borderRadius: 7,
                      padding:      '11px 14px',
                      cursor:       'pointer',
                      fontFamily:   'inherit',
                      textAlign:    'left',
                      width:        '100%',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: modelConfig.provider === 'anthropic' ? '#93c5fd' : '#475569' }}>
                        ✦ Premium
                      </span>
                      <span style={{ fontSize: 9, color: '#1d4ed8', background: 'rgba(29,78,216,0.15)', border: '1px solid rgba(29,78,216,0.3)', borderRadius: 4, padding: '1px 6px' }}>
                        uses your subscription
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: '#334155' }}>Claude · Anthropic — best results</div>
                  </button>

                  {/* Free option */}
                  <div style={{
                    background:   modelConfig.provider === 'groq' ? 'rgba(167,139,250,0.08)' : 'transparent',
                    border:       `1px solid ${modelConfig.provider === 'groq' ? '#6d28d9' : '#1e293b'}`,
                    borderRadius: 7,
                    padding:      '11px 14px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: modelConfig.provider === 'groq' ? '#a78bfa' : '#475569' }}>
                        ⬡ Free — Groq
                      </span>
                      <span style={{ fontSize: 9, color: '#6d28d9', background: 'rgba(109,40,217,0.15)', border: '1px solid rgba(109,40,217,0.3)', borderRadius: 4, padding: '1px 6px' }}>
                        requires API key
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: '#334155', marginBottom: 8 }}>
                      Llama 3.3 70B · limited tokens/min · progress saves between sessions
                    </div>
                    <input
                      className="repo-input"
                      value={groqKeyInput}
                      onChange={(e) => setGroqKeyInput(e.target.value)}
                      placeholder="gsk_…  paste your Groq API key"
                      style={{
                        width:        '100%',
                        background:   '#050a14',
                        border:       '1px solid #1e293b',
                        borderRadius: 5,
                        padding:      '7px 10px',
                        color:        '#e2e8f0',
                        fontSize:     11,
                        fontFamily:   'inherit',
                        outline:      'none',
                        boxSizing:    'border-box',
                        marginBottom: 8,
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && groqKeyInput.trim().startsWith('gsk_')) {
                          applyModelConfig({ provider: 'groq', groqApiKey: groqKeyInput.trim() })
                        }
                      }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="repo-control"
                        onClick={() => {
                          if (groqKeyInput.trim().startsWith('gsk_')) {
                            applyModelConfig({ provider: 'groq', groqApiKey: groqKeyInput.trim() })
                          }
                        }}
                        disabled={!groqKeyInput.trim().startsWith('gsk_')}
                        style={{
                          flex:         1,
                          background:   groqKeyInput.trim().startsWith('gsk_') ? 'rgba(109,40,217,0.2)' : 'rgba(109,40,217,0.05)',
                          border:       '1px solid #3b1f6e',
                          borderRadius: 5,
                          color:        groqKeyInput.trim().startsWith('gsk_') ? '#a78bfa' : '#3b1f6e',
                          fontSize:     11,
                          padding:      '6px 0',
                          cursor:       groqKeyInput.trim().startsWith('gsk_') ? 'pointer' : 'not-allowed',
                          fontFamily:   'inherit',
                        }}
                      >
                        Use Groq
                      </button>
                      <button
                        className="repo-control"
                        onClick={() => setShowModelPicker(false)}
                        style={{
                          background: 'transparent', border: '1px solid #1e293b',
                          borderRadius: 5, color: '#334155', fontSize: 11,
                          padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    <div style={{ fontSize: 9, color: '#1e3a5f', marginTop: 6 }}>
                      Key stored in sessionStorage · sent only to this local analyzer
                    </div>
                  </div>

                </div>
              )}
            </div>

            <InputForm
              url={url} token={token} showToken={showToken}
              onUrlChange={setUrl} onTokenChange={setToken}
              onToggleToken={() => setShowToken((v) => !v)}
              onSubmit={handleAnalyze}
              error={status === 'error' ? errorMsg : ''}
              onReset={() => setStatus('idle')}
            />
          </>
        ) : (
          <LoadingView steps={steps} onCancel={handleReset} />
        )}

        {/* Manual mode option */}
        {(status === 'idle' || status === 'error') && (
          <div style={{ marginTop: 20, animation: 'fadeUp 0.4s 0.15s ease both', opacity: 0 }}>
            <div style={{
              display:    'flex',
              alignItems: 'center',
              gap:        10,
              margin:     '0 0 14px',
            }}>
              <div style={{ flex: 1, height: 1, background: '#0f1f35' }} />
              <span style={{ fontSize: 9, color: '#1e3a5f', letterSpacing: '0.08em' }}>OR</span>
              <div style={{ flex: 1, height: 1, background: '#0f1f35' }} />
            </div>
            <button
              className="repo-control"
              onClick={() => setManualMode(true)}
              style={{
                width:        '100%',
                background:   'transparent',
                border:       '1px solid #1a2744',
                borderRadius: 8,
                padding:      '13px 0',
                color:        '#334155',
                fontSize:     12,
                fontFamily:   'inherit',
                cursor:       'pointer',
                display:      'flex',
                alignItems:   'center',
                justifyContent: 'center',
                gap:          8,
                transition:   'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#2a3f6a'
                e.currentTarget.style.color       = '#475569'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#1a2744'
                e.currentTarget.style.color       = '#334155'
              }}
            >
              <span style={{ fontSize: 14 }}>⬡</span>
              create diagram manually
            </button>
            <div style={{ fontSize: 10, color: '#1e3a5f', textAlign: 'center', marginTop: 6 }}>
              no api key required · draw nodes and connections by hand
            </div>
          </div>
        )}

        {progressList.length > 0 && (status === 'idle' || status === 'error') && (
          <ProgressList items={progressList} onResume={handleResume} />
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
          className="repo-input"
          type="text" value={url} autoFocus spellCheck={false}
          placeholder="owner/repository"
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          style={{ ...inputStyle, paddingLeft: 112 }}
        />
      </div>

      <button className="repo-ghost" onClick={onToggleToken} style={ghostButtonStyle}>
        <span style={{ color: showToken ? '#3b82f6' : '#475569' }}>{showToken ? '▾' : '▸'}</span>
        {' '}<span style={{ color: '#475569' }}>
          {showToken ? 'hide token' : 'add github token'}{' '}
          <span style={{ color: '#334155', fontSize: 10 }}>(private repos)</span>
        </span>
      </button>

      {showToken && (
        <input
          className="repo-input repo-reveal"
          type="password" value={token} spellCheck={false}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          onChange={(e) => onTokenChange(e.target.value)}
          style={inputStyle}
        />
      )}

      {error && (
        <div className="repo-error" style={errorBoxStyle}>
          <span style={{ color: '#f87171' }}>✕</span> {error}
          <button className="repo-ghost" onClick={onReset} style={{ ...ghostButtonStyle, marginLeft: 8, fontSize: 10 }}>clear</button>
        </div>
      )}

      <button className="repo-submit" onClick={onSubmit} disabled={!url.trim()} style={url.trim() ? submitButtonStyle : disabledButtonStyle}>
        analyze repository <span style={{ opacity: 0.6 }}>→</span>
      </button>
    </div>
  )
}

// ------------------------------------------------------------
// LoadingView
// ------------------------------------------------------------

function LoadingView({ steps, onCancel }: { steps: PassStep[]; onCancel: () => void }) {
  const doneCount = steps.filter((step) => step.state === 'done').length
  const runningIndex = steps.findIndex((step) => step.state === 'running')
  const progress = Math.min(100, Math.max(8, ((doneCount + (runningIndex >= 0 ? 0.45 : 0)) / steps.length) * 100))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', animation: 'fadeUp 0.3s ease both' }}>
      <div style={loadingTrackStyle}>
        <div className="repo-progress-bar" style={{ ...loadingFillStyle, width: `${progress}%` }} />
      </div>
      {steps.map((step, i) => {
        const isRunning = step.state === 'running'
        const isDone    = step.state === 'done'
        const isPending = step.state === 'pending'
        return (
          <div key={step.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 14,
            padding: '13px 0', borderBottom: i < 2 ? '1px solid #0f1f35' : 'none',
            opacity: isPending ? 0.38 : 1,
            transform: isRunning ? 'translateX(3px)' : 'translateX(0)',
            transition: 'opacity 0.3s ease, transform 0.25s ease',
            animation: `stepIn 0.35s ${i * 0.08}s ease both`,
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
      <button className="repo-ghost" onClick={onCancel} style={{ ...ghostButtonStyle, marginTop: 18, textAlign: 'center', width: '100%' }}>cancel</button>
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
          <div className="repo-row" key={meta.repoUrl} onClick={() => onLoad(meta.repoUrl)} style={historyRowStyle}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {meta.repoName}
              </div>
              <div style={{ fontSize: 10, color: '#334155', marginTop: 1 }}>
                {meta.detectedPattern.replace(/_/g, ' ')} · {formatDate(meta.analyzedAt)}
              </div>
            </div>
            <button
              className="repo-ghost"
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
// ProgressList
// ------------------------------------------------------------

interface ProgressListProps {
  items:    PipelineProgress[]
  onResume: (url: string) => void
}

function ProgressList({ items, onResume }: ProgressListProps) {
  return (
    <div style={{ marginTop: 24, animation: 'fadeUp 0.4s 0.15s ease both', opacity: 0 }}>
      <div style={{ fontSize: 9, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
        in progress (rate limited)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((progress) => (
          <div className="repo-row" key={progress.repoUrl} onClick={() => onResume(progress.repoUrl)} style={historyRowStyle}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {progress.repoName}
              </div>
              <div style={{ fontSize: 10, color: '#334155', marginTop: 1 }}>
                Step {progress.lastStep}/3 · {formatDate(progress.updatedAt)}
              </div>
            </div>
            <div style={{ fontSize: 10, color: '#3b82f6', marginLeft: 8 }}>resume ›</div>
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
  fontFamily: '"Inter", "IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
}

const cardStyle: React.CSSProperties = {
  position: 'relative', zIndex: 1, width: '100%', maxWidth: 480,
  background: 'rgba(10,22,40,0.85)', border: '1px solid #1a2744',
  borderRadius: 14, padding: '36px 32px',
  backdropFilter: 'blur(12px)', boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
}

const logoStyle: React.CSSProperties = {
  fontSize: 30, fontWeight: 760, letterSpacing: '0', color: '#f1f5f9',
}

const subtitleStyle: React.CSSProperties = {
  fontSize: 12, color: '#52657d', marginTop: 6, letterSpacing: '0.02em',
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#06111f', border: '1px solid #1a2744',
  borderRadius: 8, padding: '11px 14px', color: '#e2e8f0',
  fontSize: 14, fontFamily: 'inherit', outline: 'none',
}

const inputPrefixStyle: React.CSSProperties = {
  position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
  fontSize: 14, color: '#52657d', pointerEvents: 'none', userSelect: 'none',
}

const ghostButtonStyle: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 12, color: '#64748b', fontFamily: 'inherit', padding: 0, textAlign: 'left',
}

const submitButtonStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '13px 0', background: '#1d4ed8',
  border: 'none', borderRadius: 8, color: '#eff6ff', fontSize: 14,
  fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.02em',
}

const disabledButtonStyle: React.CSSProperties = {
  ...submitButtonStyle, background: '#0f1f35', color: '#1e3a5f', cursor: 'not-allowed',
}

const errorBoxStyle: React.CSSProperties = {
  background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)',
  borderRadius: 7, padding: '10px 12px', fontSize: 12, color: '#fca5a5',
  display: 'flex', alignItems: 'center', gap: 6,
}

const historyRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
  borderRadius: 7, cursor: 'pointer', border: '1px solid transparent',
  transition: 'background 0.16s ease, border-color 0.16s ease, transform 0.16s ease',
}

const loadingTrackStyle: React.CSSProperties = {
  width: '100%',
  height: 5,
  background: '#0f1f35',
  borderRadius: 999,
  overflow: 'hidden',
  marginBottom: 12,
}

const loadingFillStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: 999,
  background: 'linear-gradient(90deg, #1d4ed8, #60a5fa, #a78bfa, #60a5fa)',
  backgroundSize: '220% 100%',
  animation: 'shimmer 1.6s linear infinite',
}

const resetButtonStyle: React.CSSProperties = {
  position: 'absolute', top: 16, right: 16,
  background: 'rgba(15,23,42,0.9)', border: '1px solid #1e293b',
  borderRadius: 7, padding: '7px 14px', color: '#94a3b8',
  fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
  backdropFilter: 'blur(8px)', zIndex: 20,
}

const footerStyle: React.CSSProperties = {
  position: 'relative', zIndex: 1, fontSize: 10, color: '#1e3a5f', letterSpacing: '0.05em',
}
