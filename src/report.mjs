#!/usr/bin/env node
/**
 * Report — generates workspace heatmap from access.jsonl
 */

import { resolve } from 'node:path'
import {
  DEFAULT_DIR, loadEntries, getAllWorkspaceFiles,
  formatAge, formatTokens, computeCoverage,
} from './utils.mjs'

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

function makeBar(count, maxCount, width = 20) {
  const filled = Math.round((count / maxCount) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
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

  // Always get workspace files (needed for doc coverage)
  const allFiles = getAllWorkspaceFiles(ws)
  const deadFiles = allFiles.filter(f => f.endsWith('.md') && !fileCounts[f])

  // Sort by count descending
  const sorted = Object.entries(fileCounts).sort((a, b) => b[1] - a[1])
  const maxCount = sorted[0]?.[1] || 1

  // Classify into tiers
  const dailyThreshold = days // roughly 1+ per day
  const weeklyThreshold = Math.max(Math.floor(days / 7), 1)

  const hot = sorted.filter(([, c]) => c >= dailyThreshold)
  const warm = sorted.filter(([, c]) => c >= weeklyThreshold && c < dailyThreshold)
  const cold = sorted.filter(([, c]) => c > 0 && c < weeklyThreshold)

  // Compute documentation coverage
  const coverage = computeCoverage(entries, allFiles, ws, days)

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
      coverage,
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
    console.log(`${c.gray}⚫ DEAD — unread documentation (${deadFiles.length} .md files)${c.reset}`)
    for (const file of deadFiles.slice(0, 15)) {
      const name = file.length > 50 ? '...' + file.slice(-47) : file
      console.log(`  ${c.gray}${name}${c.reset}`)
    }
    if (deadFiles.length > 15) {
      console.log(`  ${c.gray}... and ${deadFiles.length - 15} more${c.reset}`)
    }
  }

  // Documentation Health
  if (coverage.mdTotal > 0) {
    console.log()
    console.log(`${c.bold}📋 Documentation Health${c.reset}`)
    const covColor = coverage.mdCoverage >= 70 ? c.green : coverage.mdCoverage >= 40 ? c.yellow : c.red
    console.log(`  Coverage: ${covColor}${coverage.mdRead} of ${coverage.mdTotal} .md files read (${coverage.mdCoverage}%)${c.reset}`)
    if (coverage.mdUnread.length > 0) {
      const shown = coverage.mdUnread.slice(0, 8)
      console.log(`  ${c.dim}Unread:  ${shown.join(', ')}${coverage.mdUnread.length > 8 ? ` … +${coverage.mdUnread.length - 8} more` : ''}${c.reset}`)
    }
  }

  // Boot Sequence
  if (coverage.bootFiles.length > 0) {
    console.log()
    console.log(`${c.bold}🚀 Boot Sequence${c.reset} ${c.dim}(first 5 reads, >80% of sessions)${c.reset}`)
    for (const bf of coverage.bootFiles.slice(0, 8)) {
      const name = bf.file.length > 35 ? '...' + bf.file.slice(-32) : bf.file
      console.log(`  ${c.green}${name.padEnd(38)}${c.reset} ${c.bold}${String(bf.pct).padStart(3)}%${c.reset} ${c.dim}(${bf.sessions}/${bf.totalSessions} sessions)${c.reset}`)
    }
  }

  // Stale Documentation
  if (coverage.staleFiles.length > 0) {
    console.log()
    console.log(`${c.bold}⏰ Stale Documentation${c.reset} ${c.dim}(read often, not updated)${c.reset}`)
    for (const sf of coverage.staleFiles.slice(0, 5)) {
      const name = sf.file.length > 35 ? '...' + sf.file.slice(-32) : sf.file
      console.log(`  ${c.yellow}${name.padEnd(38)}${c.reset} ${sf.reads} reads · last modified ${formatAge(sf.modifiedAge)}`)
    }
  }

  // Token Budget
  if (coverage.tokenEstimates.length > 0) {
    console.log()
    console.log(`${c.bold}💰 Token Budget${c.reset} ${c.dim}(estimated)${c.reset}`)
    for (const te of coverage.tokenEstimates.slice(0, 5)) {
      const name = te.file.length > 35 ? '...' + te.file.slice(-32) : te.file
      console.log(`  ${c.white}${name.padEnd(38)}${c.reset} ${c.dim}~${formatTokens(te.tokens)} tok × ${te.reads}${c.reset} = ${c.bold}${formatTokens(te.total)} tokens${c.reset}`)
    }
    console.log(`  ${c.dim}${'─'.repeat(58)}${c.reset}`)
    console.log(`  ${'Total:'.padEnd(38)} ${c.bold}~${formatTokens(coverage.totalTokens)} tokens${c.reset} on file reads`)
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

  if (deadFiles.length > 5) {
    console.log(`  ${c.cyan}→${c.reset} ${deadFiles.length} .md files never read — unread documentation in your workspace`)
  }

  if (coverage.mdTotal > 0 && coverage.mdCoverage < 50) {
    console.log(`  ${c.cyan}→${c.reset} Only ${coverage.mdCoverage}% of .md files read — your agent may be missing documentation`)
  }

  if (coverage.staleFiles.length > 0) {
    console.log(`  ${c.cyan}→${c.reset} ${coverage.staleFiles.length} files read frequently but not updated — check for stale docs`)
  }

  const uniqueSessions = new Set(entries.filter(e => e.s).map(e => e.s)).size
  if (uniqueSessions > 0) {
    console.log(`  ${c.cyan}→${c.reset} Tracked across ${uniqueSessions} sessions`)
  }

  console.log()
}
