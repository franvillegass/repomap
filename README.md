# RepoMap — Skill edition

[![Watch the demo](https://img.shields.io/badge/YouTube-Watch_demo-red?logo=youtube)](https://youtu.be/pEt4R_vPp5Q)

An [opencode](https://github.com/ssturdevant/opencode) skill that generates architectural maps of repositories as interactive, editable graphs. The skill uses a **two-phase pipeline**: a deterministic analyzer extracts raw structural data (zero LLM tokens spent on code reading), and the calling agent enriches it with semantic interpretation via a single LLM call.

> **🛈 Note:** The `main` branch contains the previous standalone web application version (Next.js + AI SDK). The main branch is the skill edition.

## How it works

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  analyzer   │ ──▶│  RawAnalysis  │ ──▶│  Agent (LLM)│ ──▶│  RepoGraph   │ ──▶ visual server
│ (deterministic)   │ (structured data)  │ (semantic)  │     │  (JSON)      │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
```

### Phase 1 — Analyzer (deterministic, no LLM)

The analyzer (`analyzer.js`) is a pure JavaScript module that never calls an LLM. It:

- Scans the file tree (local or GitHub) respecting `.gitignore`
- Extracts **imports** and **definitions** (function/class names + parameters) via regex
- Builds the directory hierarchy (layers → modules → files)
- Computes import-based edges between modules

This produces a `RawAnalysis` — a compact JSON object (~10 KB even for large repos) containing module summaries, file-level data, and structural connections. The agent **never reads source code directly**, saving thousands of tokens.

### Phase 2 — Agent enrichment (LLM, one call)

The calling agent receives the `RawAnalysis` and builds a single prompt that asks the LLM to:

- Assign an architectural **role** to each module (presentation, api_gateway, business_logic, data_access, etc.)
- Detect the overall **architectural pattern** (layered_monolith, hexagonal, mvc, microservices, etc.)
- Pick a **layout template** for the visualizer
- Optionally improve module labels for readability

The LLM produces the completed `RepoGraph` JSON.

### Phase 3 — Visualization

The `RepoGraph` is served by `@frannn2114/repomap-visual`, an npm package that provides:

- **React Flow graph** with node inspection sidebar
- **Alternative views**: onion rings, layer stack, clusters, pipeline flow
- **Branch system**: explore alternative architectures without modifying the base graph — add/delete nodes and edges, create connections, all persisted in IndexedDB
- **Viewport culling** for smooth performance on large graphs

## Skill structure

```
.opencode/skills/repomap/
├── SKILL.md          # Skill instructions for the calling agent
├── index.js          # Entry point: analyze() and serve()
├── analyzer.js       # Deterministic scanner (Phase 1)
├── package.json      # Dependencies (glob)
└── node_modules/
```

## Actions

### `analyze`

Analyzes a repository locally or via GitHub and returns a `RawAnalysis`.

```js
import { analyzeRepository } from './analyzer.js'
const raw = await analyzeRepository({
  localPath: '/path/to/repo',
  // or: repoUrl: 'https://github.com/owner/repo',
  // githubToken: 'ghp_...',
})
// raw = { meta, modules, fileData, nodes, edges }
```

### `serve`

Analyzes + shows the user the npx command to start the visual server:

```bash
npx @frannn2114/repomap-visual serve /tmp/repomap-<timestamp>.json --port=3000
```

## RepoGraph JSON format

```jsonc
{
  "meta": {
    "repoUrl": "local://my-project",
    "repoName": "my-project",
    "detectedPattern": "layered_monolith",
    "layoutTemplate": "vertical_layers",
    "patternConfidence": 0.85
  },
  "nodes": [
    { "id": "layer__backend", "label": "Backend", "type": "layer", "depth": 0,
      "files": [], "detectedRole": "", "patterns": [], "metadata": {} },
    { "id": "module__api", "label": "Api", "type": "module", "depth": 1,
      "parentId": "layer__backend", "files": ["backend/api/routes.py"],
      "detectedRole": "api_gateway", "patterns": [], "metadata": {} }
  ],
  "edges": [
    { "id": "edge_1", "source": "module__api", "target": "module__services",
      "edgeType": "engineering", "strength": 3, "confidence": "high" }
  ],
  "overlay": { "version": 0, "nodeOverrides": {}, "edgeOverrides": {},
    "manualNodes": [], "manualEdges": [] }
}
```

## Design decisions

### Why the agent never reads source code

The deterministic analyzer extracts structured data (imports, definitions, directory structure) without any LLM involvement. The agent receives a compact `RawAnalysis` and reasons about architecture using only this metadata — not raw source files. On a typical repo of 200 files, this saves ~95% of the tokens compared to feeding file contents to the LLM.

### What the analyzer does vs. what the agent does

| Task | Done by | Why |
|---|---|---|
| File scanning (glob, gitignore) | Analyzer | Deterministic, fast |
| Import extraction | Analyzer | Regex, no intelligence needed |
| Definition extraction | Analyzer | Regex, fast |
| Directory structure | Analyzer | Deterministic |
| Edge construction | Analyzer | Based on imports, no reasoning |
| Role assignment | Agent (LLM) | Requires semantic understanding |
| Pattern detection | Agent (LLM) | Requires architectural reasoning |
| Module labeling | Agent (LLM) | Human-readable descriptions |

### Why file-level nodes are hidden in the graph

The visualizer only shows **layer** and **module** nodes by default. Individual files are accessible by expanding a module — this keeps the graph clean and performant (from ~6000 nodes to ~200 nodes for large repos).

## Getting started

```bash
# Clone
git clone <repo-url>
cd repomap-pipeline-v2

# Install skill dependencies
cd .opencode/skills/repomap
npm install
```

Then use the repomap skill within opencode — the agent will call `analyze()` or `serve()` as needed.

## npm package

The visual server is published as [`@frannn2114/repomap-visual`](https://www.npmjs.com/package/@frannn2114/repomap-visual) on npm. It provides the React Flow graph, alternative views, branch system, and Express+Vite server.

```bash
npx @frannn2114/repomap-visual serve graph.json --port=3000
```

## License

MIT