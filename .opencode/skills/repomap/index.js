import { analyzeRepository } from './analyzer.js'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { join, dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(__dirname, '../../../')

export async function analyze(input) {
  return analyzeRepository(input)
}

export async function serve(input) {
  const { repoUrl, localPath, githubToken, port = 3000 } = input

  const graph = await analyzeRepository({ repoUrl, localPath, githubToken })

  const tmpDir = process.env.TEMP || '/tmp'
  const tempFile = join(tmpDir, `repomap-${Date.now()}.json`)
  const fs = await import('fs')
  fs.writeFileSync(tempFile, JSON.stringify(graph))

  const nextPort = port || 3000
  const child = spawn('npm', ['run', 'dev', '--', '-p', String(nextPort)], {
    cwd: workspaceRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, REPOMAP_GRAPH_FILE: tempFile },
  })

  let detectedPort = nextPort
  const portPromise = new Promise((resolvePort) => {
    if (!child.stdout) {
      resolvePort(nextPort)
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
    setTimeout(() => resolvePort(nextPort), 15000)
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
