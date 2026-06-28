import { glob } from 'glob'
import { readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative, resolve, extname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const LANGUAGE_EXTENSIONS = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.h': 'C++',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.scala': 'Scala',
  '.clj': 'Clojure',
  '.hs': 'Haskell',
  '.ml': 'OCaml',
  '.fs': 'F#',
  '.dart': 'Dart',
  '.lua': 'Lua',
  '.pl': 'Perl',
  '.r': 'R',
  '.m': 'Objective-C',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.ps1': 'PowerShell',
  '.sql': 'SQL',
  '.html': 'HTML', '.htm': 'HTML',
  '.css': 'CSS', '.scss': 'CSS', '.sass': 'CSS', '.less': 'CSS',
  '.json': 'JSON',
  '.yaml': 'YAML', '.yml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.md': 'Markdown',
  '.dockerfile': 'Dockerfile', '.Dockerfile': 'Dockerfile',
  '.tf': 'Terraform',
  '.proto': 'Protobuf',
  '.graphql': 'GraphQL', '.gql': 'GraphQL',
}

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.git/**',
  '**/target/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/*.min.js',
  '**/*.min.css',
  '**/coverage/**',
  '**/.nyc_output/**',
  '**/vendor/**',
  '**/bower_components/**',
  '**/*.lock',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/Cargo.lock',
  '**/go.sum',
  '**/poetry.lock',
  '**/Pipfile.lock',
  '**/.eslintrc*',
  '**/.prettierrc*',
  '**/tsconfig.json',
  '**/jest.config.*',
  '**/vitest.config.*',
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/*.d.ts',
  '**/.DS_Store',
]

function getLanguage(filePath) {
  const ext = extname(filePath).toLowerCase()
  return LANGUAGE_EXTENSIONS[ext] || 'Unknown'
}

function shouldIgnore(filePath, rootPath) {
  const relPath = relative(rootPath, filePath)
  return IGNORE_PATTERNS.some(pattern => {
    const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$')
    return regex.test(relPath) || regex.test(filePath)
  })
}

async function getLocalFileTree(rootPath) {
  const files = await glob('**/*', {
    cwd: rootPath,
    nodir: true,
    ignore: IGNORE_PATTERNS,
    absolute: true,
  })
  return files.map(f => relative(rootPath, f)).sort()
}

// ── Inlined GitHub API (no octokit dependency) ──────────────

/**
 * Parses a GitHub URL into owner + repo.
 */
