// src/server/index.ts
import express from "express";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";
var __dirname = dirname(fileURLToPath(import.meta.url));
function findPackageRoot(dir) {
  if (existsSync(join(dir, "package.json"))) return dir;
  const parent = dirname(dir);
  if (parent === dir) throw new Error("Could not find package root");
  return findPackageRoot(parent);
}
var packageRoot = findPackageRoot(__dirname);
function statusToType(s) {
  switch (s.charAt(0)) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return s;
  }
}
async function createGraphServer({
  graphFile,
  port,
  host,
  dev = false,
  repoPath
}) {
  const app = express();
  const httpServer = createServer(app);
  const graphJson = readFileSync(graphFile, "utf-8");
  let graphData;
  try {
    graphData = JSON.parse(graphJson);
  } catch {
    graphData = null;
  }
  function getCurrentBranch() {
    var _a;
    if ((_a = graphData == null ? void 0 : graphData.git) == null ? void 0 : _a.branches) {
      const current = graphData.git.branches.find((b) => b.current);
      if (current) return current.name;
    }
    try {
      return execSync("git rev-parse --abbrev-ref HEAD", { cwd: repoPath, encoding: "utf-8", stdio: "pipe" }).trim();
    } catch {
      return "main";
    }
  }
  app.get("/api/initial-graph", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(graphJson);
  });
  app.get("/api/diff", (req, res) => {
    const from = req.query.from || getCurrentBranch();
    const to = req.query.to;
    if (!to) {
      res.status(400).json({ error: 'Missing "to" query param (target branch)' });
      return;
    }
    if (!repoPath) {
      res.status(400).json({ error: "Server started without --repo path, diffs unavailable" });
      return;
    }
    try {
      const raw = execSync(
        `git diff --name-status "${from}...${to}"`,
        { cwd: repoPath, encoding: "utf-8", stdio: "pipe", maxBuffer: 10 * 1024 * 1024 }
      );
      const files = raw.trim().split("\n").filter(Boolean).map((line) => {
        const [status, ...pathParts] = line.split("	");
        return { path: pathParts.join("	"), status: statusToType(status) };
      });
      res.json({ from, to, files });
    } catch (err) {
      res.status(500).json({ error: `Diff failed: ${err.message}` });
    }
  });
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", graphFile, repoPath: repoPath || null });
  });
  const clientDist = join(packageRoot, "dist/client");
  if (dev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      root: packageRoot,
      appType: "spa",
      plugins: [react()],
      resolve: {
        alias: {
          "@frannn2114/repomap-visual": join(packageRoot, "src/index.ts")
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
  return new Promise((resolve, reject) => {
    httpServer.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      console.log(`[repomap-visual] Server running at ${url}`);
      resolve({
        url,
        close: () => new Promise((res) => httpServer.close(() => res()))
      });
    });
    httpServer.on("error", reject);
  });
}
async function main() {
  let args = process.argv.slice(2);
  const subcommands = ["serve"];
  if (subcommands.includes(args[0])) args = args.slice(1);
  let repoPath;
  const filtered = [];
  for (const a of args) {
    const repoMatch = a.match(/^--repo(?:Path)?=(.+)$/) || a.match(/^--repo(?:Path)?$/);
    if (repoMatch) {
      if (repoMatch[1]) repoPath = repoMatch[1];
      else continue;
    } else {
      filtered.push(a);
    }
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--repo" || args[i] === "--repoPath") {
      repoPath = args[i + 1];
      i++;
    }
  }
  const graphFile = filtered[0];
  const port = parseInt(filtered[1] || "0", 10);
  const host = filtered[2] || "localhost";
  const dev = filtered.includes("--dev");
  if (!graphFile) {
    console.error("Usage: repomap-visual-server <graph-file> [port] [host] [--dev] [--repo=<path>]");
    process.exit(1);
  }
  try {
    const { url, close } = await createGraphServer({ graphFile, port, host, dev, repoPath });
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

export {
  createGraphServer
};
