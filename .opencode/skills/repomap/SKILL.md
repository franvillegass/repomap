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

Analyzes a repository and returns a `RawAnalysis` JSON object with deterministic
structural data (modules, files, imports, definitions, edges). The agent must then
use an LLM call to enrich it with semantic interpretation (roles, patterns, labels).

**Input:**
- `localPath` (string, optional) — Path to a local repository
- `repoUrl` (string, optional) — GitHub repository URL (e.g. `https://github.com/owner/repo`)
- `githubToken` (string, optional) — GitHub token for private repos
- `outputFile` (string, optional) — Write the raw analysis JSON to a file path
- `resumeFrom` (object, optional) — Previous analysis progress to resume from

At least one of `localPath` or `repoUrl` must be provided.

**How to execute:**
1. Import and call `analyzeRepository` from `./analyzer.js`:
   ```js
   import { analyzeRepository } from './analyzer.js'
   const raw = await analyzeRepository({ localPath, repoUrl, githubToken, resumeFrom, outputFile })
   ```
2. The `raw` object contains `modules`, `fileData`, `nodes`, `edges`, and `meta`.
3. Build an LLM prompt that sends the module/file/import data (NOT the full source code)
   and asks the model to:
   - Assign a `detectedRole` to each module (presentation, api_gateway, business_logic,
     data_access, authentication, configuration, utility, testing, middleware, messaging,
     caching, background_jobs, security, observability, database_migration, unknown)
   - Detect intra-module patterns (repository_pattern, factory_pattern, etc.)
   - Determine the overall architectural pattern and pick a layout template:
     `vertical_layers` | `horizontal_three_column` | `concentric_rings` |
     `left_right_flow` | `grid_clusters` | `force_directed`
   - Optionally improve module labels for readability.
4. Merge the LLM output into the final `RepoGraph`:
   ```js
   const nodesWithRoles = raw.nodes.map(node => ({
     ...node,
     detectedRole: llmRoles[node.id] || 'unknown',
     patterns: llmPatterns[node.id] || [],
   }))
   const graph = {
     meta: {
       ...raw.meta,
       detectedPattern: llmPattern,
       layoutTemplate: llmLayout,
       patternConfidence: llmConfidence,
     },
     nodes: nodesWithRoles,
     edges: raw.edges,
     overlay: { version: 0, nodeOverrides: {}, edgeOverrides: {}, manualNodes: [], manualEdges: [] },
   }
   ```
5. Return the final `RepoGraph` to the user.

### serve

Analyzes a repository, converts the raw analysis to a basic RepoGraph, writes it to
a temp file, and gives the user the npx command to start the visual server.

**Input:**
- `localPath` (string, optional) — Path to a local repository
- `repoUrl` (string, optional) — GitHub repository URL
- `githubToken` (string, optional) — GitHub token for private repos
- `port` (number, optional, default 3000) — Port for the server

**How to execute:**
1. Analyze the repository using the analyzer (same as `analyze` action)
2. Convert `raw` to a `RepoGraph` (the serve action in index.js does this automatically
   with default role/pattern values; you may optionally enrich via LLM first for a
   better visual result)
3. Write the graph JSON to a temp file then show the user the command to run the
   server themselves, so the agent stays responsive:
   ```bash
   npx @frannn2114/repomap-visual serve /path/to/repomap-<timestamp>.json --port=3000
   ```
4. Tell the user the server URL will be `http://localhost:3000` once they run the command

## RawAnalysis JSON Format

The deterministric analysis produces a `RawAnalysis` JSON object:

```json
{
  "meta": {
    "repoUrl": "local://my-project",
    "repoName": "my-project",
    "analysisVersion": "a1b2c3d4",
    "analyzedAt": "2026-01-15T10:30:00.000Z",
    "estimatedSize": "medium",
    "languages": ["Python", "TypeScript"],
    "totalFiles": 42,
    "totalModules": 8
  },
  "modules": [
    {
      "id": "module__backend_api",
      "label": "Api",
      "layerId": "layer__backend",
      "layerLabel": "Backend",
      "fileCount": 5,
      "filePaths": ["backend/api/routes.py", "backend/api/deps.py"]
    }
  ],
  "fileData": {
    "backend/api/routes.py": {
      "language": "Python",
      "lineCount": 120,
      "imports": ["fastapi", "app.services.users"],
      "definitions": [
        { "name": "router", "type": "const" },
        { "name": "get_users", "type": "function",
          "params": [{ "name": "user_id", "type": "int" }, { "name": "limit", "type": "int", "optional": true }],
          "returns": "list[User]"
        }
      ]
    }
  },
  "nodes": [
    { "id": "layer__presentation", "label": "Presentation", "type": "layer", "depth": 0, "parentId": null, "files": [], "metadata": {} },
    { "id": "module__auth", "label": "Auth", "type": "module", "parentId": "layer__presentation", "depth": 1, "files": ["src/auth.ts"], "metadata": {} },
    { "id": "file__src_auth_ts", "label": "auth.ts", "type": "file", "parentId": "module__auth", "depth": 2, "files": ["src/auth.ts"], "metadata": {} }
  ],
  "edges": [
    { "id": "edge_1", "source": "file__src_auth_ts", "target": "file__src_api_ts", "edgeType": "engineering", "strength": 3, "label": "imports", "confidence": "high" }
  ]
}
```

