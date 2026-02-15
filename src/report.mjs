#!/usr/bin/env node
/**
 * Report — generates workspace heatmap from access.jsonl
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const DEFAULT_DIR = '.heatmap'
const LOG_FILE = 'access.jsonl'

// ANSI colors
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  white: '\x1b[37m',
}

function loadEntries(heatmapDir, daysBack = 30) {
  const logPath = join(heatmapDir, LOG_FILE)
  if (!existsSync(logPath)) return []

  const cutoff = Math.floor(Date.now() / 1000) - (daysBack * 86400)
  const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean)

  return lines
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(e => e && e.ts >= cutoff)
}

function getAllWorkspaceFiles(workspace, ignorePatterns = ['.git', 'node_modules', '.heatmap']) {
  const files = []
  function walk(dir, prefix = '') {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (ignorePatterns.includes(entry.name)) continue
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), relPath)
      } else {
        files.push(relPath)
      }
    }
  }
  walk(workspace)
  return files
}

function makeBar(count, maxCount, width = 20) {
  const filled = Math.round((count / maxCount) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function formatAge(seconds) {
  const hours = Math.floor(seconds / 3600)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

export function report({ dir = null, workspace = null, days = 30, json = false, all = false }) {
  const ws = workspace || process.cwd()
  const heatmapDir = dir || resolve(ws, DEFAULT_DIR)
  const entries = loadEntries(heatmapDir, days)

  if (entries.length === 0) {
    if (json) {
      console.log(JSON.stringify({ files: [], total: 0, period: days }))
    } else {
      console.log(`${c.yellow}No access data found.${c.reset} Run ${c.cyan}whm init${c.reset} to start tracking.`)
    }
    return
  }

  // Aggregate
  const fileCounts = {}
  const fileLastAccess = {}
  const fileSessions = {}
  const now = Math.floor(Date.now() / 1000)

  for (const e of entries) {
    fileCounts[e.f] = (fileCounts[e.f] || 0) + 1
    fileLastAccess[e.f] = Math.max(fileLastAccess[e.f] || 0, e.ts)
    if (e.s) {
      fileSessions[e.f] = fileSessions[e.f] || new Set()
      fileSessions[e.f].add(e.s)
    }
  }

  // Get all workspace files to find dead ones
  const allFiles = all ? getAllWorkspaceFiles(ws) : []
  const deadFiles = allFiles.filter(f => !fileCounts[f])

  // Sort by count descending
  const sorted = Object.entries(fileCounts).sort((a, b) => b[1] - a[1])
  const maxCount = sorted[0]?.[1] || 1

  // Classify into tiers
  const dailyThreshold = days // roughly 1+ per day
  const weeklyThreshold = Math.max(Math.floor(days / 7), 1)

  const hot = sorted.filter(([, c]) => c >= dailyThreshold)
  const warm = sorted.filter(([, c]) => c >= weeklyThreshold && c < dailyThreshold)
  const cold = sorted.filter(([, c]) => c > 0 && c < weeklyThreshold)

  if (json) {
    console.log(JSON.stringify({
      period: days,
      total: entries.length,
      files: sorted.map(([file, count]) => ({
        file,
        reads: count,
        lastAccess: fileLastAccess[file],
        sessions: fileSessions[file]?.size || 0,
        tier: count >= dailyThreshold ? 'hot' : count >= weeklyThreshold ? 'warm' : 'cold',
      })),
      dead: deadFiles.slice(0, 50),
    }))
    return
  }

  // Pretty output
  console.log()
  console.log(`${c.bold}📊 Workspace File Heatmap${c.reset} ${c.dim}(last ${days} days, ${entries.length} reads)${c.reset}`)
  console.log(`${c.dim}${'━'.repeat(60)}${c.reset}`)

  const printTier = (label, emoji, color, files) => {
    if (files.length === 0) return
    console.log()
    console.log(`${color}${emoji} ${label}${c.reset}`)
    for (const [file, count] of files) {
      const bar = makeBar(count, maxCount)
      const age = formatAge(now - fileLastAccess[file])
      const sessions = fileSessions[file]?.size
      const sessionStr = sessions ? ` ${c.dim}(${sessions} sessions)${c.reset}` : ''
      const name = file.length > 35 ? '...' + file.slice(-32) : file
      console.log(`  ${c.white}${name.padEnd(38)}${c.reset} ${color}${bar}${c.reset} ${c.bold}${String(count).padStart(4)}${c.reset} ${c.dim}${age}${c.reset}${sessionStr}`)
    }
  }

  printTier('HOT — read daily', '🔴', c.red, hot)
  printTier('WARM — read weekly', '🟡', c.yellow, warm)
  printTier('COLD — read rarely', '🔵', c.blue, cold)

  if (all && deadFiles.length > 0) {
    console.log()
    console.log(`${c.gray}⚫ DEAD — never read (${deadFiles.length} files)${c.reset}`)
    for (const file of deadFiles.slice(0, 15)) {
      const name = file.length > 50 ? '...' + file.slice(-47) : file
      console.log(`  ${c.gray}${name}${c.reset}`)
    }
    if (deadFiles.length > 15) {
      console.log(`  ${c.gray}... and ${deadFiles.length - 15} more${c.reset}`)
    }
  }

  // Recommendations
  console.log()
  console.log(`${c.bold}💡 Insights${c.reset}`)

  if (hot.length > 0) {
    const topFile = hot[0][0]
    const topPct = Math.round((hot[0][1] / entries.length) * 100)
    console.log(`  ${c.cyan}→${c.reset} ${topFile} is ${topPct}% of all reads — keep it lean`)
  }

  if (cold.length > 3) {
    console.log(`  ${c.cyan}→${c.reset} ${cold.length} files rarely read — consider moving to skills or archiving`)
  }

  if (all && deadFiles.length > 5) {
    console.log(`  ${c.cyan}→${c.reset} ${deadFiles.length} files never read — dead weight in your workspace`)
  }

  const uniqueSessions = new Set(entries.filter(e => e.s).map(e => e.s)).size
  if (uniqueSessions > 0) {
    console.log(`  ${c.cyan}→${c.reset} Tracked across ${uniqueSessions} sessions`)
  }

  console.log()
}
