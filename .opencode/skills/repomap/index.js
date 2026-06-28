import { analyzeRepository } from './analyzer.js'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function analyze(input) {
  return analyzeRepository(input)
}

export async function serve(input) {
  const { repoUrl, localPath, githubToken, port = 0 } = input

  const graph = await analyzeRepository({ repoUrl, localPath, githubToken })
  
  const tempFile = join('/tmp', `repomap-${Date.now()}.json`)
  const fs = await import('fs')
  fs.writeFileSync(tempFile, JSON.stringify(graph))

  const args = ['@frannn2114/repomap-visual', 'serve', tempFile, '--port', String(port)]
  const child = spawn('npx', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, NODE_ENV: 'production' }
  })

  let detectedPort = port
  const portPromise = new Promise((resolve) => {
    if (!child.stdout) {
      resolve(port || 3000)
      return
    }
    child.stdout.on('data', (data) => {
      const output = data.toString()
      const match = output.match(/Server ready at http:\/\/[^:]+:(\d+)/)
      if (match) {
        detectedPort = parseInt(match[1], 10)
        resolve(detectedPort)
      }
    })
    setTimeout(() => resolve(port || 3000), 5000)
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
