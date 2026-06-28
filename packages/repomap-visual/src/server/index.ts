import express from 'express'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { join, dirname, resolve } from 'path'
import { readFileSync } from 'fs'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface ServerOptions {
  graphFile: string
  port: number
  host: string
  dev?: boolean
}

export async function createGraphServer({
  graphFile,
  port,
  host,
  dev = false
}: ServerOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express()
  const httpServer = createServer(app)

  // Read graph once at startup
  const graphJson = readFileSync(graphFile, 'utf-8')

  // API endpoint - serves the graph JSON
  app.get('/api/initial-graph', (_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(graphJson)
  })

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', graphFile })
  })

  const clientDist = join(__dirname, '../../dist/client')

  if (dev) {
    // Dev mode: Vite middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      root: join(__dirname, '../../'),
      appType: 'spa',
      plugins: [react()],
      resolve: {
        alias: {
          '@frannn2114/repomap-visual': join(__dirname, '../index.ts')
        }
      }
    })
    app.use(vite.middlewares)
  } else {
    // Prod mode: serve built files
    app.use(express.static(clientDist))
    app.get('*', (_req, res) => {
      res.sendFile(join(clientDist, 'index.html'))
    })
  }

  return new Promise((resolve, reject) => {
    httpServer.listen(port, host, () => {
      const url = `http://${host}:${port}`
      console.log(`[repomap-visual] Server running at ${url}`)
      resolve({
        url,
        close: () => new Promise((res) => httpServer.close(() => res()))
      })
    })
    httpServer.on('error', reject)
  })
}

// CLI entry
async function main() {
  const args = process.argv.slice(2)
  const graphFile = args[0]
  const port = parseInt(args[1] || '0', 10)
  const host = args[2] || 'localhost'
  const dev = args.includes('--dev')

  if (!graphFile) {
    console.error('Usage: repomap-visual-server <graph-file> [port] [host] [--dev]')
    process.exit(1)
  }

  try {
    const { url, close } = await createGraphServer({ graphFile, port, host, dev })

    // Handle shutdown
    const shutdown = async () => {
      console.log('\n[repomap-visual] Shutting down...')
      await close()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    process.on('exit', shutdown)

    // Keep alive
    await new Promise(() => {})
  } catch (error) {
    console.error('[repomap-visual] Server error:', error)
    process.exit(1)
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}