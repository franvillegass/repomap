import { analyzeRepository } from './analyzer.js'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Persistent storage paths
const REPOMAP_DIR = join(homedir(), '.repomap')
const MAPS_DIR = join(REPOMAP_DIR, 'maps')
const INDEX_PATH = join(REPOMAP_DIR, 'index.json')

function ensureStorage() {
  if (!existsSync(REPOMAP_DIR)) mkdirSync(REPOMAP_DIR, { recursive: true })
  if (!existsSync(MAPS_DIR)) mkdirSync(MAPS_DIR, { recursive: true })
  if (!existsSync(INDEX_PATH)) writeFileSync(INDEX_PATH, '[]', 'utf-8')
}

function loadIndex() {
  ensureStorage()
  try {
    return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'))
  } catch {
    return []
  }
}

function saveToIndex(entry) {
  const index = loadIndex()
  index.push(entry)
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8')
}

function sanitizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unnamed'
}


function spawnServer({ filePath, port = 3000, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['@frannn2114/repomap-visual', 'serve', filePath, `--port=${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let settled = false
    const done = (err, result) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(result)
    }

    child.on('error', (err) => done(err))

    let detectedPort = port
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const output = data.toString()
        const match = output.match(/http:\/\/localhost:(\d+)/)
        if (match) {
          detectedPort = parseInt(match[1], 10)
          const url = `http://localhost:${detectedPort}`
          const cleanup = () => { if (!child.killed) child.kill('SIGTERM') }
          process.on('exit', cleanup)
          process.on('SIGINT', cleanup)
          process.on('SIGTERM', cleanup)
          done(null, { pid: child.pid, url })
        }
      })
    } else {
      // No stdout, resolve with the configured port after a delay
      setTimeout(() => {
        const url = `http://localhost:${detectedPort}`
        done(null, { pid: child.pid, url })
      }, 3000)
    }

    // Timeout fallback — server started but didn't print URL?
    setTimeout(() => {
      if (!settled) {
        const url = `http://localhost:${detectedPort}`
        done(null, { pid: child.pid, url })
      }
    }, timeout)
  })
}


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

  // Persist to ~/.repomap/maps/
  ensureStorage()
  const repoName = sanitizeName(graph.meta.repoName || 'unnamed')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `${repoName}_${timestamp}.json`
  const filePath = join(MAPS_DIR, fileName)
  writeFileSync(filePath, JSON.stringify(graph), 'utf-8')

  saveToIndex({
    name: repoName,
    repoName: graph.meta.repoName || '',
    fileName,
    filePath,
    createdAt: new Date().toISOString(),
    repoUrl: graph.meta.repoUrl || '',
    detectedPattern: graph.meta.detectedPattern || '',
    nodeCount: graph.nodes.length,
  })

  const { pid, url } = await spawnServer({ filePath, port })
  return { pid, url }
}

export function list() {
  return loadIndex().map(entry => ({
    name: entry.name,
    repoName: entry.repoName,
    createdAt: entry.createdAt,
    detectedPattern: entry.detectedPattern,
    nodeCount: entry.nodeCount,
    fileName: entry.fileName,
  }))
}

export async function open({ name, port = 3000 } = {}) {
  const index = loadIndex()
  if (index.length === 0) return { error: 'No saved maps found' }

  // Find entry
  let entry
  if (!name) {
    // Open most recent
    entry = index[index.length - 1]
  } else {
    // Exact match on fileName
    entry = index.find(e => e.fileName === name)
    // Exact match on name
    if (!entry) entry = index.find(e => e.name === name || e.repoName === name)
    // Partial match (unique only)
    if (!entry) {
      const matches = index.filter(e => e.name.includes(name) || (e.repoName && e.repoName.includes(name)))
      if (matches.length === 1) entry = matches[0]
      if (matches.length > 1) return { error: `Multiple matches for "${name}"`, matches: matches.map(m => ({ name: m.name, repoName: m.repoName, createdAt: m.createdAt })) }
    }
  }

  if (!entry) return { error: `No map found matching "${name}"` }
  if (!existsSync(entry.filePath)) return { error: `Map file not found: ${entry.filePath}` }

  try {
    const child = await spawnServer({ filePath: entry.filePath, port })
    return { ...child, mapPath: entry.filePath }
  } catch (err) {
    return { error: `Failed to start visual server: ${err.message}` }
  }
}
