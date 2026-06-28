#!/usr/bin/env node
import { createGraphServer } from './server/index.js'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const args = process.argv.slice(2)

  // Parse args
  const graphFile = args.find(a => !a.startsWith('-'))
  const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || args[1] || '0', 10)
  const host = args.find(a => a.startsWith('--host='))?.split('=')[1] || 'localhost'
  const dev = args.includes('--dev')

  if (!graphFile) {
    console.error(`
Usage: repomap-visual serve <graph-file> [options]

Options:
  --port=<port>    Port to run on (default: 0 = random free port)
  --host=<host>    Host to bind (default: localhost)
  --dev            Run in development mode with Vite HMR

Example:
  repomap-visual serve /tmp/graph.json --port=0
  repomap-visual serve ./graph.json --port=3456 --host=0.0.0.0
`)
    process.exit(1)
  }

  try {
    const { url, close } = await createGraphServer({ graphFile, port, host, dev })

    console.log(`[repomap-visual] Server ready at ${url}`)
    console.log(`[repomap-visual] Graph: ${graphFile}`)
    console.log(`[repomap-visual] Press Ctrl+C to stop`)

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n[repomap-visual] Shutting down...')
      await close()
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    process.on('exit', shutdown)

    // Keep process alive
    await new Promise(() => {})
  } catch (error) {
    console.error('[repomap-visual] Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()