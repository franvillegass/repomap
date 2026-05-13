# RepoMap — Interactive Architecture Diagrams from GitHub

An intelligent web application that analyzes GitHub repositories and generates interactive, editable architecture diagrams using AI. RepoMap distinguishes between runtime dependencies and structural design patterns to create meaningful visualizations of complex codebases.

## Features

- **GitHub Repository Analysis**: Automatically fetch and analyze any public GitHub repository via URL
- **AI-Powered Architecture Detection**: Uses Claude (Anthropic) or Llama (Groq) to intelligently identify modules, layers, components, and their relationships
- **Interactive Visualization**: React Flow-based graph editor for exploring and understanding codebase architecture
- **Manual Diagram Creation**: Draw diagrams from scratch without needing a repository or API keys
- **Persistent Storage**: IndexedDB-based local storage for analyzed graphs and chat history
- **Branch & Exploration**: Create independent analysis branches to explore different architectural perspectives
- **Progress Resumption**: Resume interrupted analyses if you hit rate limits
- **Private Repository Support**: Analyze private repositories with GitHub personal access tokens
- **Flexible AI Provider**: Switch between Anthropic Claude (premium) or Groq Llama (free) at runtime

## Architecture

### Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS
- **Graph Rendering**: React Flow for interactive node/edge visualization
- **AI Integration**: Vercel AI SDK with support for Anthropic and Groq
- **Data Persistence**: IndexedDB via `idb` library (no backend required)
- **GitHub Integration**: Octokit for REST API access
- **Validation**: Zod for schema validation
- **Styling**: Tailwind CSS with custom design system

### Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── analyze/route.ts          # Pipeline execution endpoint
│   │   └── chat/route.ts              # AI chat endpoint
│   ├── layout.tsx                     # Root layout
│   └── page.tsx                       # Main UI entry point
├── components/
│   └── graph/
│       ├── GraphRenderer.tsx          # Main visualization component
│       ├── GraphNodes.tsx             # Node rendering logic
│       ├── ManualEditor.tsx           # Manual diagram creation
│       ├── ChatPanel.tsx              # AI chat interface
│       ├── AlternativeViews.tsx       # Alternative visualization modes
│       └── graphLayout.ts             # Graph layout algorithms
├── branches/
│   ├── UseBranches.tsx               # React context for branch management
│   ├── BranchPanel.tsx               # Branch UI controls
│   ├── storage.ts                     # Branch persistence
│   ├── resolver.ts                    # Branch conflict resolution
│   └── types.ts                       # TypeScript definitions
├── lib/
│   ├── pipeline/
│   │   ├── pipeline.ts                # Main orchestrator
│   │   ├── aiClient.ts                # AI SDK initialization
│   │   ├── prompts/
│   │   │   ├── pass1.ts               # Structure detection
│   │   │   ├── pass2.ts               # Dependency mapping
│   │   │   └── pass3.ts               # Semantic analysis
│   │   ├── sampler/
│   │   │   └── fileSampler.ts         # Token budget manager
│   │   └── schemas/
│   │       ├── graph.ts               # Graph JSON schema
│   │       └── validation.ts          # Zod validators
│   ├── storage/
│   │   ├── graphStore.ts              # Graph persistence
│   │   └── chatStore.ts               # Chat history
│   ├── github/
│   │   └── githubClient.ts            # GitHub API wrapper
│   ├── modelConfig.ts                 # AI provider configuration
│   └── ai.ts                          # General AI utilities
```

## Analysis Pipeline

RepoMap uses a deterministic 3-pass analysis pipeline to understand repository structure:

### Pass 1: Structure Detection
- **Input**: File tree paths from GitHub
- **Output**: Identified relevant files, tentative modules, size estimates
- **Purpose**: High-level repository structure without analyzing code content

### Pass 2: Dependency Mapping
- **Input**: Sampled file contents + modules from Pass 1
- **Output**: Graph nodes and edges with type, confidence levels, and relationships
- **Purpose**: Identify dependencies and connections between components
- **Sampling**: Intelligent file sampling based on estimated repository size

### Pass 3: Semantic Analysis
- **Input**: Graph structure from Pass 2 (topology only)
- **Output**: Node roles, design patterns, layout suggestions
- **Purpose**: Add semantic meaning and improve visualization layout
- **Efficiency**: Works with graph topology only (minimal token cost)

## Graph Schema

RepoMap uses a standardized JSON schema for representing architectures:

```typescript
interface RepoGraph {
  meta: {
    repoUrl: string
    repoName: string
    analyzedAt: string
    detectedPattern: string
    estimatedSize: 'small' | 'medium' | 'large'
  }
  nodes: GraphNode[] luego 
  edges: GraphEdge[]
  overlay: {
    nodeEdits: Record<string, NodeEdit>
    edgeEdits: Record<string, EdgeEdit>
  }
}

interface GraphNode {
  id: string                    // Format: 'type__name' (layer__api, module__auth)
  label: string
  type: 'layer' | 'module' | 'file' | 'component'
  depth: 0 | 1 | 2 | 3
  role?: string                 // 'controller', 'service', 'utility', etc.
  metadata: Record<string, any>
}

