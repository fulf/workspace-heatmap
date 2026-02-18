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

/**
 * Read all of stdin as a string. Returns '' if stdin is a TTY or empty.
 */
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('')
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    // Timeout after 1s in case stdin hangs
    setTimeout(() => resolve(data), 1000)
  })
}

/**
 * Extract file paths from a Bash command string.
 * Catches simple patterns: cat, head, tail, less, more, wc, sort, etc.
 * Returns array of file paths or empty array.
 */
function extractBashFilePaths(command) {
  if (!command) return []
  // Match common file-reading commands followed by file paths
  // Handles: cat file, head -n 10 file, tail -f file, etc.
  const readers = /\b(cat|head|tail|less|more|wc|sort|uniq|nl|tac|rev|fold|paste|expand)\b/
  if (!readers.test(command)) return []

  const files = []
  // Split by pipe/semicolon/&&/|| to get individual commands
  const parts = command.split(/[|;&]/).map(s => s.trim())
  for (const part of parts) {
    if (!readers.test(part)) continue
    // Extract non-flag arguments (skip things starting with -)
    const tokens = part.split(/\s+/).slice(1) // skip the command itself
    for (const token of tokens) {
      if (!token.startsWith('-') && !token.startsWith('$') && !token.startsWith('(') && token.length > 0) {
        // Looks like a file path
        files.push(token.replace(/^["']|["']$/g, '')) // strip quotes
      }
    }
  }
  return files
}

/**
 * Parse Claude Code hook stdin JSON and extract file path(s) + metadata.
 * Returns array of { file, tool, session } or empty array if not applicable.
 */
function parseHookStdin(json) {
  try {
    const data = JSON.parse(json)
    const tool = data.tool_name || 'Read'
    const session = data.session_id || null

    // Read tool — single file
    if (tool === 'Read') {
      const file = data.tool_input?.file_path || data.tool_input?.path
      return file ? [{ file, tool, session }] : []
    }

    // Grep tool — search path (file or directory being searched)
    if (tool === 'Grep') {
      const file = data.tool_input?.path || data.tool_input?.file_path
      return file ? [{ file, tool, session }] : []
    }

    // Bash tool — try to extract file paths from command
    if (tool === 'Bash') {
      const command = data.tool_input?.command
      const files = extractBashFilePaths(command)
      return files.map(f => ({ file: f, tool, session }))
    }

    // Fallback — try common field names
    const file = data.tool_input?.file_path || data.tool_input?.path
    return file ? [{ file, tool, session }] : []
  } catch {
    return []
  }
}

// CLI mode
if (process.argv[1] && (process.argv[1].endsWith('tracker.mjs') || process.argv[1].endsWith('tracker.js'))) {
  const args = process.argv.slice(2)

  let file = null
  let dir = null
  let session = null
  let tool = 'Read'
  let useStdin = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stdin') { useStdin = true; continue }
    if (args[i] === '--dir' && args[i + 1]) { dir = args[++i]; continue }
    if (args[i] === '--session' && args[i + 1]) { session = args[++i]; continue }
    if (args[i] === '--tool' && args[i + 1]) { tool = args[++i]; continue }
    if (!file) file = args[i]
  }

  if (useStdin || (!file && !process.stdin.isTTY)) {
    // Read from stdin (Claude Code hook mode)
    readStdin().then(input => {
      if (!input) process.exit(0)
      const entries = parseHookStdin(input)
      for (const entry of entries) {
        track({
          file: entry.file,
          tool: entry.tool,
          session: session || entry.session,
          dir,
        })
      }
    })
  } else if (file) {
    track({ file, tool, session, dir })
  }
}
