export function buildPass1Prompt(repoName: string, fileTree: string): string {
  return `You are analyzing the file tree of a software repository to identify its architectural structure.

REPOSITORY: ${repoName}
FILE TREE:
${fileTree}

Your tasks:

1. Identify which files are architecturally relevant. Exclude: tests, build artifacts, generated files, lockfiles, assets, and configuration files that don't reveal architecture (e.g. .eslintrc, .prettierrc, package-lock.json, *.min.js, dist/, .next/).

2. Group relevant files into logical modules. A module is a cohesive set of files with a single architectural responsibility. Use your understanding of the codebase's domain, not just folder structure — files in different folders may belong to the same module.

3. Assign each module an id following this format: module__<name> (e.g. module__authentication, module__payment_processing). Use lowercase_snake_case.

4. For files you excluded, record a brief reason in ignoredReasons (for debugging only — not shown to users).

5. List all programming languages detected in the relevant files.

6. Estimate the repository size based on the number of relevant files:
   - small: under 20 relevant files
   - medium: 20–80 relevant files
   - large: over 80 relevant files`
}

// Formats a flat list of file paths into a readable tree string
export function formatFileTree(paths: string[]): string {
  return paths.sort().join('\n')
}