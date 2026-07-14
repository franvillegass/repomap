#!/usr/bin/env node
import {
  createGraphServer
} from "./chunk-DORPUD5U.mjs";

// src/cli.ts
import { fileURLToPath } from "url";
import { dirname } from "path";
var __dirname = dirname(fileURLToPath(import.meta.url));
async function main() {
  var _a, _b;
  let args = process.argv.slice(2);
  const subcommands = ["serve"];
  if (subcommands.includes(args[0])) args = args.slice(1);
  const graphFile = args.find((a) => !a.startsWith("-"));
  const port = parseInt(((_a = args.find((a) => a.startsWith("--port="))) == null ? void 0 : _a.split("=")[1]) || args[1] || "0", 10);
  const host = ((_b = args.find((a) => a.startsWith("--host="))) == null ? void 0 : _b.split("=")[1]) || "localhost";
  const dev = args.includes("--dev");
  const repoMatch = args.find((a) => a.startsWith("--repo="));
  const repoPath = repoMatch == null ? void 0 : repoMatch.split("=")[1];
  if (!graphFile) {
    console.error(`
Usage: repomap-visual serve <graph-file> [options]

Options:
  --port=<port>    Port to run on (default: 0 = random free port)
  --host=<host>    Host to bind (default: localhost)
  --repo=<path>    Path to git repo (for branch diff support)
  --dev            Run in development mode with Vite HMR

Example:
  repomap-visual serve /tmp/graph.json --port=0
  repomap-visual serve ./graph.json --port=3456 --host=0.0.0.0 --repo=.
`);
    process.exit(1);
  }
  try {
    const { url, close } = await createGraphServer({ graphFile, port, host, dev, repoPath });
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
main();
