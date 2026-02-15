#!/usr/bin/env node
/**
 * Mine — extract file read events from existing session transcripts.
 * Supports OpenClaw JSONL transcripts and Claude Code session logs.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, resolve, basename, relative, isAbsolute } from 'node:path'

const DEFAULT_DIR = '.heatmap'
const LOG_FILE = 'access.jsonl'

function extractFromOpenClaw(filePath, workspace) {
  const entries = []
  const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean)
  const sessionId = basename(filePath, '.jsonl').slice(0, 8)

  for (const line of lines) {
    let msg
    try { msg = JSON.parse(line) } catch { continue }

    // OpenClaw format: type:"message", message.role:"assistant", message.content[] has toolCall blocks
    if (msg.type === 'message' && msg.message?.role === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        // toolCall blocks with name "read" or "Read"
        if (block.type === 'toolCall' && /^(Read|read|file_read)$/i.test(block.name)) {
          const args = block.arguments || block.input || {}
          const file = args.file_path || args.path || args.file
          if (file) {
            entries.push({
              file,
              session: sessionId,
              tool: block.name,
              ts: msg.timestamp ? Math.floor(new Date(msg.timestamp).getTime() / 1000) : null,
            })
          }
        }

        // Also handle nested tool_use format (Anthropic API style)
        if (block.type === 'tool_use' && /^(Read|read|file_read)$/i.test(block.name)) {
          const args = block.input || {}
          const file = args.file_path || args.path || args.file
          if (file) {
            entries.push({
              file,
              session: sessionId,
              tool: block.name,
              ts: msg.timestamp ? Math.floor(new Date(msg.timestamp).getTime() / 1000) : null,
            })
          }
        }
      }
    }

    // Legacy format: role directly on message object
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && /^(Read|read|file_read)$/i.test(block.name)) {
          const args = block.input || {}
          const file = args.file_path || args.path || args.file
          if (file) {
            entries.push({
              file,
              session: sessionId,
              tool: block.name,
              ts: msg.timestamp ? Math.floor(new Date(msg.timestamp).getTime() / 1000) : null,
            })
          }
        }
      }
    }
  }

  return entries
}

function extractFromClaudeCode(filePath, workspace) {
  // Claude Code uses a similar JSONL format
  // Reuse OpenClaw extractor as base — format is compatible
  return extractFromOpenClaw(filePath, workspace)
}

function normalizeFile(file, workspace) {
  if (isAbsolute(file)) {
    const r = relative(workspace, file)
    if (!r.startsWith('..')) return r
  }
  return file
}

export function mine({ transcriptDirs = [], workspace = null, dir = null, format = 'openclaw', dryRun = false }) {
  const ws = workspace || process.cwd()
  const heatmapDir = dir || resolve(ws, DEFAULT_DIR)

  if (!dryRun && !existsSync(heatmapDir)) {
    mkdirSync(heatmapDir, { recursive: true })
  }

  const logPath = join(heatmapDir, LOG_FILE)
  let totalEntries = 0
  let totalFiles = 0

  for (const tDir of transcriptDirs) {
    if (!existsSync(tDir)) {
      console.error(`Warning: transcript dir not found: ${tDir}`)
      continue
    }

    const files = readdirSync(tDir).filter(f => f.endsWith('.jsonl'))
    totalFiles += files.length

    for (const file of files) {
      const filePath = join(tDir, file)
      const extractor = format === 'claude-code' ? extractFromClaudeCode : extractFromOpenClaw
      const entries = extractor(filePath, ws)

      for (const entry of entries) {
        const normalized = normalizeFile(entry.file, ws)
        const logEntry = {
          f: normalized,
          ts: entry.ts || Math.floor(Date.now() / 1000),
          ...(entry.tool !== 'Read' && { tool: entry.tool }),
          ...(entry.session && { s: entry.session }),
          src: 'mined',
        }

        if (dryRun) {
          console.log(JSON.stringify(logEntry))
        } else {
          appendFileSync(logPath, JSON.stringify(logEntry) + '\n')
        }
        totalEntries++
      }
    }
  }

  return { totalEntries, totalFiles }
}
