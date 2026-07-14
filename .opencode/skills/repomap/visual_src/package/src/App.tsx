import { useEffect, useState, lazy, Suspense } from 'react'
import type { RepoGraph } from './lib/pipeline/schemas/graph'
import { GraphRenderer } from './index'
import { BranchProvider } from './branches/UseBranches'

// Lazy load heavy alternative views to reduce initial bundle
const AlternativeViews = lazy(() => import('./components/graph/AlternativeViews'))

export default function App() {
  const [graph, setGraph] = useState<RepoGraph | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/initial-graph')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => setGraph(data))
      .catch(err => setError(err.message))
  }, [])

  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: 'monospace' }}>
        <h2>Error loading graph</h2>
        <pre>{error}</pre>
      </div>
    )
  }

  if (!graph) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'monospace' }}>
        <p>Loading graph...</p>
      </div>
    )
  }

  return (
    <BranchProvider baseGraph={graph}>
      <Suspense fallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'monospace' }}>
          <p>Loading visualization...</p>
        </div>
      }>
        <GraphRenderer graph={graph} />
      </Suspense>
    </BranchProvider>
  )
}