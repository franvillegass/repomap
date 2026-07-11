import { analyzeRepository } from './analyzer.js'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Converts a RawAnalysis into a minimal RepoGraph consumable by the visualizer.
 * Node roles/patterns/layout are left as defaults; the caller should enrich via LLM.
 */
function rawToMinimalGraph(raw) {
  const nodes = raw.nodes.map(n => ({
    ...n,
    detectedRole: 'unknown',
    patterns: [],
  }))
  const graph = {
    meta: {
      ...raw.meta,
      detectedPattern: 'unknown',
      layoutTemplate: 'force_directed',
      patternConfidence: 0.3,
    },
    nodes,
    edges: raw.edges,
    overlay: { version: 0, nodeOverrides: {}, edgeOverrides: {}, manualNodes: [], manualEdges: [] },
  }

  if (raw.git) graph.git = raw.git
  return graph
}

export async function analyze(input) {
  const raw = await analyzeRepository(input)
  return raw
}

export async function serve(input) {
  const { repoUrl, localPath, githubToken, port = 3000 } = input

  const raw = await analyzeRepository({ repoUrl, localPath, githubToken })
  const graph = rawToMinimalGraph(raw)

  const tmpDir = process.env.TEMP || '/tmp'
  const tempFile = join(tmpDir, `repomap-${Date.now()}.json`)
  const fs = await import('fs')
  fs.writeFileSync(tempFile, JSON.stringify(graph))

  const child = spawn('npx', ['@frannn2114/repomap-visual', 'serve', tempFile, `--port=${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let detectedPort = port
  const portPromise = new Promise((resolvePort) => {
    if (!child.stdout) {
      resolvePort(port)
      return
    }
    child.stdout.on('data', (data) => {
      const output = data.toString()
      const match = output.match(/http:\/\/localhost:(\d+)/)
      if (match) {
        detectedPort = parseInt(match[1], 10)
        resolvePort(detectedPort)
      }
    })
    setTimeout(() => resolvePort(port), 15000)
  })

  const actualPort = await portPromise
  const url = `http://localhost:${actualPort}`

  const cleanup = () => {
    if (!child.killed) child.kill('SIGTERM')
  }
  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  await new Promise(r => setTimeout(r, 2000))

  return { pid: child.pid, url }
}
