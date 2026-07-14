import { list, open } from './index.js'

const [cmd, ...args] = process.argv.slice(2)

switch (cmd) {
  case 'list': {
    const maps = list()
    if (maps.length === 0) {
      console.log('No saved maps found.')
      break
    }
    console.log('Saved maps:')
    console.log('─'.repeat(80))
    for (const m of maps) {
      const when = new Date(m.createdAt).toLocaleString()
      console.log(`  ${m.name}  (${m.repoName})  [${m.nodeCount} nodes]  ${when}`)
      console.log(`    file: ${m.fileName}`)
    }
    console.log('─'.repeat(80))
    console.log(`Total: ${maps.length} map(s)`)
    break
  }

  case 'open': {
    if (args.length === 0) {
      console.error('Usage: node cli.js open <name>')
      console.error('  name can be: repo name, file name, or partial match')
      process.exit(1)
    }
    const result = await open({ name: args.join(' ') })
    if (result.error) {
      console.error(result.error)
      if (result.matches) {
        console.log('Did you mean one of these?')
        for (const m of result.matches) {
          console.log(`  - ${m.name} (${m.createdAt})`)
        }
      }
      process.exit(1)
    }
    console.log(`Map opened at ${result.url}`)
    console.log('Press Ctrl+C to stop the server')
    // Keep alive so the child server stays running
    process.stdin.resume()
    break
  }

  default:
    console.log('Usage:')
    console.log('  node cli.js list              List all saved maps')
    console.log('  node cli.js open <name>       Open a map (by name, file, or partial match)')
    process.exit(1)
}
