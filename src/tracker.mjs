#!/usr/bin/env node
/**
 * Tracker — the lightweight logging script called by hooks.
 * Appends one JSONL line per file read.
 *
 * Usage (Claude Code hook):
 *   node tracker.mjs <file_path> [--dir /path/to/.heatmap] [--session SESSION_ID]
 *
 * Usage (OpenClaw / programmatic):
 *   import { track } from 'workspace-heatmap/tracker'
 *   track({ file: 'MEMORY.md', tool: 'Read' })
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join, relative, isAbsolute } from 'node:path'

const DEFAULT_DIR = '.heatmap'
const LOG_FILE = 'access.jsonl'

export function track({ file, tool = 'Read', session = null, dir = null, workspace = null }) {
  const heatmapDir = dir || resolve(workspace || process.cwd(), DEFAULT_DIR)
  if (!existsSync(heatmapDir)) mkdirSync(heatmapDir, { recursive: true })

  const logPath = join(heatmapDir, LOG_FILE)

  // Normalize file path to relative if possible
  const ws = workspace || process.cwd()
  let relFile = file
  if (isAbsolute(file)) {
    const r = relative(ws, file)
    if (!r.startsWith('..')) relFile = r
  }

  const entry = {
    f: relFile,
    ts: Math.floor(Date.now() / 1000),
    ...(tool !== 'Read' && { tool }),
    ...(session && { s: session }),
  }

  appendFileSync(logPath, JSON.stringify(entry) + '\n')
}

// CLI mode
if (process.argv[1] && (process.argv[1].endsWith('tracker.mjs') || process.argv[1].endsWith('tracker.js'))) {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    process.exit(0) // Silent no-op if no file given
  }

  let file = null
  let dir = null
  let session = null
  let tool = 'Read'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) { dir = args[++i]; continue }
    if (args[i] === '--session' && args[i + 1]) { session = args[++i]; continue }
    if (args[i] === '--tool' && args[i + 1]) { tool = args[++i]; continue }
    if (!file) file = args[i]
  }

  if (file) {
    track({ file, tool, session, dir })
  }
}
