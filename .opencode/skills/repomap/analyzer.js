import { glob } from 'glob'
import { readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative, resolve, extname, basename, dirname } from 'path'
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

const PROJECT_MARKERS = [
  'package.json', 'requirements.txt', 'pyproject.toml',
  'setup.py', 'go.mod', 'Cargo.toml', 'Gemfile', 'composer.json',
  'pom.xml', 'build.gradle', 'build.sbt',
]


const ENTRY_POINTS = new Set(['main.py', 'app.py', 'manage.py', 'index.js', 'index.ts', 'app.js', 'app.ts', 'main.js', 'main.ts'])
const MAX_ENTRY_DEPTH = 2

function findProjectRoots(filePaths) {
  const dirSet = new Set()
  dirSet.add('')

  for (const fp of filePaths) {
    const base = basename(fp)
    const dir = dirname(fp).replace(/\\/g, '/')
    const cleanDir = dir === '.' ? '' : dir

    if (PROJECT_MARKERS.includes(base)) {
      dirSet.add(cleanDir)
    } else if (ENTRY_POINTS.has(base)) {
      const depth = cleanDir ? cleanDir.split('/').length : 0
      if (depth <= MAX_ENTRY_DEPTH) dirSet.add(cleanDir)
    }
  }

  const hasDeeperFiles = new Map()
  for (const fp of filePaths) {
    const depth = fp.split('/').length - 1
    for (const r of dirSet) {
      if (r !== '' && fp.startsWith(r + '/')) {
        const rd = r.split('/').length
        if (depth >= rd + 2) hasDeeperFiles.set(r, true)
      }
    }
  }

  return Array.from(dirSet).filter(r => r === '' || hasDeeperFiles.has(r)).sort((a, b) => {
    const da = a === '' ? 0 : a.split('/').length
    const db = b === '' ? 0 : b.split('/').length
    return db - da
  })
}

function assignLayerModule(filePath, projectRoots) {
  const parts = filePath.split('/')
  parts.pop()
  let root = ''
  for (const r of projectRoots) {
    if (r === '' || filePath.startsWith(r + '/') || filePath === r) {
      root = r
      break
    }
  }
  const rootDepth = root === '' ? 0 : root.split('/').length
  const rel = rootDepth === 0 ? parts : parts.slice(rootDepth)

  if (rel.length === 0) {
    return { layerLabel: 'Root', layerId: 'layer__root', moduleLabel: 'Root', moduleId: 'module__root' }
  }
  if (rel.length === 1) {
    const n = rel[0]
    const label = n.charAt(0).toUpperCase() + n.slice(1)
    return { layerLabel: 'Root', layerId: 'layer__root', moduleLabel: label, moduleId: `module__${n.replace(/[^a-zA-Z0-9]/g, '_')}` }
  }
  const layer = rel[0]
  const mod = rel[1]
  const layerLabel = layer.charAt(0).toUpperCase() + layer.slice(1)
  const modLabel = mod.charAt(0).toUpperCase() + mod.slice(1)
  return {
    layerLabel,
    layerId: `layer__${layer.replace(/[^a-zA-Z0-9]/g, '_')}`,
    moduleLabel: modLabel,
    moduleId: `module__${layer}_${mod.replace(/[^a-zA-Z0-9]/g, '_')}`,
  }
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

function convertGitIgnoreToGlob(content) {
  const patterns = []
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('!')) continue
    let p = t
    if (p.endsWith('/')) p += '**'
    if (p.startsWith('/')) p = p.slice(1)
    else p = '**/' + p
    patterns.push(p)
  }
  return patterns
}

function getLanguage(filePath) {
  const ext = extname(filePath).toLowerCase()
  return LANGUAGE_EXTENSIONS[ext] || 'Unknown'
}

function shouldIgnore(filePath, rootPath, extraPatterns = []) {
  const relPath = relative(rootPath, filePath)
  const allPatterns = [...IGNORE_PATTERNS, ...extraPatterns]
  return allPatterns.some(pattern => {
    const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$')
    return regex.test(relPath) || regex.test(filePath)
  })
}

