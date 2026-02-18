/**
 * Shared utilities for workspace-heatmap.
 * Extracted from report.mjs and insights.mjs to eliminate duplication.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_DIR = '.heatmap'
export const LOG_FILE = 'access.jsonl'

/**
 * Load and parse JSONL entries within a time window.
 */
export function loadEntries(heatmapDir, daysBack = 30) {
  const logPath = join(heatmapDir, LOG_FILE)
  if (!existsSync(logPath)) return []
  const cutoff = Math.floor(Date.now() / 1000) - (daysBack * 86400)
  return readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(e => e && e.ts >= cutoff)
}

/**
 * Recursively list all files in workspace, excluding common noise dirs.
 */
export function getAllWorkspaceFiles(workspace, ignorePatterns = ['.git', 'node_modules', '.heatmap']) {
  const files = []
  function walk(dir, prefix = '') {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (ignorePatterns.includes(entry.name)) continue
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), relPath)
      else files.push(relPath)
    }
  }
  walk(workspace)
  return files
}

/**
 * Human-friendly time-ago string. Handles minutes through weeks.
 */
export function formatAge(seconds) {
  const hours = Math.floor(seconds / 3600)
  if (hours < 1) return `${Math.floor(seconds / 60)}m ago`
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

/**
 * Format token counts in human-friendly form (K, M).
 */
export function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1000)}K`
  return String(n)
}

/**
 * Compute documentation coverage metrics:
 * - Markdown coverage score
 * - Boot file detection
 * - Staleness detection
 * - Token cost estimation
 */
export function computeCoverage(entries, allFiles, workspace, days) {
  const fileCounts = {}
  const sessionFirstReads = {}

  for (const e of entries) {
    fileCounts[e.f] = (fileCounts[e.f] || 0) + 1
    if (e.s) {
      if (!sessionFirstReads[e.s]) sessionFirstReads[e.s] = []
      sessionFirstReads[e.s].push({ file: e.f, ts: e.ts })
    }
  }

  // — Documentation coverage —
  const mdFiles = allFiles.filter(f => f.endsWith('.md'))
  const readFiles = new Set(Object.keys(fileCounts))
  const mdReadFiles = mdFiles.filter(f => readFiles.has(f))
  const mdUnread = mdFiles.filter(f => !readFiles.has(f))

  // — Boot file detection —
  // Files in the first 5 reads of >80% of sessions
  const sessions = Object.keys(sessionFirstReads)
  const bootCandidates = {}
  for (const sess of sessions) {
    const reads = sessionFirstReads[sess].sort((a, b) => a.ts - b.ts)
    const first5 = new Set(reads.slice(0, 5).map(r => r.file))
    for (const f of first5) {
      bootCandidates[f] = (bootCandidates[f] || 0) + 1
    }
  }
  const bootThreshold = sessions.length >= 2 ? Math.ceil(sessions.length * 0.8) : 0
  const bootFiles = bootThreshold > 0
    ? Object.entries(bootCandidates)
        .filter(([, count]) => count >= bootThreshold)
        .sort((a, b) => b[1] - a[1])
        .map(([file, count]) => ({
          file,
          sessions: count,
          totalSessions: sessions.length,
          pct: Math.round((count / sessions.length) * 100),
        }))
    : []

  // — Staleness detection —
  // Files read >10× but not modified in >2× the reporting period
  const periodSeconds = days * 86400
  const now = Math.floor(Date.now() / 1000)
  const staleFiles = []
  for (const [file, count] of Object.entries(fileCounts)) {
    if (count < 10) continue
    try {
      const stat = statSync(join(workspace, file))
      const mtime = Math.floor(stat.mtimeMs / 1000)
      const age = now - mtime
      if (age > periodSeconds * 2) {
        staleFiles.push({
          file,
          reads: count,
          lastModified: mtime,
          modifiedAge: age,
        })
      }
    } catch { continue }
  }
  staleFiles.sort((a, b) => b.reads - a.reads)

  // — Token cost estimation —
  // Rough: file_size_bytes / 4 ≈ tokens
  const tokenEstimates = []
  let totalTokens = 0
  for (const [file, count] of Object.entries(fileCounts)) {
    try {
      const stat = statSync(join(workspace, file))
      const tokens = Math.ceil(stat.size / 4)
      const totalForFile = tokens * count
      tokenEstimates.push({ file, tokens, reads: count, total: totalForFile, size: stat.size })
      totalTokens += totalForFile
    } catch { continue }
  }
  tokenEstimates.sort((a, b) => b.total - a.total)

  return {
    mdTotal: mdFiles.length,
    mdRead: mdReadFiles.length,
    mdUnread,
    mdCoverage: mdFiles.length > 0 ? Math.round((mdReadFiles.length / mdFiles.length) * 100) : 0,
    bootFiles,
    staleFiles,
    tokenEstimates,
    totalTokens,
  }
}

/**
 * Build a nested directory tree from sorted file data.
 *
 * Tree node shape:
 *   { name, path, totalReads, fileCount, children: {path→node}, files: [fileData...] }
 *
 * @param {Array<[string, number]>} sorted  - [file, count] pairs sorted by count desc
 * @param {Object} fileDataMap              - { [file]: { count, lastAccess, sessions, tier, pct, … } }
 * @returns {Object} root tree node
 */
export function buildDirectoryTree(sorted, fileDataMap) {
  const nodes = {}

  const root = {
    name: '(root)',
    path: '',
    totalReads: 0,
    fileCount: 0,
    children: {},
    files: [],
  }
  nodes[''] = root

  function getOrCreateNode(dirPath) {
    if (nodes[dirPath]) return nodes[dirPath]
    const parts = dirPath.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    const parent = getOrCreateNode(parentPath)
    const node = { name, path: dirPath, totalReads: 0, fileCount: 0, children: {}, files: [] }
    nodes[dirPath] = node
    parent.children[dirPath] = node
    return node
  }

  for (const [file] of sorted) {
    const slashIdx = file.lastIndexOf('/')
    const dirPath = slashIdx === -1 ? '' : file.slice(0, slashIdx)
    getOrCreateNode(dirPath).files.push({ file, ...(fileDataMap[file] || {}) })
  }

  // Propagate totalReads + fileCount upward
  function propagate(node) {
    let reads = node.files.reduce((s, f) => s + (f.count || 0), 0)
    let count = node.files.length
    for (const child of Object.values(node.children)) {
      propagate(child)
      reads += child.totalReads
      count += child.fileCount
    }
    node.totalReads = reads
    node.fileCount = count
  }
  propagate(root)

  return root
}
