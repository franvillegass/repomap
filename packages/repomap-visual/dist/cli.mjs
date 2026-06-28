#!/usr/bin/env node
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { createServer as createServer$1 } from 'vite';
import react from '@vitejs/plugin-react';

var __dirname$1 = dirname(fileURLToPath(import.meta.url));
async function createGraphServer({
  graphFile,
  port,
  host,
  dev = false
}) {
  const app = express();
  const httpServer = createServer(app);
  const graphJson = readFileSync(graphFile, "utf-8");
  app.get("/api/initial-graph", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(graphJson);
  });
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", graphFile });
  });
  const clientDist = join(__dirname$1, "../../dist/client");
  if (dev) {
    const vite = await createServer$1({
      server: { middlewareMode: true },
      root: join(__dirname$1, "../../"),
      appType: "spa",
      plugins: [react()],
      resolve: {
        alias: {
          "@frannn2114/repomap-visual": join(__dirname$1, "../index.ts")
        }
      }
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(clientDist));
    app.get("*", (_req, res) => {
      res.sendFile(join(clientDist, "index.html"));
    });
  }
  return new Promise((resolve2, reject) => {
    httpServer.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      console.log(`[repomap-visual] Server running at ${url}`);
      resolve2({
        url,
        close: () => new Promise((res) => httpServer.close(() => res()))
      });
    });
    httpServer.on("error", reject);
  });
}
async function main() {
  const args = process.argv.slice(2);
  const graphFile = args[0];
  const port = parseInt(args[1] || "0", 10);
  const host = args[2] || "localhost";
  const dev = args.includes("--dev");
  if (!graphFile) {
    console.error("Usage: repomap-visual-server <graph-file> [port] [host] [--dev]");
    process.exit(1);
  }
  try {
    const { url, close } = await createGraphServer({ graphFile, port, host, dev });
    const shutdown = async () => {
      console.log("\n[repomap-visual] Shutting down...");
      await close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("exit", shutdown);
    await new Promise(() => {
    });
  } catch (error) {
    console.error("[repomap-visual] Server error:", error);
    process.exit(1);
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
dirname(fileURLToPath(import.meta.url));
async function main2() {
  const args = process.argv.slice(2);
  const graphFile = args.find((a) => !a.startsWith("-"));
  const port = parseInt(args.find((a) => a.startsWith("--port="))?.split("=")[1] || args[1] || "0", 10);
  const host = args.find((a) => a.startsWith("--host="))?.split("=")[1] || "localhost";
  const dev = args.includes("--dev");
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
`);
    process.exit(1);
  }
  try {
    const { url, close } = await createGraphServer({ graphFile, port, host, dev });
    console.log(`[repomap-visual] Server ready at ${url}`);
    console.log(`[repomap-visual] Graph: ${graphFile}`);
    console.log(`[repomap-visual] Press Ctrl+C to stop`);
    const shutdown = async () => {
      console.log("\n[repomap-visual] Shutting down...");
      await close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("exit", shutdown);
    await new Promise(() => {
    });
  } catch (error) {
    console.error("[repomap-visual] Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
main2();
//# sourceMappingURL=cli.mjs.map
//# sourceMappingURL=cli.mjs.map