function parseGithubUrl(url) {
  const match = url
    .trim()
    .match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(\/.*)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

/**
 * Fetches the full file tree via the GitHub Git Trees API.
 */
async function fetchFileTree(owner, repo, token) {
  const headers = { Accept: 'application/vnd.github.v3+json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  // Resolve default branch
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
  if (!repoRes.ok) throw new Error(`GitHub API error: ${repoRes.status} ${repoRes.statusText}`)
  const repoData = await repoRes.json()
  const ref = repoData.default_branch

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`,
    { headers }
  )
  if (!treeRes.ok) throw new Error(`GitHub API error: ${treeRes.status} ${treeRes.statusText}`)
  const treeData = await treeRes.json()

  if (treeData.truncated) {
    console.warn('[GitHub] Tree response was truncated — very large repo.')
  }

  return (treeData.tree || [])
    .filter(item => item.type === 'blob' && typeof item.path === 'string')
    .map(item => item.path)
}

/**
 * Fetches a single file's content via the GitHub Contents API.
 */
async function fetchGitHubFileContent(owner, repo, path, token) {
  const headers = { Accept: 'application/vnd.github.v3+json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers })
  if (!res.ok) throw new Error(`GitHub API error fetching ${path}: ${res.status} ${res.statusText}`)

  const data = await res.json()
  if (Array.isArray(data)) throw new Error(`Path "${path}" is a directory, not a file.`)
  if (data.type !== 'file') throw new Error(`Path "${path}" is not a regular file (type: ${data.type}).`)
  if (!data.content || typeof data.content !== 'string') throw new Error(`No content returned for "${path}".`)

  const cleaned = data.content.replace(/\n/g, '')
  return Buffer.from(cleaned, 'base64').toString('utf-8')
}

// ── Analysis functions ──────────────────────────────────────

function analyzeFileStructure(filePaths, rootPath) {
  const relevantFiles = []
  const ignoredReasons = {}
  const languageSet = new Set()
  const moduleMap = new Map()

  for (const filePath of filePaths) {
    const fullPath = join(rootPath, filePath)
    const language = getLanguage(filePath)
    if (language !== 'Unknown') languageSet.add(language)

    if (shouldIgnore(fullPath, rootPath)) {
      ignoredReasons[filePath] = 'Ignored pattern'
      continue
    }

    relevantFiles.push(filePath)
    const dirParts = filePath.split('/').slice(0, -1)
    let moduleId = 'module__root'
    let moduleLabel = 'Root'
    let moduleDesc = 'Root level files'

    if (dirParts.length > 0) {
      const topDir = dirParts[0]
      moduleId = `module__${topDir.replace(/[^a-zA-Z0-9]/g, '_')}`
      moduleLabel = topDir.charAt(0).toUpperCase() + topDir.slice(1)
      moduleDesc = `${moduleLabel} module`
    }

    if (!moduleMap.has(moduleId)) {
      moduleMap.set(moduleId, { label: moduleLabel, filePaths: [], description: moduleDesc })
    }
    moduleMap.get(moduleId).filePaths.push(filePath)
  }

  const tentativeModules = Array.from(moduleMap.entries()).map(([id, data]) => ({
    id,
    label: data.label,
    filePaths: data.filePaths,
    description: data.description,
  }))

  const total = relevantFiles.length
  const estimatedSize = total < 20 ? 'small' : total < 80 ? 'medium' : 'large'

  return {
    relevantFiles,
    ignoredReasons,
    tentativeModules,
    detectedLanguages: Array.from(languageSet),
    estimatedSize,
  }
}

function extractImports(content, language) {
  const imports = []
  
  if (language === 'TypeScript' || language === 'JavaScript') {
    const importRegex = /import\s+(?:[\w*\s{},]+\s+from\s+)?['"]([^'"]+)['"]/g
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    let match
    while ((match = importRegex.exec(content)) !== null) imports.push(match[1])
    while ((match = requireRegex.exec(content)) !== null) imports.push(match[1])
  } else if (language === 'Python') {
    const importRegex = /^(?:from\s+(\S+)\s+)?import\s+(\S+)/gm
    let match
    while ((match = importRegex.exec(content)) !== null) {
      if (match[1]) imports.push(match[1])
      imports.push(match[2])
    }
  } else if (language === 'Go') {
    const importRegex = /import\s+(?:"([^"]+)"|\(([\s\S]*?)\))/g
    let match
    while ((match = importRegex.exec(content)) !== null) {
      if (match[1]) imports.push(match[1])
      else if (match[2]) {
        const subImports = match[2].match(/"([^"]+)"/g)
        if (subImports) imports.push(...subImports.map(s => s.slice(1, -1)))
      }
    }
  } else if (language === 'Rust') {
    const useRegex = /use\s+([\w:{}*,\s]+);/g
    let match
    while ((match = useRegex.exec(content)) !== null) {
      imports.push(...match[1].split(/[,{}]/).map(s => s.trim()).filter(Boolean))
    }
  } else if (language === 'Java') {
    const importRegex = /import\s+([\w.]+);/g
    let match
    while ((match = importRegex.exec(content)) !== null) imports.push(match[1])
  } else if (language === 'C++' || language === 'C') {
    const includeRegex = /#include\s*[<"]([^>"]+)[>"]/g
    let match
    while ((match = includeRegex.exec(content)) !== null) imports.push(match[1])
  } else if (language === 'C#') {
    const usingRegex = /using\s+([\w.]+);/g
    let match
    while ((match = usingRegex.exec(content)) !== null) imports.push(match[1])
  }
  
  return [...new Set(imports)]
}

function extractDefinitions(content, language) {
  const defs = []
  
  if (language === 'TypeScript' || language === 'JavaScript') {
    const classRegex = /(?:export\s+)?class\s+(\w+)/g
    const interfaceRegex = /(?:export\s+)?interface\s+(\w+)/g
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g
    const constRegex = /(?:export\s+)?const\s+(\w+)\s*=/g
    let match
    while ((match = classRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'class' })
    while ((match = interfaceRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'interface' })
    while ((match = functionRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'function' })
    while ((match = constRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'const' })
  } else if (language === 'Python') {
    const classRegex = /^class\s+(\w+)/gm
    const functionRegex = /^def\s+(\w+)/gm
    let match
    while ((match = classRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'class' })
    while ((match = functionRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'function' })
  } else if (language === 'Go') {
    const funcRegex = /func\s+(?:\(\w+\s+\w+\)\s+)?(\w+)/g
    const typeRegex = /type\s+(\w+)\s+(?:struct|interface)/g
    let match
    while ((match = funcRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'function' })
    while ((match = typeRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'type' })
  } else if (language === 'Rust') {
    const structRegex = /struct\s+(\w+)/g
    const enumRegex = /enum\s+(\w+)/g
    const fnRegex = /fn\s+(\w+)/g
    const traitRegex = /trait\s+(\w+)/g
    let match
    while ((match = structRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'struct' })
    while ((match = enumRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'enum' })
    while ((match = fnRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'function' })
    while ((match = traitRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'trait' })
  } else if (language === 'Java') {
    const classRegex = /(?:public\s+)?class\s+(\w+)/g
    const interfaceRegex = /interface\s+(\w+)/g
    const methodRegex = /(?:public|private|protected)?\s+(?:static\s+)?\w+\s+(\w+)\s*\(/g
    let match
    while ((match = classRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'class' })
    while ((match = interfaceRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'interface' })
    while ((match = methodRegex.exec(content)) !== null) defs.push({ name: match[1], type: 'method' })
  }
  
  return defs
}

async function readFileContent(filePath) {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

function buildNodesFromModules(tentativeModules, fileContents) {
  const nodes = []
  const layerMap = new Map()

  for (const mod of tentativeModules) {
    const layerName = mod.label.toLowerCase().replace(/\s+/g, '_')
    const layerId = `layer__${layerName}`
    
    if (!layerMap.has(layerId)) {
      layerMap.set(layerId, layerId)
      nodes.push({
        id: layerId,
        label: mod.label,
        type: 'layer',
        parentId: null,
        depth: 0,
        files: [],
        metadata: {},
      })
    }

    const moduleNode = {
      id: mod.id,
      label: mod.label,
      type: 'module',
      parentId: layerId,
      depth: 1,
      files: mod.filePaths,
      metadata: {},
    }
    nodes.push(moduleNode)

    for (const filePath of mod.filePaths) {
      const content = fileContents.get(filePath) || ''
      const language = getLanguage(filePath)
      const defs = extractDefinitions(content, language)
      const lineCount = content.split('\n').length
      
      let complexity = 'low'
      if (lineCount > 500) complexity = 'high'
      else if (lineCount > 200) complexity = 'medium'

      const fileNode = {
        id: `file__${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`,
        label: basename(filePath),
        type: 'file',
        parentId: mod.id,
        depth: 2,
        files: [filePath],
        metadata: { language, lineCount, complexity },
      }
      nodes.push(fileNode)

      for (const def of defs.slice(0, 10)) {
        const compNode = {
          id: `component__${mod.id}__${def.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
          label: def.name,
          type: 'component',
          parentId: fileNode.id,
          depth: 3,
          files: [filePath],
          metadata: { language, complexity: 'low' },
        }
        nodes.push(compNode)
      }
    }
  }

  return nodes
}