function loadGitIgnorePatterns(rootPath) {
  const patterns = []
  try {
    const content = readFileSync(join(rootPath, '.gitignore'), 'utf-8')
    patterns.push(...convertGitIgnoreToGlob(content))
  } catch {}
  return patterns
}

async function getLocalFileTree(rootPath) {
  const gitIgnorePatterns = loadGitIgnorePatterns(rootPath)
  const allIgnores = [...IGNORE_PATTERNS, ...gitIgnorePatterns]

  const files = await glob('**/*', {
    cwd: rootPath,
    nodir: true,
    dot: true,
    ignore: allIgnores,
    absolute: true,
  })
  return files.map(f => relative(rootPath, f).replace(/\\/g, '/')).sort()
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
  const projectRoots = findProjectRoots(filePaths)
  const gitIgnorePatterns = loadGitIgnorePatterns(rootPath)
  const relevantFiles = []
  const ignoredReasons = {}
  const languageSet = new Set()
  const moduleMap = new Map()

  for (const filePath of filePaths) {
    const fullPath = join(rootPath, filePath)
    const language = getLanguage(filePath)
    if (language !== 'Unknown') languageSet.add(language)

    if (shouldIgnore(fullPath, rootPath, gitIgnorePatterns)) {
      ignoredReasons[filePath] = 'Ignored pattern'
      continue
    }

    relevantFiles.push(filePath)
    const { layerId, layerLabel, moduleId, moduleLabel } = assignLayerModule(filePath, projectRoots)
    if (filePath.includes('easystork')) {
      console.log('DEBUG:', JSON.stringify(filePath), 'assign:', JSON.stringify(assignLayerModule(filePath, projectRoots)))
    }

    if (!moduleMap.has(moduleId)) {
      moduleMap.set(moduleId, {
        label: moduleLabel,
        filePaths: [],
        description: `${moduleLabel} module`,
        layerId,
        layerLabel,
      })
    }
    moduleMap.get(moduleId).filePaths.push(filePath)
  }

  const tentativeModules = Array.from(moduleMap.entries()).map(([id, data]) => ({
    id,
    label: data.label,
    filePaths: data.filePaths,
    description: data.description,
    layerId: data.layerId,
    layerLabel: data.layerLabel,
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
    const layerId = mod.layerId || `layer__${mod.label.toLowerCase().replace(/\s+/g, '_')}`
    const layerLabel = mod.layerLabel || mod.label
    
    if (!layerMap.has(layerId)) {
      layerMap.set(layerId, layerId)
      nodes.push({
        id: layerId,
        label: layerLabel,
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

function wordMatch(text, word) {
  const i = text.indexOf(word)
  if (i === -1) return false
  const before = i === 0 || /[^a-z0-9]/.test(text[i - 1])
  const after = i + word.length >= text.length || /[^a-z0-9]/.test(text[i + word.length])
  return before && after
}

function detectRole(nodeId, label, files) {
  const labelLower = label.toLowerCase()
  const fileStr = files.join(' ').toLowerCase()
  const combined = `${labelLower} ${fileStr}`

  const kw = (word) => word.length < 5 ? wordMatch(combined, word) : combined.includes(word)

  if (kw('auth') || kw('login') || kw('session') || kw('jwt') || kw('oauth')) return 'authentication'
  if (kw('database') || kw('db') || kw('repository') || kw('orm') || kw('model') || kw('entity')) return 'data_access'
  if (kw('api') || kw('controller') || kw('route') || kw('endpoint') || kw('handler')) return 'api_gateway'
  if (kw('service') || kw('business') || kw('logic') || kw('use_case') || kw('usecase') || kw('sync') || kw('syncer') || kw('synchronizer') || kw('engine')) return 'business_logic'
  if (kw('ui') || kw('view') || kw('component') || kw('page') || kw('screen') || kw('frontend')) return 'presentation'
  if (kw('config') || kw('setting') || kw('env') || kw('constant')) return 'configuration'
  if (kw('util') || kw('helper') || kw('common') || kw('shared')) return 'utility'
  if (kw('test') || kw('spec') || kw('mock')) return 'testing'
  if (kw('middleware') || kw('interceptor') || kw('filter')) return 'middleware'
  if (kw('event') || kw('message') || kw('queue') || kw('pubsub')) return 'messaging'
  if (kw('cache') || kw('redis') || kw('memory')) return 'caching'
  if (kw('worker') || kw('job') || kw('task') || kw('cron') || kw('scheduler')) return 'background_jobs'
  if (kw('security') || kw('encrypt') || kw('hash') || kw('crypto')) return 'security'
  if (kw('log') || kw('monitor') || kw('metric') || kw('trace')) return 'observability'
  if (kw('migration') || kw('seed') || kw('schema')) return 'database_migration'
  
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
  const moduleRoles = moduleNodes.map(n => n.detectedRole || 'unknown')

  const hasCleanArch = layerLabels.some(l => l.includes('domain') || l.includes('entity') || l.includes('usecase')) &&
                       layerLabels.some(l => l.includes('interface') || l.includes('adapter') || l.includes('presenter')) &&
                       layerLabels.some(l => l.includes('framework') || l.includes('infrastructure') || l.includes('external'))
  
  const hasHexagonal = layerLabels.some(l => l.includes('port') || l.includes('adapter')) &&
                       layerLabels.some(l => l.includes('domain') || l.includes('core'))
  
  const hasMVC = moduleLabels.some(m => m.includes('model')) &&
                 moduleLabels.some(m => m.includes('view') || m.includes('ui') || m.includes('presenter')) &&
                 moduleLabels.some(m => m.includes('controller') || m.includes('handler'))

  const hasPresentationLayer = layerLabels.some(l => l.includes('presentation') || l.includes('ui') || l.includes('api')) ||
                               moduleLabels.some(m => m.includes('presentation') || m.includes('ui') || m.includes('api')) ||
                               moduleRoles.some(r => r === 'presentation' || r === 'api_gateway') ||
                               moduleNodes.some(m => m.files.some(function(f) {
                                 const base = (f.split('/').pop() || '').toLowerCase()
                                 return base.includes('page') || base.includes('component') || base.includes('layout') || base.includes('route')
                               }))
  const hasServiceLayer = layerLabels.some(l => l.includes('service') || l.includes('business') || l.includes('logic') || l.includes('sync')) ||
                          moduleLabels.some(m => m.includes('service') || m.includes('business') || m.includes('logic') || m.includes('sync') || m.includes('core')) ||
                          moduleRoles.some(r => r === 'business_logic') ||
                          moduleNodes.some(m => m.files.some(function(f) {
                            const base = (f.split('/').pop() || '').toLowerCase()
                            return base.includes('sync') || base.includes('service') || base.includes('business') || base.includes('logic')
                          }))
  const hasDataLayer = layerLabels.some(l => l.includes('data') || l.includes('repository') || l.includes('database') || l.includes('db')) ||
                       moduleLabels.some(m => m.includes('data') || m.includes('repository') || m.includes('database') || m.includes('db') || m.includes('model')) ||
                       moduleRoles.some(r => r === 'data_access') ||
                       moduleNodes.some(m => m.files.some(function(f) {
                         const base = (f.split('/').pop() || '').toLowerCase()
                         return base.includes('db') || base.includes('database') || base.includes('sql') || base.includes('repository') || base.includes('model') || base.includes('entity')
                       }))
  
  const hasLayered = (layerLabels.length >= 2) && hasPresentationLayer && hasServiceLayer && hasDataLayer
  
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
  if (hasLayered) return { pattern: 'layered_monolith', confidence: 0.75, layout: 'vertical_layers' }
  if (hasMicroservices) return { pattern: 'microservices', confidence: 0.75, layout: 'cluster' }
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