## Function signature extraction

The analyzer extracts function/method signatures from source code deterministically (regex, no LLM):

| Convention | Languages |
|---|---|
| `name: type` | TypeScript, JavaScript, Python, Rust, Swift, PHP, Ruby |
| `name type` | Go |
| `type name` | Java, C#, C++, Dart, Kotlin, Scala |

Fields per definition: `params: [{ name, type?, optional? }]`, `returns: string | undefined`

No external dependencies beyond `glob`.

## Git data (optional pipeline step)

If the repository is a git repo (local or GitHub), the analyzer can extract branches and commits:

1. The agent **asks the user** how many commits to include (configurable, default 30).
2. If `maxCommits > 60`, the agent must ask the user for a GitHub token (API rate limit: 60 req/h without token, 5000/h with token).
3. The agent calls `getGitData({ localPath, repoUrl, githubToken, maxCommits })` which returns `{ branches: [{ name, current }], commits: [{ hash, message, author, date, files: [{ path, status }] }] }` or `null` if not a git repo.
4. The agent adds the returned data as a `git` field in the final `RepoGraph` JSON.
5. The visualizer shows commits in a sidebar tab. Selecting a commit renders the graph with file nodes colored by change status (🟢 added, 🟠 modified, 🔴 deleted). Branches appear in the Branches tab under "Repository branches".

**Agent workflow for this step:**
```
if (gitData) {
  graph.git = gitData
}
```

## LLM Enrichment (Agent Step)

The `RawAnalysis` is meant to be fed to an LLM (without sending source code) to
produce the semantic interpretation. The agent now receives **full function signatures**
(params + return types), giving richer context for role assignment and pattern detection
without any extra token cost. Build a prompt with the module/file/import data and request:

- **Module roles**: For each module, pick from:
  `presentation`, `api_gateway`, `business_logic`, `data_access`, `authentication`,
  `configuration`, `utility`, `testing`, `middleware`, `messaging`, `caching`,
  `background_jobs`, `security`, `observability`, `database_migration`, `unknown`
- **Patterns**: Per-module design patterns (`repository_pattern`, `factory_pattern`, etc.)
- **Architectural pattern**: One of `clean_architecture`, `hexagonal`, `mvc`,
  `layered_monolith`, `microservices`, `feature_modules`, `pipeline_etl`, `unknown`
- **Layout template**: One of `vertical_layers`, `horizontal_three_column`,
  `concentric_rings`, `left_right_flow`, `grid_clusters`, `force_directed`
- **Confidence**: A number 0–1 for the pattern detection confidence

Merge the LLM response into the final `RepoGraph` with this structure:

```json
{
  "meta": {
    "repoUrl": "local://my-project",
    "repoName": "my-project",
    "analysisVersion": "a1b2c3d4",
    "analyzedAt": "2026-01-15T10:30:00.000Z",
    "detectedPattern": "layered_monolith",
    "layoutTemplate": "vertical_layers",
    "patternConfidence": 0.85
  },
  "nodes": [
    { "id": "layer__presentation", "label": "Presentation", "type": "layer", "depth": 0, "parentId": null, "files": [], "detectedRole": "", "patterns": [], "metadata": {} },
    { "id": "module__auth", "label": "Auth", "type": "module", "parentId": "layer__presentation", "depth": 1, "files": ["src/auth.ts"], "detectedRole": "authentication", "patterns": [], "metadata": {} }
  ],
  "edges": [
    { "id": "edge_1", "source": "file__src_auth_ts", "target": "file__src_api_ts", "edgeType": "engineering", "strength": 3, "label": "imports", "confidence": "high" }
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

### Edge Types

| Type | Description |
|------|-------------|
| `engineering` | Runtime calls, imports, data flow |
| `architecture` | Contains, part-of, hierarchy |

### Confidence Levels

`high`, `medium`, `uncertain`
