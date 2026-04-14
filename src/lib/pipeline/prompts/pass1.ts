export function buildPass1Prompt(repoName: string, fileTree: string): string {
  return `You are analyzing the file tree of a software repository to identify its architectural structure.

REPOSITORY: ${repoName}
FILE TREE:
${fileTree}

Your tasks:

1. Identify which files are architecturally relevant. Exclude: tests, build artifacts, generated files, lockfiles, assets, and configuration files that don't reveal architecture (e.g. .eslintrc, .prettierrc, package-lock.json, *.min.js, dist/, .next/, __pycache__, *.pyc).

2. Group relevant files into logical modules. A module is a cohesive set of files with a single architectural responsibility.

3. List all programming languages detected.

4. Estimate repository size based on relevant file count:
   - small: under 20 relevant files
   - medium: 20–80 relevant files
   - large: over 80 relevant files

Respond with ONLY a JSON object with this EXACT structure — no other fields, no renaming:

{
  "relevantFiles": ["path/to/file.py", "path/to/other.py"],
  "ignoredReasons": {
    "path/to/ignored.pyc": "Python bytecode",
    "path/to/lockfile": "lockfile"
  },
  "tentativeModules": [
    {
      "id": "module__authentication",
      "label": "Authentication",
      "filePaths": ["path/to/auth.py"],
      "description": "Handles user login and session management"
    }
  ],
  "detectedLanguages": ["Python"],
  "estimatedSize": "small"
}

IMPORTANT:
- Use exactly these field names: relevantFiles, ignoredReasons, tentativeModules, detectedLanguages, estimatedSize
- tentativeModules items must have: id (starting with "module__"), label, filePaths, description
- ignoredReasons must be an object (key = file path, value = reason string), NOT an array
- estimatedSize must be exactly "small", "medium", or "large"`
}

export function formatFileTree(paths: string[]): string {
  return paths.sort().join('\n')
}