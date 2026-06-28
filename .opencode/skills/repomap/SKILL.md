---
name: repomap
description: Generate architectural maps of repositories as RepoGraph JSON using local deterministic analysis, and serve interactive visualizations
license: MIT
compatibility: opencode
metadata:
  type: analysis
  output: json
---

## Installation

Before using this skill, ensure the required packages are installed:

```bash
# Dependencies for the analyzer (glob for file matching):
cd ~/.opencode/skills/repomap && npm install

# Visual server (auto-installed via npx on first serve):
npm install -g @frannn2114/repomap-visual
```

The `serve` action will auto-install the visual package via `npx` if missing.

## Actions

### analyze

Analyzes a repository and returns a `RepoGraph` JSON object.

**Input:**
- `localPath` (string, optional) — Path to a local repository
- `repoUrl` (string, optional) — GitHub repository URL (e.g. `https://github.com/owner/repo`)
- `githubToken` (string, optional) — GitHub token for private repos
- `outputFile` (string, optional) — Write the graph JSON to a file path
- `resumeFrom` (object, optional) — Previous analysis progress to resume from

At least one of `localPath` or `repoUrl` must be provided.

**How to execute:**
1. Import and call `analyzeRepository` from `./analyzer.js`:
   ```js
   import { analyzeRepository } from './analyzer.js'
   const graph = await analyzeRepository({ localPath, repoUrl, githubToken, resumeFrom, outputFile })
   ```
2. Return the `RepoGraph` JSON to the user.

### serve

Analyzes a repository and starts a local Express + Vite server showing the interactive graph.

**Input:**
- `localPath` (string, optional) — Path to a local repository
- `repoUrl` (string, optional) — GitHub repository URL
- `githubToken` (string, optional) — GitHub token for private repos
- `port` (number, optional, default 0) — Port for the server (0 = random free port)

**How to execute:**
1. Analyze the repository using the analyzer (same as `analyze` action)
2. Write the graph JSON to a temp file: `/tmp/repomap-<timestamp>.json`
3. Spawn the visual server:
   ```bash
   npx @frannn2114/repomap-visual serve /tmp/repomap-<timestamp>.json --port <port>
   ```
4. Parse stdout for the server URL (`Server ready at http://...`)
5. Set up cleanup handlers to kill the child process on exit/SIGINT/SIGTERM
6. Return `{ pid: <child_pid>, url: <server_url> }`

## RepoGraph JSON Format

The analysis produces a JSON object with this structure:

```json
{
  "meta": {
    "repoUrl": "local://my-project",
    "repoName": "my-project",
    "analysisVersion": "a1b2c3d4",
    "analyzedAt": "2026-01-15T10:30:00.000Z",
    "detectedPattern": "layered_monolith",
    "layoutTemplate": "vertical_layers",
    "patternConfidence": 0.75
  },
  "nodes": [
    { "id": "layer__presentation", "label": "Presentation", "type": "layer", "depth": 0, "parentId": null, "files": [], "detectedRole": "ui", "patterns": [], "metadata": {} },
    { "id": "module__auth", "label": "Auth", "type": "module", "parentId": "layer__presentation", "depth": 1, "files": ["src/auth.ts"], "detectedRole": "authentication", "patterns": [], "metadata": {} },
    { "id": "file__src_auth_ts", "label": "auth.ts", "type": "file", "parentId": "module__auth", "depth": 2, "files": ["src/auth.ts"], "detectedRole": "auth_mod", "patterns": [], "metadata": {} }
  ],
  "edges": [
    { "id": "edge_1", "source": "file__src_auth_ts", "target": "file__src_api_ts", "edgeType": "engineering", "strength": 3, "label": "calls", "confidence": "high" }
  ],
  "overlay": { "version": 0, "nodeOverrides": {}, "edgeOverrides": {}, "manualNodes": [], "manualEdges": [] }
}
```

### Node Types

| Type | Depth | Description |
|------|-------|-------------|
| `layer` | 0 | Top-level architectural layer |
| `module` | 1 | Module within a layer |
| `file` | 2 | Individual source file |
| `component` | 3 | Class/function/interface within a file |

### Edge Types

| Type | Description |
|------|-------------|
| `engineering` | Runtime calls, imports, data flow |
| `architecture` | Contains, part-of, hierarchy |

### Confidence Levels

`high`, `medium`, `uncertain`

## Architecture Detection

The analyzer detects architectural patterns based on naming conventions and structure:

| Pattern | Layout | Detection |
|---------|--------|-----------|
| clean_architecture | concentric_rings | domain/entity + interface/adapter + framework layers |
| hexagonal | concentric_rings | ports/adapters + domain/core |
| mvc | horizontal_three_column | model + view + controller modules |
| microservices | cluster | service-named modules, many architecture edges |
| layered_monolith | vertical_layers | presentation + service/business + data layers |
| feature_modules | grid_clusters | many modules, no layered structure |
| pipeline_etl | left_right_flow | ETL/pipeline/stream modules |
| unknown | force_directed | No pattern detected (confidence < 0.6) |
