#!/usr/bin/env node
/**
 * workspace-heatmap CLI
 *
 * Commands:
 *   init              Set up tracking for current workspace
 *   track <file>      Log a file read (used by hooks)
 *   report            Show the heatmap
 *   mine              Extract reads from session transcripts
 *   status            Show tracking status
 */

import { resolve } from 'node:path'

const args = process.argv.slice(2)
const command = args[0]

function parseFlags(args) {
  const flags = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const raw = args[i].slice(2)
      const eqIdx = raw.indexOf('=')
      if (eqIdx !== -1) {
        // Handle --key=value syntax
        flags[raw.slice(0, eqIdx)] = raw.slice(eqIdx + 1)
      } else if (args[i + 1] && !args[i + 1].startsWith('--')) {
        flags[raw] = args[++i]
      } else {
        flags[raw] = true
      }
    } else {
      positional.push(args[i])
    }
  }
  return { flags, positional }
}

async function main() {
  const { flags, positional } = parseFlags(args.slice(1))

  switch (command) {
    case 'init': {
      const { init } = await import('../src/init.mjs')
      const result = init({
        workspace: flags.workspace || process.cwd(),
        force: flags.force || false,
      })

      console.log()
      console.log(`\x1b[1m📊 workspace-heatmap initialized\x1b[0m`)
      console.log(`\x1b[2mWorkspace: ${result.workspace}\x1b[0m`)
      console.log(`\x1b[2mData dir:  ${result.heatmapDir}\x1b[0m`)
      console.log()

      const env = result.environment
      console.log(`\x1b[1mDetected:\x1b[0m`)
      if (env.claudeCode) console.log(`  ✅ Claude Code (.claude/ found)`)
      if (env.openClaw) console.log(`  ✅ OpenClaw (AGENTS.md + SOUL.md found)`)
      if (env.git) console.log(`  ✅ Git repository`)
      if (!env.claudeCode && !env.openClaw) console.log(`  ℹ️  Generic workspace (no agent framework detected)`)
      console.log()

      for (const inst of result.installations) {
        if (inst.installed) {
          console.log(`  \x1b[32m✓\x1b[0m Installed ${inst.target} hook${inst.file ? ` → ${inst.file}` : ''}`)
        } else {
          console.log(`  \x1b[33m⊘\x1b[0m ${inst.target}: ${inst.reason}`)
        }
      }

      console.log()
      console.log(`\x1b[2mNext: Your agent's file reads are now tracked.`)
      console.log(`Run \x1b[0m\x1b[36mwhm report\x1b[0m\x1b[2m after a few sessions to see the heatmap.\x1b[0m`)
      console.log()
      break
    }

    case 'track': {
      // --stdin mode: read Claude Code hook JSON from stdin
      if (flags.stdin || (!positional[0] && !process.stdin.isTTY)) {
        // Stdin mode — delegate to tracker.mjs which handles parsing
        const { execSync } = await import('node:child_process')
        const { fileURLToPath } = await import('node:url')
        const { join, dirname } = await import('node:path')
        const trackerPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tracker.mjs')
        let data = ''
        process.stdin.setEncoding('utf-8')
        await new Promise((res) => {
          process.stdin.on('data', chunk => { data += chunk })
          process.stdin.on('end', res)
          setTimeout(res, 1000)
        })
        if (data) {
          const dirArgs = flags.dir ? ` --dir "${flags.dir}"` : ''
          const wsArgs = flags.workspace ? ` --workspace "${flags.workspace}"` : ''
          try {
            execSync(`node "${trackerPath}" --stdin${dirArgs}${wsArgs}`, { input: data, stdio: ['pipe', 'inherit', 'inherit'] })
          } catch {}
        }
        break
      }

      const { track } = await import('../src/tracker.mjs')
      const file = positional[0]
      if (!file) {
        process.exit(0) // Silent no-op
      }
      track({
        file,
        tool: flags.tool || 'Read',
        session: flags.session || process.env.OPENCLAW_SESSION_ID || null,
        dir: flags.dir || null,
        workspace: flags.workspace || process.cwd(),
      })
      break
    }

    case 'report': {
      const { report } = await import('../src/report.mjs')
      const depthVal = flags.depth !== undefined ? parseInt(flags.depth, 10) : null
      report({
        dir: null,                           // .heatmap dir override (keep separate from filterDir)
        workspace: flags.workspace || process.cwd(),
        days: parseInt(flags.days || '30', 10),
        json: flags.json || false,
        all: flags.all || false,
        filterDir: flags.dir || null,        // filter to files under this path
        depth: Number.isFinite(depthVal) ? depthVal : null,
      })
      break
    }

    case 'mine': {
      const { mine } = await import('../src/mine.mjs')
      const dirs = positional.length > 0 ? positional : []
      if (dirs.length === 0) {
        console.error('Usage: whm mine <transcript-dir> [<transcript-dir>...] [--format auto|openclaw|claude-code]')
        console.error('')
        console.error('Options:')
        console.error('  --format <F>       Transcript format (default: auto-detect)')
        console.error('  --include-writes   Also track Write/Edit tool calls')
        console.error('  --force            Re-mine already-processed transcripts')
        console.error('  --dry-run          Preview without writing')
        console.error('')
        console.error('Example:')
        console.error('  whm mine ~/.openclaw/agents/main/sessions/')
        console.error('  whm mine ~/.claude/projects/*/')
        console.error('  whm mine ./sessions/ --include-writes --force')
        process.exit(1)
      }

      const result = mine({
        transcriptDirs: dirs.map(d => resolve(d)),
        workspace: flags.workspace || process.cwd(),
        dir: flags.dir || null,
        format: flags.format || 'auto',
        dryRun: flags['dry-run'] || false,
        includeWrites: flags['include-writes'] || false,
        force: flags.force || false,
      })

      if (!flags['dry-run']) {
        const parts = [`\x1b[32m✓\x1b[0m Mined ${result.totalEntries} file accesses from ${result.totalFiles} transcripts`]
        if (result.skippedFiles > 0) {
          parts.push(`(${result.skippedFiles} already mined, skipped)`)
        }
        console.log(parts.join(' '))
      }
      break
    }

    case 'insights': {
      const { insights } = await import('../src/insights.mjs')
      const outPath = insights({
        dir: flags.dir || null,
        workspace: flags.workspace || process.cwd(),
        days: parseInt(flags.days || '30', 10),
        output: flags.output || flags.o || null,
        open: !flags['no-open'],
      })
      break
    }

    case 'status': {
      const { existsSync, readFileSync, statSync } = await import('node:fs')
      const { join } = await import('node:path')
      const ws = flags.workspace || process.cwd()
      const heatmapDir = join(ws, '.heatmap')
      const logPath = join(heatmapDir, 'access.jsonl')

      console.log()
      console.log(`\x1b[1m📊 workspace-heatmap status\x1b[0m`)
      console.log(`\x1b[2mWorkspace: ${ws}\x1b[0m`)
      console.log()

      if (!existsSync(logPath)) {
        console.log(`  \x1b[33m⊘\x1b[0m No data yet. Run \x1b[36mwhm init\x1b[0m to start tracking.`)
      } else {
        const content = readFileSync(logPath, 'utf-8')
        const lines = content.trim().split('\n').filter(Boolean)
        const stat = statSync(logPath)
        const sizeKB = Math.round(stat.size / 1024)
        const uniqueFiles = new Set(lines.map(l => { try { return JSON.parse(l).f } catch { return null } }).filter(Boolean))

        console.log(`  📁 Log: ${logPath}`)
        console.log(`  📏 Size: ${sizeKB} KB (${lines.length} entries)`)
        console.log(`  📂 Unique files: ${uniqueFiles.size}`)

        if (lines.length > 0) {
          const last = JSON.parse(lines[lines.length - 1])
          const age = Math.floor((Date.now() / 1000 - last.ts) / 60)
          console.log(`  🕐 Last tracked: ${age} min ago`)
        }
      }
      console.log()
      break
    }

    case 'version':
    case '--version':
    case '-v':
    case '-V': {
      const { readFileSync } = await import('node:fs')
      const { join, dirname } = await import('node:path')
      const { fileURLToPath } = await import('node:url')
      const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      console.log(pkg.version)
      break
    }

    case 'help':
    case '--help':
    case '-h':
    case undefined: {
      console.log(`
\x1b[1mworkspace-heatmap\x1b[0m — Track which files your AI agent actually reads

\x1b[1mUsage:\x1b[0m
  whm init                                Set up tracking in current workspace
  whm track <file>                        Log a file read (called by hooks)
  whm report [--days N] [--all]           Show the heatmap (terminal)
  whm report --dir <path>                 Filter to files under a directory
  whm report --depth <N>                  Show directory tree to depth N
  whm insights [--days N]                 Generate a beautiful HTML report
  whm mine <dir> [--format F]             Extract reads from session transcripts
  whm status                              Show tracking status

\x1b[1mOptions:\x1b[0m
  --workspace <path>    Override workspace directory
  --days <N>            Report period in days (default: 30)
  --all                 Include dead files in report
  --json                JSON output (report)
  --dir <path>          Filter report to files under a directory (report)
  --depth <N>           Show directory tree view to depth N (report)
  --output <path>       Output file path (insights)
  --no-open             Don't auto-open the HTML file (insights)
  --format <F>          Transcript format: openclaw, claude-code (mine)
  --dry-run             Preview without writing (mine)

\x1b[1mExamples:\x1b[0m
  cd ~/my-agent && whm init
  whm report --days 7 --all
  whm insights --days 14
  whm mine ~/.openclaw/agents/main/sessions/
  whm report --json | jq '.files[:5]'
`)
      break
    }

    default:
      console.error(`Unknown command: ${command}. Run \x1b[36mwhm --help\x1b[0m for usage.`)
      process.exit(1)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
