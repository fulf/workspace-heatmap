/**
 * Mine — extract file access events from existing session transcripts.
 * Supports OpenClaw JSONL transcripts and Claude Code session logs.
 *
 * Formats:
 *   OpenClaw: wrapper type="message", content blocks type="toolCall", args in "arguments"
 *   Claude Code: wrapper type="assistant"|"user", content blocks type="tool_use", args in "input"
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs'
import { join, resolve, basename, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'

const DEFAULT_DIR = '.heatmap'
const LOG_FILE = 'access.jsonl'
const MINED_FILE = 'mined.json' // Track which transcripts have been mined

// Tool names that indicate file reads
const READ_TOOLS = /^(Read|read|file_read|ReadFile)$/i

// Tool names that indicate file writes
const WRITE_TOOLS = /^(Write|write|file_write|WriteFile|Edit|edit|file_edit|MultiEdit)$/i

function getFileFromArgs(args, toolName) {
  // Read tools: file_path, path, file
  // Write/Edit tools: file_path, path, file, old_file_path
  return args.file_path || args.path || args.file || null
}

function extractFromOpenClaw(filePath, workspace, { includeWrites = false } = {}) {
  const entries = []
  const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean)
  const sessionId = basename(filePath, '.jsonl')

  for (const line of lines) {
    let msg
    try { msg = JSON.parse(line) } catch { continue }

    // OpenClaw format:
    //   wrapper: { type: "message", timestamp: "...", message: { role: "assistant", content: [...] } }
    //   content blocks: { type: "toolCall", name: "read", arguments: { path: "..." } }
    if (msg.type === 'message' && msg.message?.role === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type !== 'toolCall') continue
        const args = block.arguments || block.input || {}
        const file = getFileFromArgs(args, block.name)
        if (!file) continue

        const isRead = READ_TOOLS.test(block.name)
        const isWrite = includeWrites && WRITE_TOOLS.test(block.name)

        if (isRead || isWrite) {
          entries.push({
            file,
            session: sessionId,
            tool: block.name,
            op: isRead ? 'read' : 'write',
            ts: msg.timestamp ? Math.floor(new Date(msg.timestamp).getTime() / 1000) : null,
          })
        }
      }
    }
  }

  return entries
}

function extractFromClaudeCode(filePath, workspace, { includeWrites = false } = {}) {
  const entries = []
  const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean)
  const sessionId = basename(filePath, '.jsonl')

  for (const line of lines) {
    let msg
    try { msg = JSON.parse(line) } catch { continue }

    // Claude Code format:
    //   wrapper: { type: "assistant", timestamp: "...", message: { role: "assistant", content: [...] } }
    //   content blocks: { type: "tool_use", name: "Read", input: { file_path: "..." } }
    //
    // Also handle: wrapper has role directly (older format)
    const content = msg.message?.content || (msg.role === 'assistant' ? msg.content : null)
    const role = msg.message?.role || msg.role
    const timestamp = msg.timestamp

    if (role !== 'assistant' || !Array.isArray(content)) continue

    for (const block of content) {
      // Claude Code uses "tool_use", but also handle "toolCall" for compatibility
      if (block.type !== 'tool_use' && block.type !== 'toolCall') continue

      const args = block.input || block.arguments || {}
      const file = getFileFromArgs(args, block.name)
      if (!file) continue

      const isRead = READ_TOOLS.test(block.name)
      const isWrite = includeWrites && WRITE_TOOLS.test(block.name)

      if (isRead || isWrite) {
        entries.push({
          file,
          session: sessionId,
          tool: block.name,
          op: isRead ? 'read' : 'write',
          ts: timestamp ? Math.floor(new Date(timestamp).getTime() / 1000) : null,
        })
      }
    }
  }

  return entries
}

function normalizeFile(file, workspace) {
  if (isAbsolute(file)) {
    const r = relative(workspace, file)
    if (!r.startsWith('..')) return r
  }
  return file
}

function hashFile(filePath) {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function loadMinedState(heatmapDir) {
  const statePath = join(heatmapDir, MINED_FILE)
  if (!existsSync(statePath)) return {}
  try { return JSON.parse(readFileSync(statePath, 'utf-8')) } catch { return {} }
}

function saveMinedState(heatmapDir, state) {
  const statePath = join(heatmapDir, MINED_FILE)
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
}

function detectFormat(filePath) {
  // Auto-detect format by peeking at the first few lines
  const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean).slice(0, 10)
  for (const line of lines) {
    try {
      const d = JSON.parse(line)
      // OpenClaw has type:"session" as first line, or type:"message" for content
      if (d.type === 'session') return 'openclaw'
      // Claude Code has type:"queue-operation" or type:"user"/"assistant" with version field
      if (d.type === 'queue-operation') return 'claude-code'
      if (d.version && (d.type === 'user' || d.type === 'assistant')) return 'claude-code'
      // OpenClaw messages have type:"message" with message.role
      if (d.type === 'message' && d.message?.role) return 'openclaw'
    } catch { continue }
  }
  return null // unknown
}

export function mine({
  transcriptDirs = [],
  workspace = null,
  dir = null,
  format = 'auto',
  dryRun = false,
  includeWrites = false,
  force = false,
}) {
  const ws = workspace || process.cwd()
  const heatmapDir = dir || resolve(ws, DEFAULT_DIR)

  if (!dryRun && !existsSync(heatmapDir)) {
    mkdirSync(heatmapDir, { recursive: true })
  }

  const logPath = join(heatmapDir, LOG_FILE)
  const minedState = dryRun ? {} : loadMinedState(heatmapDir)
  let totalEntries = 0
  let totalFiles = 0
  let skippedFiles = 0

  // Buffer all entries, write once at the end
  const buffer = []

  for (const tDir of transcriptDirs) {
    if (!existsSync(tDir)) {
      console.error(`Warning: transcript dir not found: ${tDir}`)
      continue
    }

    const files = readdirSync(tDir).filter(f => f.endsWith('.jsonl'))
    totalFiles += files.length

    for (const file of files) {
      const filePath = join(tDir, file)

      // Deduplication: skip if already mined (unless --force)
      if (!force && !dryRun) {
        const fileHash = hashFile(filePath)
        const stateKey = `${tDir}/${file}`
        if (minedState[stateKey] === fileHash) {
          skippedFiles++
          continue
        }
        // Will save hash after successful mining
        minedState[stateKey] = fileHash
      }

      // Auto-detect or use specified format
      let detectedFormat = format
      if (format === 'auto') {
        detectedFormat = detectFormat(filePath) || 'openclaw'
      }

      const extractor = detectedFormat === 'claude-code' ? extractFromClaudeCode : extractFromOpenClaw
      const entries = extractor(filePath, ws, { includeWrites })

      for (const entry of entries) {
        const normalized = normalizeFile(entry.file, ws)
        const logEntry = {
          f: normalized,
          ts: entry.ts || Math.floor(Date.now() / 1000),
          ...(entry.tool !== 'Read' && entry.tool !== 'read' && { tool: entry.tool }),
          ...(entry.session && { s: entry.session }),
          ...(entry.op === 'write' && { op: 'w' }),
          src: 'mined',
        }

        if (dryRun) {
          console.log(JSON.stringify(logEntry))
        } else {
          buffer.push(JSON.stringify(logEntry))
        }
        totalEntries++
      }
    }
  }

  // Flush buffer in one write
  if (!dryRun && buffer.length > 0) {
    appendFileSync(logPath, buffer.join('\n') + '\n')
  }

  // Save dedup state
  if (!dryRun && !force) {
    saveMinedState(heatmapDir, minedState)
  }

  return { totalEntries, totalFiles, skippedFiles }
}