interface GraphEdge {
  id: string
  source: string
  target: string
  type: 'import' | 'dependency' | 'reference'
  confidence: 'high' | 'medium' | 'uncertain'
  label?: string
  metadata: Record<string, any>
}
```

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- For private repository analysis: GitHub Personal Access Token

### Installation

```bash
# Clone repository
git clone <repo-url>
cd repomap-pipeline-v2

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Configuration

#### AI Provider Selection

Choose between two providers:

**Option 1: Anthropic Claude (Premium)**
- Requires Anthropic API subscription
- Better analysis quality
- Higher accuracy for complex architectures
- Uses `claude-sonnet-4-20250514` by default

**Option 2: Groq Llama (Free)**
- Requires free Groq API key from [console.groq.com](https://console.groq.com)
- Uses `llama-3.3-70b` model
- Rate limited to ~30 requests/minute
- Progress auto-saves between sessions when rate limited

Switch providers in the UI or via environment variables:
```bash
AI_PROVIDER=groq          # or 'anthropic'
AI_MODEL=llama-3.3-70b    # or 'claude-sonnet-4-20250514'
GROQ_API_KEY=gsk_...      # Groq key
ANTHROPIC_API_KEY=sk-...  # Anthropic key
```

#### GitHub Configuration

For private repositories:
1. Create a GitHub Personal Access Token at [github.com/settings/tokens](https://github.com/settings/tokens)
2. Paste the token in the "add github token" section on the UI
3. Tokens are stored in sessionStorage and never persisted

### Usage

#### Auto-Analysis

1. Enter a GitHub repository URL (e.g., `facebook/react`)
2. Select AI provider and add any required API keys
3. Click "analyze repository"
4. Watch the 3-pass analysis progress
5. Explore the interactive diagram

#### Manual Creation

1. Click "create diagram manually"
2. Draw nodes and connect them
3. Assign roles, types, and metadata
4. Save to local storage

#### Branch Exploration

1. From an analyzed repository, click "create branch"
2. Explore alternative architectures independently
3. Merge changes back to base graph
4. Compare different perspectives

#### Chat & Discussion

1. Interact with the AI about the architecture
2. Ask questions about dependencies, patterns, and design
3. Get suggestions for improvements
4. Chat history persists in IndexedDB

## Key Design Decisions

### Token Budget Management

File sampling in Pass 2 adapts to repository size:
- **Small** (<300 lines): Full content, no skeleton
- **Medium** (<150 lines): Skeleton mode (imports/exports + function signatures)
- **Large** (<80 lines): Skeleton mode with aggressive truncation

This ensures consistent token usage across all repository sizes.

### Confidence Levels

Edges include confidence annotations:
- **high**: Explicit imports/dependencies in source code
- **medium**: Inferred from naming patterns or proximity
- **uncertain**: Ambiguous relationships requiring user clarification

Users can reclassify edges in the UI to provide feedback.

### User Edits Isolation

All user modifications are stored in an `overlay` layer separate from the analyzed graph. This allows:
- Re-analysis without losing manual edits
- Easy diff between analyzed and edited states
- Non-destructive exploration

### Deterministic Pipeline

The analysis pipeline is deterministic (not autonomous tool use):
- Predictable execution flow (3 passes always in order)
- Easier debugging and error recovery
- Resumable at pass boundaries if rate limited
- Better token budget control

## Development

### Available Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm start        # Start production server
npm run lint     # Run ESLint
```

### Building for Production

```bash
npm run build
npm start
```

The production build optimizes for bundle size and performance. Graph renderer components are dynamically imported.

## Data Storage

RepoMap uses **IndexedDB** for all local persistence:
- **Graphs**: Complete analyzed architectures
- **Progress**: Resume state for interrupted analyses
- **Chat History**: Conversation logs per repository
- **Model Configuration**: UI preferences

No data is sent to external servers (except GitHub API and chosen AI provider).

## Limitations & Future Work

### Current Limitations
- Public repositories only (without GitHub token)
- Single-file analysis depth (cannot follow full call stacks)
- No monorepo-specific support
- Manual layout adjustments required for complex graphs

### Planned Features
- [ ] Supabase integration for cloud sync
- [ ] Monorepo-aware analysis
- [ ] Custom analysis templates
- [ ] Export to Mermaid/PlantUML
- [ ] Team collaboration features
- [ ] Benchmark and cost estimation

## Troubleshooting

### Rate Limiting Issues
- RepoMap automatically saves progress
- Use the "resume" button to continue from where you left off
- Check API key rate limits for your chosen provider

### Graph Not Rendering
- Check browser console for errors
- Ensure IndexedDB is enabled
- Try clearing browser cache and reloading

### Poor Analysis Quality
- Try the Anthropic/Claude provider for better results
- Ensure the repository is public or token has access
- Check that the repository structure is conventional

## Contributing

Contributions welcome! Areas of interest:
- Additional AI providers (OpenAI, Together, etc.)
- Alternative graph layouts
- Export formats
- Performance optimizations

## License

[Your License Here]

## Credits

Built with:
- [Next.js](https://nextjs.org)
- [React Flow](https://reactflow.dev)
- [Vercel AI SDK](https://github.com/vercel/ai)
- [Octokit](https://octokit.js.org)
- [Tailwind CSS](https://tailwindcss.com)
