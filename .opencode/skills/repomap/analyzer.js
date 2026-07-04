import { glob } from 'glob'
import { readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative, resolve, extname, basename, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// ── Config ──────────────────────────────────────────────────

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
const MAX_FILE_SIZE = 500 * 1024 // 500KB - skip huge files
const BATCH_SIZE = 50 // Process files in batches to avoid blocking

// Pre-compiled ignore patterns for O(1) matching
const IGNORE_PATTERNS = [
  'node_modules', 'dist', 'build', '.next', '.git', 'target', '__pycache__',
  '.pyc', '.min.js', '.min.css', 'coverage', '.nyc_output', 'vendor',
  'bower_components', '.lock', 'package-lock.json', 'yarn.lock',
  'pnpm-lock.yaml', 'Cargo.lock', 'go.sum', 'poetry.lock', 'Pipfile.lock',
  '.eslintrc', '.prettierrc', 'tsconfig.json', 'jest.config', 'vitest.config',
  '.test.', '.spec.', '__tests__', '__mocks__', '.d.ts', '.DS_Store',
]
const IGNORE_REGEXES = IGNORE_PATTERNS.map(p => {
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*')
  return new RegExp(escaped, 'i')
})

// ── Project root detection ──────────────────────────────────

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

// ── Optimized file filtering ────────────────────────────────

function getLanguage(filePath) {
  const ext = extname(filePath).toLowerCase()
  return LANGUAGE_EXTENSIONS[ext] || 'Unknown'
}

function shouldIgnore(filePath) {
  const lower = filePath.toLowerCase()
  for (const re of IGNORE_REGEXES) {
    if (re.test(lower)) return true
  }
  return false
}

function loadGitIgnorePatterns(rootPath) {
  const patterns = []
  try {
    const content = readFileSync(join(rootPath, '.gitignore'), 'utf-8')
    for (const line of content.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#') || t.startsWith('!')) continue
      let p = t
      if (p.endsWith('/')) p += '**'
      if (p.startsWith('/')) p = p.slice(1)
      else p = '**/' + p
      patterns.push(p)
    }
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

// ── GitHub API (no octokit) ─────────────────────────────────

function parseGithubUrl(url) {
  const match = url
    .trim()
    .match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(\/.*)?$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

async function fetchFileTree(owner, repo, token) {
  const headers = { Accept: 'application/vnd.github.v3+json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

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

async function fetchGitHubFileContent(owner, repo, path, token) {
  const headers = { Accept: 'application/vnd.github.v3+json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers })
  if (!res.ok) throw new Error(`GitHub API error fetching ${path}: ${res.status} ${res.statusText}`)

  const data = await res.json()
  if (Array.isArray(data)) throw new Error(`Path "${path}" is a directory.`)
  if (data.type !== 'file') throw new Error(`Path "${path}" is not a regular file.`)
  if (!data.content || typeof data.content !== 'string') throw new Error(`No content returned for "${path}".`)

  const cleaned = data.content.replace(/\n/g, '')
  return Buffer.from(cleaned, 'base64').toString('utf-8')
}

// ── Import/Definition extraction ────────────────────────────

// Cache compiled regexes per language
const IMPORT_REGEX_CACHE = new Map()
const DEF_REGEX_CACHE = new Map()

function getImportRegex(language) {
  if (IMPORT_REGEX_CACHE.has(language)) return IMPORT_REGEX_CACHE.get(language)
  let regexes
  if (language === 'TypeScript' || language === 'JavaScript') {
    regexes = [
      /import\s+(?:[\w*\s{},]+\s+from\s+)?['"]([^'"]+)['"]/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ]
  } else if (language === 'Python') {
    regexes = [/^(?:from\s+(\S+)\s+)?import\s+(\S+)/gm]
  } else if (language === 'Go') {
    regexes = [/import\s+(?:"([^"]+)"|\(([\s\S]*?)\))/g]
  } else if (language === 'Rust') {
    regexes = [/use\s+([\w:{}*,\s]+);/g]
  } else if (language === 'Java') {
    regexes = [/import\s+([\w.]+);/g]
  } else if (language === 'C++' || language === 'C') {
    regexes = [/#include\s*[<"]([^>"]+)[>"]/g]
  } else if (language === 'C#') {
    regexes = [/using\s+([\w.]+);/g]
  } else {
    regexes = []
  }
  IMPORT_REGEX_CACHE.set(language, regexes)
  return regexes
}

function getDefRegex(language) {
  if (DEF_REGEX_CACHE.has(language)) return DEF_REGEX_CACHE.get(language)
  let regexes
  if (language === 'TypeScript' || language === 'JavaScript') {
    regexes = [
      { re: /(?:export\s+)?class\s+(\w+)/g, type: 'class' },
      { re: /(?:export\s+)?interface\s+(\w+)/g, type: 'interface' },
      { re: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, type: 'function' },
      { re: /(?:export\s+)?const\s+(\w+)\s*=/g, type: 'const' },
    ]
  } else if (language === 'Python') {
    regexes = [
      { re: /^class\s+(\w+)/gm, type: 'class' },
      { re: /^def\s+(\w+)/gm, type: 'function' },
    ]
  } else if (language === 'Go') {
    regexes = [
      { re: /func\s+(?:\(\w+\s+\w+\)\s+)?(\w+)/g, type: 'function' },
      { re: /type\s+(\w+)\s+(?:struct|interface)/g, type: 'type' },
    ]
  } else if (language === 'Rust') {
    regexes = [
      { re: /struct\s+(\w+)/g, type: 'struct' },
      { re: /enum\s+(\w+)/g, type: 'enum' },
      { re: /fn\s+(\w+)/g, type: 'function' },
      { re: /trait\s+(\w+)/g, type: 'trait' },
    ]
  } else if (language === 'Java') {
    regexes = [
      { re: /(?:public\s+)?class\s+(\w+)/g, type: 'class' },
      { re: /interface\s+(\w+)/g, type: 'interface' },
      { re: /(?:public|private|protected)?\s+(?:static\s+)?\w+\s+(\w+)\s*\(/g, type: 'method' },
    ]
  } else {
    regexes = []
  }
  DEF_REGEX_CACHE.set(language, regexes)
  return regexes
}

function extractImports(content, language) {
  const imports = []
  const regexes = getImportRegex(language)
  
  if (language === 'Python') {
    const re = regexes[0]
    re.lastIndex = 0
    let match
    while ((match = re.exec(content)) !== null) {
      if (match[1]) imports.push(match[1])
      imports.push(match[2])
    }
  } else if (language === 'Go') {
    const re = regexes[0]
    re.lastIndex = 0
    let match
    while ((match = re.exec(content)) !== null) {
      if (match[1]) imports.push(match[1])
      else if (match[2]) {
        const subImports = match[2].match(/"([^"]+)"/g)
        if (subImports) imports.push(...subImports.map(s => s.slice(1, -1)))
      }
    }
  } else if (language === 'Rust') {
    const re = regexes[0]
    re.lastIndex = 0
    let match
    while ((match = re.exec(content)) !== null) {
      imports.push(...match[1].split(/[,{}]/).map(s => s.trim()).filter(Boolean))
    }
  } else {
    for (const re of regexes) {
      re.lastIndex = 0
      let match
      while ((match = re.exec(content)) !== null) {
        imports.push(match[1])
      }
    }
  }
  
  return [...new Set(imports)]
}

function extractDefinitions(content, language) {
  const defs = []
  const regexes = getDefRegex(language)
  for (const { re, type } of regexes) {
    re.lastIndex = 0
    let match
    while ((match = re.exec(content)) !== null) {
      defs.push({ name: match[1], type })
    }
  }
  return defs
}

// ── Optimized node/edge building ────────────────────────────

// Build a definition index: Map<defName, Set<filePath>> for O(1) lookup
function buildDefinitionIndex(fileContents) {
  const index = new Map()
  for (const [filePath, content] of fileContents) {
    if (!content) continue
    const language = getLanguage(filePath)
    const defs = extractDefinitions(content, language)
    for (const def of defs) {
      if (!index.has(def.name)) {
        index.set(def.name, new Set())
      }
      index.get(def.name).add(filePath)
    }
  }
  return index
}

// Resolve an import to target file paths using the definition index
function resolveImport(imp, defIndex, currentFile) {
  // Try exact definition name match
  const exact = defIndex.get(imp.split('/').pop().split('.').pop())
  if (exact) {
    for (const file of exact) {
      if (file !== currentFile) return file
    }
  }
  
  // Try path-based resolution
  const impPath = imp.replace(/\./g, '/')
  for (const [defName, files] of defIndex) {
    if (imp.includes(defName) || defName.includes(imp)) {
      for (const file of files) {
        if (file !== currentFile) return file
      }
    }
    if (impPath && fileIncludesImp(imp, file)) {
      for (const file of files) {
        if (file !== currentFile && file.includes(impPath)) return file
      }
    }
  }
  return null
}

function fileIncludesImp(imp, filePath) {
  const normalized = imp.replace(/\./g, '/')
  return filePath.includes(normalized)
}

function analyzeFileStructure(filePaths, rootPath) {
  const projectRoots = findProjectRoots(filePaths)
  const relevantFiles = []
  const ignoredReasons = {}
  const languageSet = new Set()
  const moduleMap = new Map()

  for (const filePath of filePaths) {
    const language = getLanguage(filePath)
    if (language !== 'Unknown') languageSet.add(language)

    if (shouldIgnore(filePath)) {
      ignoredReasons[filePath] = 'Ignored pattern'
      continue
    }

    relevantFiles.push(filePath)
    const { layerId, layerLabel, moduleId, moduleLabel } = assignLayerModule(filePath, projectRoots)

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

async function readFileContent(filePath) {
  try {
    const stats = statSync(filePath)
    if (stats.size > MAX_FILE_SIZE) {
      console.warn(`[analyzer] Skipping large file ${filePath} (${(stats.size / 1024).toFixed(0)}KB)`)
      return ''
    }
    return readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

// Batch-process async operations to avoid blocking
async function batchProcess(items, processor, batchSize = BATCH_SIZE) {
  const results = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(processor))
    results.push(...batchResults)
    // Yield to event loop between batches
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, 0))
    }
  }
  return results
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
      const lineCount = content ? content.split('\n').length : 0
      
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
    }
  }

  return nodes
}

function buildEdgesOptimized(nodes, fileContents) {
  const edges = []
  const edgeSet = new Set() // O(1) deduplication
  const nodeByFile = new Map()
  const nodeById = new Map()

  for (const node of nodes) {
    nodeById.set(node.id, node)
    for (const file of node.files) {
      nodeByFile.set(file, node.id)
    }
  }

  // Build definition index for O(1) import resolution
  const defIndex = buildDefinitionIndex(fileContents)

  for (const node of nodes) {
    if (node.type !== 'file' && node.type !== 'component') continue
    
    const filePath = node.files[0]
    if (!filePath) continue
    
    const content = fileContents.get(filePath) || ''
    if (!content) continue
    
    const language = getLanguage(filePath)
    const imports = extractImports(content, language)

    for (const imp of imports) {
      // O(1) lookup via definition index instead of O(n) scan
      const targetFile = resolveImport(imp, defIndex, filePath)
      const targetId = targetFile ? nodeByFile.get(targetFile) : null

      if (targetId && targetId !== node.id) {
        const edgeId = `edge__${node.id}__${targetId}`
        if (!edgeSet.has(edgeId)) {
          edgeSet.add(edgeId)
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

  // Architecture edges (parent-child)
  for (const node of nodes) {
    if (node.parentId && node.type !== 'layer') {
      const edgeId = `edge__${node.parentId}__${node.id}`
      if (!edgeSet.has(edgeId)) {
        edgeSet.add(edgeId)
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

// ── Main entry point ────────────────────────────────────────

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
    // Batch process file reading to avoid blocking
    const fileList = pass1.relevantFiles
    console.log(`[analyzer] Reading ${fileList.length} files in batches of ${BATCH_SIZE}...`)
    
    await batchProcess(fileList, async (path) => {
      const content = await fetchFileContent(path)
      return { path, content }
    })
    
    // Actually populate the Map
    const results = await batchProcess(fileList, async (path) => {
      const content = await fetchFileContent(path)
      return { path, content }
    })
    
    for (const { path, content } of results) {
      fileContents.set(path, content)
    }
  }

  const nodes = buildNodesFromModules(pass1.tentativeModules, fileContents)
  console.log(`[analyzer] Built ${nodes.length} nodes, resolving edges with indexed definitions...`)
  
  const edges = buildEdgesOptimized(nodes, fileContents)
  console.log(`[analyzer] Built ${edges.length} edges`)

  // Build file-level data
  const fileData = {}
  for (const filePath of pass1.relevantFiles) {
    const content = fileContents.get(filePath) || ''
    const language = getLanguage(filePath)
    fileData[filePath] = {
      language,
      lineCount: content.split('\n').length,
      imports: extractImports(content, language),
      definitions: extractDefinitions(content, language),
    }
  }

  const raw = {
    meta: {
      repoUrl: repoUrl || `local://${repoName}`,
      repoName,
      analysisVersion,
      analyzedAt,
      estimatedSize: pass1.estimatedSize,
      languages: pass1.detectedLanguages,
      totalFiles: pass1.relevantFiles.length,
      totalModules: pass1.tentativeModules.length,
    },
    modules: pass1.tentativeModules.map(mod => ({
      id: mod.id,
      label: mod.label,
      layerId: mod.layerId,
      layerLabel: mod.layerLabel,
      fileCount: mod.filePaths.length,
      filePaths: mod.filePaths,
    })),
    fileData,
    nodes,
    edges,
  }

  if (outputFile) {
    writeFileSync(outputFile, JSON.stringify(raw, null, 2))
    console.log(`[analyzer] Raw analysis written to ${outputFile}`)
  }

  return raw
}