function buildEdges(nodes, fileContents) {
  const edges = []
  const nodeByFile = new Map()
  const nodeById = new Map()

  for (const node of nodes) {
    nodeById.set(node.id, node)
    for (const file of node.files) {
      nodeByFile.set(file, node.id)
    }
  }

  for (const node of nodes) {
    if (node.type !== 'file' && node.type !== 'component') continue
    
    const filePath = node.files[0]
    if (!filePath) continue
    
    const content = fileContents.get(filePath) || ''
    const language = getLanguage(filePath)
    const imports = extractImports(content, language)

    for (const imp of imports) {
      let targetId = null
      
      for (const [otherFile, otherNodeId] of nodeByFile.entries()) {
        if (otherFile === filePath) continue
        const otherContent = fileContents.get(otherFile) || ''
        const otherLanguage = getLanguage(otherFile)
        const defs = extractDefinitions(otherContent, otherLanguage)
        
        const matches = defs.some(d => 
          imp.includes(d.name) || d.name.includes(imp) || 
          otherFile.includes(imp.replace(/\./g, '/')) ||
          imp.includes(otherFile.replace(/\//g, '.').replace(/\.(ts|js|py|go|rs|java)$/, ''))
        )
        
        if (matches) {
          targetId = otherNodeId
          break
        }
      }

      if (targetId && targetId !== node.id) {
        const edgeId = `edge__${node.id}__${targetId}`
        if (!edges.some(e => e.id === edgeId)) {
          edges.push({
            id: edgeId,
            source: node.id,
            target: targetId,
            edgeType: 'engineering',
            strength: 3,
            label: 'imports',
            confidence: 'high',
          })
        }
      }
    }
  }

  for (const node of nodes) {
    if (node.parentId && node.type !== 'layer') {
      const edgeId = `edge__${node.parentId}__${node.id}`
      if (!edges.some(e => e.id === edgeId)) {
        edges.push({
          id: edgeId,
          source: node.parentId,
          target: node.id,
          edgeType: 'architecture',
          strength: 5,
          label: 'contains',
          confidence: 'high',
        })
      }
    }
  }

  return edges
}

function detectRole(nodeId, label, files) {
  const labelLower = label.toLowerCase()
  const fileStr = files.join(' ').toLowerCase()
  const combined = `${labelLower} ${fileStr}`

  if (combined.includes('auth') || combined.includes('login') || combined.includes('session') || combined.includes('jwt') || combined.includes('oauth')) return 'authentication'
  if (combined.includes('database') || combined.includes('db') || combined.includes('repository') || combined.includes('orm') || combined.includes('model') || combined.includes('entity')) return 'data_access'
  if (combined.includes('api') || combined.includes('controller') || combined.includes('route') || combined.includes('endpoint') || combined.includes('handler')) return 'api_gateway'
  if (combined.includes('service') || combined.includes('business') || combined.includes('logic') || combined.includes('use_case') || combined.includes('usecase')) return 'business_logic'
  if (combined.includes('ui') || combined.includes('view') || combined.includes('component') || combined.includes('page') || combined.includes('screen') || combined.includes('frontend')) return 'presentation'
  if (combined.includes('config') || combined.includes('setting') || combined.includes('env') || combined.includes('constant')) return 'configuration'
  if (combined.includes('util') || combined.includes('helper') || combined.includes('common') || combined.includes('shared')) return 'utility'
  if (combined.includes('test') || combined.includes('spec') || combined.includes('mock')) return 'testing'
  if (combined.includes('middleware') || combined.includes('interceptor') || combined.includes('filter')) return 'middleware'
  if (combined.includes('event') || combined.includes('message') || combined.includes('queue') || combined.includes('pubsub')) return 'messaging'
  if (combined.includes('cache') || combined.includes('redis') || combined.includes('memory')) return 'caching'
  if (combined.includes('worker') || combined.includes('job') || combined.includes('task') || combined.includes('cron') || combined.includes('scheduler')) return 'background_jobs'
  if (combined.includes('security') || combined.includes('encrypt') || combined.includes('hash') || combined.includes('crypto')) return 'security'
  if (combined.includes('log') || combined.includes('monitor') || combined.includes('metric') || combined.includes('trace')) return 'observability'
  if (combined.includes('migration') || combined.includes('seed') || combined.includes('schema')) return 'database_migration'
  
  return 'unknown'
}

function detectPatterns(nodeId, label, files, fileContents) {
  const patterns = []
  const labelLower = label.toLowerCase()
  const fileStr = files.join(' ').toLowerCase()
  const combined = `${labelLower} ${fileStr}`

  for (const file of files) {
    const content = fileContents.get(file) || ''
    const contentLower = content.toLowerCase()
    
    if (contentLower.includes('repository') && (contentLower.includes('interface') || contentLower.includes('implement'))) {
      if (!patterns.includes('repository_pattern')) patterns.push('repository_pattern')
    }
    if (contentLower.includes('factory') && (contentLower.includes('create') || contentLower.includes('build'))) {
      if (!patterns.includes('factory_pattern')) patterns.push('factory_pattern')
    }
    if (contentLower.includes('singleton') || (contentLower.includes('instance') && contentLower.includes('getinstance'))) {
      if (!patterns.includes('singleton_pattern')) patterns.push('singleton_pattern')
    }
    if (contentLower.includes('observer') || contentLower.includes('subscribe') || contentLower.includes('eventemitter')) {
      if (!patterns.includes('observer_pattern')) patterns.push('observer_pattern')
    }
    if (contentLower.includes('strategy') && contentLower.includes('interface')) {
      if (!patterns.includes('strategy_pattern')) patterns.push('strategy_pattern')
    }
    if (contentLower.includes('decorator') || contentLower.includes('@decorator') || contentLower.includes('wrap')) {
      if (!patterns.includes('decorator_pattern')) patterns.push('decorator_pattern')
    }
    if (contentLower.includes('adapter') && (contentLower.includes('implement') || contentLower.includes('interface'))) {
      if (!patterns.includes('adapter_pattern')) patterns.push('adapter_pattern')
    }
    if (contentLower.includes('dependency') && contentLower.includes('inject')) {
      if (!patterns.includes('dependency_injection')) patterns.push('dependency_injection')
    }
    if (contentLower.includes('command') && contentLower.includes('execute')) {
      if (!patterns.includes('command_pattern')) patterns.push('command_pattern')
    }
    if (contentLower.includes('middleware') || (contentLower.includes('next') && contentLower.includes('handler'))) {
      if (!patterns.includes('middleware_pattern')) patterns.push('middleware_pattern')
    }
  }

  return patterns
}

function detectArchitecturalPattern(nodes, edges) {
  const layerNodes = nodes.filter(n => n.type === 'layer')
  const moduleNodes = nodes.filter(n => n.type === 'module')
  
  const layerLabels = layerNodes.map(n => n.label.toLowerCase())
  const moduleLabels = moduleNodes.map(n => n.label.toLowerCase())

  const hasCleanArch = layerLabels.some(l => l.includes('domain') || l.includes('entity') || l.includes('usecase')) &&
                       layerLabels.some(l => l.includes('interface') || l.includes('adapter') || l.includes('presenter')) &&
                       layerLabels.some(l => l.includes('framework') || l.includes('infrastructure') || l.includes('external'))
  
  const hasHexagonal = layerLabels.some(l => l.includes('port') || l.includes('adapter')) &&
                       layerLabels.some(l => l.includes('domain') || l.includes('core'))
  
  const hasMVC = moduleLabels.some(m => m.includes('model')) &&
                 moduleLabels.some(m => m.includes('view') || m.includes('ui') || m.includes('presenter')) &&
                 moduleLabels.some(m => m.includes('controller') || m.includes('handler'))
  
  const hasLayered = layerLabels.length >= 3 &&
                     (layerLabels.some(l => l.includes('presentation') || l.includes('ui') || l.includes('api')) &&
                      layerLabels.some(l => l.includes('service') || l.includes('business') || l.includes('logic')) &&
                      layerLabels.some(l => l.includes('data') || l.includes('repository') || l.includes('db')))
  
  const hasFeatureModules = moduleNodes.length > 5 &&
                            moduleNodes.every(m => m.files.length > 0) &&
                            !hasCleanArch && !hasHexagonal && !hasMVC && !hasLayered
  
  const hasMicroservices = moduleNodes.length > 3 &&
                           moduleNodes.some(m => m.label.toLowerCase().includes('service')) &&
                           edges.filter(e => e.edgeType === 'architecture').length > edges.length * 0.3
  
  const hasPipeline = moduleLabels.some(m => m.includes('etl') || m.includes('pipeline') || m.includes('stream') || m.includes('process')) &&
                      edges.some(e => e.label?.includes('flow') || e.label?.includes('pipe'))

  if (hasCleanArch) return { pattern: 'clean_architecture', confidence: 0.85, layout: 'concentric_rings' }
  if (hasHexagonal) return { pattern: 'hexagonal', confidence: 0.8, layout: 'concentric_rings' }
  if (hasMVC) return { pattern: 'mvc', confidence: 0.8, layout: 'horizontal_three_column' }
  if (hasMicroservices) return { pattern: 'microservices', confidence: 0.75, layout: 'cluster' }
  if (hasLayered) return { pattern: 'layered_monolith', confidence: 0.75, layout: 'vertical_layers' }
  if (hasFeatureModules) return { pattern: 'feature_modules', confidence: 0.7, layout: 'grid_clusters' }
  if (hasPipeline) return { pattern: 'pipeline_etl', confidence: 0.7, layout: 'left_right_flow' }
  
  return { pattern: 'unknown', confidence: 0.3, layout: 'force_directed' }
}

function hashFileTree(paths) {
  const sorted = [...paths].sort().join('|')
  let hash = 0
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16)
}

export async function analyzeRepository(input) {
  const { repoUrl, localPath, githubToken, resumeFrom, outputFile } = input
  
  let fileTree
  let fetchFileContent
  let repoName
  let rootPath

  if (localPath) {
    rootPath = resolve(localPath)
    repoName = basename(rootPath)
    fileTree = await getLocalFileTree(rootPath)
    fetchFileContent = async (path) => readFileContent(join(rootPath, path))
  } else if (repoUrl) {
    const parsed = parseGithubUrl(repoUrl)
    if (!parsed) throw new Error('Invalid GitHub URL format')
    const { owner, repo } = parsed
    repoName = `${owner}/${repo}`
    fileTree = await fetchFileTree(owner, repo, githubToken)
    const fetchGhContent = async (path) => fetchGitHubFileContent(owner, repo, path, githubToken)
    fetchFileContent = fetchGhContent
    rootPath = ''
  } else {
    throw new Error('Either repoUrl or localPath must be provided')
  }

  const analysisVersion = hashFileTree(fileTree)
  const analyzedAt = new Date().toISOString()

  if (resumeFrom && hashFileTree(resumeFrom.fileTree) !== analysisVersion) {
    throw new Error('Saved progress is outdated because the repository file tree changed. Start a new analysis.')
  }

  let pass1
  let fileContents = new Map()

  if (resumeFrom && resumeFrom.pass1) {
    pass1 = resumeFrom.pass1
  } else {
    pass1 = analyzeFileStructure(fileTree, rootPath)
  }

  if (resumeFrom && resumeFrom.fileContents) {
    for (const [path, content] of Object.entries(resumeFrom.fileContents)) {
      fileContents.set(path, content)
    }
  } else {
    for (const path of pass1.relevantFiles) {
      const content = await fetchFileContent(path)
      fileContents.set(path, content)
    }
  }

  const nodes = buildNodesFromModules(pass1.tentativeModules, fileContents)
  const edges = buildEdges(nodes, fileContents)

  const nodesWithRoles = nodes.map(node => ({
    ...node,
    detectedRole: detectRole(node.id, node.label, node.files),
    patterns: detectPatterns(node.id, node.label, node.files, fileContents),
  }))

  const { pattern, confidence, layout } = detectArchitecturalPattern(nodesWithRoles, edges)

  const meta = {
    repoUrl: repoUrl || `local://${repoName}`,
    repoName,
    analysisVersion,
    analyzedAt,
    detectedPattern: pattern,
    layoutTemplate: layout,
    patternConfidence: confidence,
  }

  const overlay = {
    version: 0,
    nodeOverrides: {},
    edgeOverrides: {},
    manualNodes: [],
    manualEdges: [],
  }

  const graph = { meta, nodes: nodesWithRoles, edges, overlay }

  if (outputFile) {
    writeFileSync(outputFile, JSON.stringify(graph, null, 2))
    console.log(`[analyzer] Graph written to ${outputFile}`)
  }

  return graph
}
