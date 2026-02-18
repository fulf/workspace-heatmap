/**
 * Insights — generates a beautiful HTML report from access.jsonl
 * Inspired by Claude Code's /insights report.
 */

import { writeFileSync, existsSync } from 'node:fs'
import { resolve, join, dirname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  loadEntries, getAllWorkspaceFiles, formatAge,
  formatTokens, computeCoverage,
} from './utils.mjs'

const DEFAULT_DIR = '.heatmap'

/* ── Analysis sub-functions ────────────────────────────────────────── */

function computeTiers(sorted, totalEntries, fileLastAccess, fileSessions, days) {
  const dailyThreshold = days
  const weeklyThreshold = Math.max(Math.floor(days / 7), 1)
  const tiers = { hot: [], warm: [], cold: [] }

  for (const [file, count] of sorted) {
    const tier = count >= dailyThreshold ? 'hot' : count >= weeklyThreshold ? 'warm' : 'cold'
    tiers[tier].push({
      file, count, tier,
      lastAccess: fileLastAccess[file],
      sessions: fileSessions[file]?.size || 0,
      pct: Math.round((count / totalEntries) * 100),
    })
  }

  return tiers
}

function computePatterns(entries, sorted, sessionReads) {
  const hourCounts = new Array(24).fill(0)
  const dowCounts = new Array(7).fill(0) // 0=Sun

  for (const e of entries) {
    const d = new Date(e.ts * 1000)
    hourCounts[d.getUTCHours()]++
    dowCounts[d.getUTCDay()]++
  }

  // Directory heatmap
  const dirCounts = {}
  for (const [file, count] of sorted) {
    const dir = dirname(file) === '.' ? '(root)' : dirname(file)
    dirCounts[dir] = (dirCounts[dir] || 0) + count
  }
  const dirSorted = Object.entries(dirCounts).sort((a, b) => b[1] - a[1])

  // Session stats
  const sessionSorted = Object.entries(sessionReads).sort((a, b) => b[1] - a[1])

  // File extension breakdown
  const extCounts = {}
  for (const [file, count] of sorted) {
    const ext = file.includes('.') ? file.split('.').pop().toLowerCase() : '(none)'
    extCounts[ext] = (extCounts[ext] || 0) + count
  }
  const extSorted = Object.entries(extCounts).sort((a, b) => b[1] - a[1])

  // Daily trend
  const dayBuckets = {}
  for (const e of entries) {
    const dayKey = new Date(e.ts * 1000).toISOString().slice(0, 10)
    dayBuckets[dayKey] = (dayBuckets[dayKey] || 0) + 1
  }
  const dailyTrend = Object.entries(dayBuckets).sort((a, b) => a[0].localeCompare(b[0]))

  return { hourCounts, dowCounts, dirSorted, sessionSorted, extSorted, dailyTrend }
}

function analyze(entries, allFiles, workspace, days) {
  const now = Math.floor(Date.now() / 1000)

  // Core aggregation
  const fileCounts = {}
  const fileLastAccess = {}
  const fileSessions = {}
  const sessionReads = {}

  for (const e of entries) {
    fileCounts[e.f] = (fileCounts[e.f] || 0) + 1
    fileLastAccess[e.f] = Math.max(fileLastAccess[e.f] || 0, e.ts)
    if (e.s) {
      if (!fileSessions[e.f]) fileSessions[e.f] = new Set()
      fileSessions[e.f].add(e.s)
      sessionReads[e.s] = (sessionReads[e.s] || 0) + 1
    }
  }

  const sorted = Object.entries(fileCounts).sort((a, b) => b[1] - a[1])
  const maxCount = sorted[0]?.[1] || 1

  // Sub-computations
  const tiers = computeTiers(sorted, entries.length, fileLastAccess, fileSessions, days)
  const patterns = computePatterns(entries, sorted, sessionReads)
  const coverage = computeCoverage(entries, allFiles, workspace, days)

  // Dead files — only .md files matter (we care about unread documentation, not code/config)
  const readFiles = new Set(Object.keys(fileCounts))
  const deadFiles = allFiles.filter(f => f.endsWith('.md') && !readFiles.has(f))

  // Timestamps
  const timestamps = entries.map(e => e.ts).sort((a, b) => a - b)
  const firstRead = timestamps[0] ? new Date(timestamps[0] * 1000) : null
  const lastRead = timestamps.length ? new Date(timestamps[timestamps.length - 1] * 1000) : null

  // Top-5 concentration
  const top5reads = sorted.slice(0, 5).reduce((s, [, c]) => s + c, 0)
  const top5pct = entries.length > 0 ? Math.round((top5reads / entries.length) * 100) : 0

  return {
    total: entries.length,
    uniqueFiles: Object.keys(fileCounts).length,
    uniqueSessions: Object.keys(sessionReads).length,
    days,
    maxCount,
    tiers,
    deadFiles,
    sorted,
    now,
    fileLastAccess,
    firstRead,
    lastRead,
    top5pct,
    coverage,
    ...patterns,
  }
}

/* ── HTML helpers ──────────────────────────────────────────────────── */

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatDate(d) {
  if (!d) return '—'
  return d.toISOString().slice(0, 10)
}

function barHtml(count, maxCount, color = '#2563eb') {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0
  return `<div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>`
}

function buildGlance(data) {
  const lines = []

  // What's hot
  if (data.tiers.hot.length > 0) {
    const topFiles = data.tiers.hot.slice(0, 3).map(f => `<code>${esc(f.file)}</code>`).join(', ')
    lines.push(`<strong>Hottest files:</strong> ${topFiles} — read every session. These dominate your token budget; keep them lean and focused.`)
  }

  // Documentation coverage
  if (data.coverage.mdTotal > 0) {
    const covPct = data.coverage.mdCoverage
    const emoji = covPct >= 70 ? '✅' : covPct >= 40 ? '⚠️' : '🔴'
    lines.push(`<strong>Documentation coverage:</strong> ${emoji} ${data.coverage.mdRead} of ${data.coverage.mdTotal} markdown files are actually read (${covPct}%). ${covPct < 50 ? 'Your agent may be missing important documentation.' : 'Good coverage.'}`)
  }

  // Concentration
  if (data.top5pct > 50) {
    lines.push(`<strong>High concentration:</strong> Your top 5 files account for ${data.top5pct}% of all reads. Your agent has a narrow focus — great for efficiency, but make sure it's not missing important context in cold files.`)
  } else if (data.top5pct < 30 && data.uniqueFiles > 10) {
    lines.push(`<strong>Distributed reads:</strong> Your agent spreads attention across many files (top 5 = only ${data.top5pct}%). Good coverage, but check if some reads are unnecessary.`)
  }

  // Token budget
  if (data.coverage.totalTokens > 0) {
    lines.push(`<strong>Token spend:</strong> ~${formatTokens(data.coverage.totalTokens)} tokens estimated on file reads in this period. ${data.coverage.totalTokens > 500000 ? 'That\'s significant — make sure every read earns its keep.' : ''}`)
  }

  // Dead zone
  if (data.deadFiles.length > 5) {
    lines.push(`<strong>Unread docs:</strong> ${data.deadFiles.length} .md files have never been read. That's documentation your agent doesn't know exists — either it's not needed, or your workspace structure is hiding it.`)
  }

  // Cold files insight
  if (data.tiers.cold.length > 10) {
    lines.push(`<strong>Cold storage:</strong> ${data.tiers.cold.length} files are rarely touched. Consider moving reference docs to a skill or archive — less noise for your agent.`)
  }

  return lines
}

/* ── HTML Generation ───────────────────────────────────────────────── */

function generateHtml(data, workspace) {
  const wsName = basename(workspace)
  const glance = buildGlance(data)

  const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const maxDow = Math.max(...data.dowCounts)

  // Period labels for hour chart
  const periods = [
    { label: 'Night (0–6)', hours: [0,1,2,3,4,5] },
    { label: 'Morning (6–12)', hours: [6,7,8,9,10,11] },
    { label: 'Afternoon (12–18)', hours: [12,13,14,15,16,17] },
    { label: 'Evening (18–24)', hours: [18,19,20,21,22,23] },
  ]
  const periodCounts = periods.map(p => ({
    label: p.label,
    count: p.hours.reduce((s, h) => s + data.hourCounts[h], 0),
  }))
  const maxPeriod = Math.max(...periodCounts.map(p => p.count))

  // Daily trend sparkline (SVG)
  const trendMax = Math.max(...data.dailyTrend.map(([, c]) => c), 1)
  const trendW = 700
  const trendH = 80
  const trendPoints = data.dailyTrend.map(([, c], i) => {
    const x = data.dailyTrend.length > 1
      ? (i / (data.dailyTrend.length - 1)) * trendW
      : trendW / 2
    const y = trendH - (c / trendMax) * (trendH - 10)
    return `${x},${y}`
  }).join(' ')

  // Tier colors
  const tierMeta = {
    hot: { emoji: '🔴', label: 'HOT — read daily', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5' },
    warm: { emoji: '🟡', label: 'WARM — read weekly', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
    cold: { emoji: '🔵', label: 'COLD — read rarely', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  }

  const renderFileRows = (files, color) => files.slice(0, 15).map(f => `
    <div class="file-row">
      <div class="file-name" title="${esc(f.file)}">${esc(f.file)}</div>
      ${barHtml(f.count, data.maxCount, color)}
      <div class="file-count">${f.count}</div>
      <div class="file-meta">${f.pct}% · ${formatAge(data.now - f.lastAccess)} · ${f.sessions} sess</div>
    </div>`).join('')

  // Insights/recommendations
  const insights = []
  if (data.tiers.hot.length > 0) {
    const top = data.tiers.hot[0]
    insights.push({
      icon: '🎯',
      title: `${top.file} is ${top.pct}% of all reads`,
      desc: 'This file gets read in almost every session. Keep it concise — every extra line costs tokens across every interaction.',
    })
  }
  if (data.tiers.cold.length > 5) {
    insights.push({
      icon: '📦',
      title: `${data.tiers.cold.length} files are rarely read`,
      desc: 'Consider consolidating cold files into a skill or reference document. Your agent wastes context discovering files it never opens.',
    })
  }
  if (data.deadFiles.length > 3) {
    insights.push({
      icon: '💀',
      title: `${data.deadFiles.length} .md files are unread documentation`,
      desc: 'These documentation files exist in your workspace but have never been read. Archive them, move to a skill, or investigate if your agent should be reading them.',
    })
  }
  if (data.uniqueSessions > 5 && data.tiers.hot.length >= 2) {
    const hotReads = data.tiers.hot.reduce((s, f) => s + f.count, 0)
    const hotPct = Math.round((hotReads / data.total) * 100)
    insights.push({
      icon: '⚡',
      title: `${hotPct}% of reads go to ${data.tiers.hot.length} hot files`,
      desc: 'High concentration means your agent knows what matters. But double-check that it\'s not ignoring files it should be reading.',
    })
  }
  if (data.coverage.mdTotal > 0 && data.coverage.mdCoverage < 50) {
    insights.push({
      icon: '📝',
      title: `Only ${data.coverage.mdCoverage}% of markdown files are read`,
      desc: `${data.coverage.mdUnread.length} documentation files sit untouched. Your agent may be missing important context — or these files aren't needed.`,
    })
  }
  if (data.coverage.staleFiles.length > 0) {
    insights.push({
      icon: '⏰',
      title: `${data.coverage.staleFiles.length} frequently-read files may be stale`,
      desc: 'These files are read often but haven\'t been modified recently. The agent consumes potentially outdated information every session.',
    })
  }
  const avgReadsPerSession = data.uniqueSessions > 0 ? Math.round(data.total / data.uniqueSessions) : 0
  if (avgReadsPerSession > 0) {
    insights.push({
      icon: '📊',
      title: `${avgReadsPerSession} reads per session average`,
      desc: data.uniqueSessions > 1
        ? `Across ${data.uniqueSessions} sessions. ${avgReadsPerSession > 20 ? 'That\'s a lot of file I/O — consider if your agent is re-reading files unnecessarily.' : 'Looks reasonable.'}`
        : 'Track more sessions to see patterns.',
    })
  }

  // — Coverage sections —
  const cov = data.coverage

  const covPctColor = cov.mdCoverage >= 70 ? '#059669' : cov.mdCoverage >= 40 ? '#d97706' : '#dc2626'
  const covBgColor = cov.mdCoverage >= 70 ? '#ecfdf5' : cov.mdCoverage >= 40 ? '#fffbeb' : '#fef2f2'

  // — Nav links —
  const navLinks = [
    { href: '#doc-health', label: 'Docs Health', show: cov.mdTotal > 0 },
    { href: '#boot', label: 'Boot Sequence', show: cov.bootFiles.length > 0 },
    { href: '#heatmap', label: 'Heatmap', show: true },
    { href: '#tokens', label: 'Token Budget', show: cov.tokenEstimates.length > 0 },
    { href: '#stale', label: 'Stale Docs', show: cov.staleFiles.length > 0 },
    { href: '#patterns', label: 'Patterns', show: true },
    { href: '#directories', label: 'Directories', show: true },
    { href: '#trend', label: 'Trend', show: data.dailyTrend.length > 1 },
    { href: '#insights', label: 'Insights', show: true },
    { href: '#dead', label: 'Unread Docs', show: data.deadFiles.length > 0 },
  ]

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Workspace Heatmap — ${esc(wsName)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #f8fafc; color: #334155; line-height: 1.65; padding: 48px 24px; }
    .container { max-width: 860px; margin: 0 auto; }
    h1 { font-size: 32px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
    h2 { font-size: 20px; font-weight: 600; color: #0f172a; margin-top: 48px; margin-bottom: 16px; }
    .subtitle { color: #64748b; font-size: 15px; margin-bottom: 32px; }
    .nav-toc { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 32px 0; padding: 16px; background: white; border-radius: 8px; border: 1px solid #e2e8f0; }
    .nav-toc a { font-size: 12px; color: #64748b; text-decoration: none; padding: 6px 12px; border-radius: 6px; background: #f1f5f9; transition: all 0.15s; }
    .nav-toc a:hover { background: #e2e8f0; color: #334155; }
    .stats-row { display: flex; gap: 24px; margin-bottom: 40px; padding: 20px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
    .stat { text-align: center; min-width: 80px; }
    .stat-value { font-size: 24px; font-weight: 700; color: #0f172a; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; }
    .at-a-glance { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #f59e0b; border-radius: 12px; padding: 20px 24px; margin-bottom: 32px; }
    .glance-title { font-size: 16px; font-weight: 700; color: #92400e; margin-bottom: 16px; }
    .glance-sections { display: flex; flex-direction: column; gap: 12px; }
    .glance-section { font-size: 14px; color: #78350f; line-height: 1.6; }
    .glance-section strong { color: #92400e; }
    .glance-section code { background: rgba(255,255,255,0.5); padding: 1px 5px; border-radius: 3px; font-size: 13px; }
    .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
    .chart-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .chart-card.full { grid-column: 1 / -1; }
    .chart-title { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; margin-bottom: 12px; }
    .bar-row { display: flex; align-items: center; margin-bottom: 6px; }
    .bar-label { width: 130px; font-size: 11px; color: #475569; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar-track { flex: 1; height: 6px; background: #f1f5f9; border-radius: 3px; margin: 0 8px; }
    .bar-fill { height: 100%; border-radius: 3px; }
    .bar-value { width: 36px; font-size: 11px; font-weight: 500; color: #64748b; text-align: right; }
    .tier-section { margin-bottom: 32px; }
    .tier-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0; }
    .tier-emoji { font-size: 18px; }
    .tier-label { font-size: 14px; font-weight: 600; }
    .tier-count-badge { font-size: 11px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 4px; margin-left: auto; }
    .file-row { display: grid; grid-template-columns: minmax(0, 1.2fr) 1fr 40px minmax(0, 0.8fr); align-items: center; padding: 6px 0; gap: 8px; }
    .file-name { font-size: 12px; font-family: 'SF Mono', SFMono-Regular, Consolas, monospace; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-count { font-size: 12px; font-weight: 600; color: #0f172a; text-align: right; }
    .file-meta { font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dead-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-top: 16px; }
    .dead-file { font-size: 12px; font-family: 'SF Mono', SFMono-Regular, Consolas, monospace; color: #94a3b8; padding: 3px 0; }
    .insight-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .insight-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .insight-icon { font-size: 18px; }
    .insight-title { font-weight: 600; font-size: 14px; color: #0f172a; }
    .insight-desc { font-size: 13px; color: #475569; line-height: 1.6; }
    .trend-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 16px 8px; margin: 24px 0; }
    .trend-card svg { display: block; }
    .fun-ending { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 1px solid #fbbf24; border-radius: 12px; padding: 24px; margin-top: 40px; text-align: center; }
    .fun-headline { font-size: 18px; font-weight: 600; color: #78350f; margin-bottom: 8px; }
    .fun-detail { font-size: 14px; color: #92400e; }
    .footer { text-align: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #e2e8f0; }
    .footer a { color: #64748b; text-decoration: none; font-size: 13px; }
    .footer a:hover { color: #334155; }
    /* Coverage card */
    .coverage-card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .coverage-header { display: flex; align-items: center; gap: 24px; margin-bottom: 20px; flex-wrap: wrap; }
    .coverage-score { text-align: center; min-width: 120px; }
    .coverage-pct { font-size: 42px; font-weight: 700; line-height: 1; }
    .coverage-sublabel { font-size: 12px; color: #64748b; margin-top: 4px; }
    .coverage-detail { flex: 1; min-width: 200px; }
    .coverage-detail-line { font-size: 14px; color: #475569; margin-bottom: 6px; }
    .coverage-bar-track { width: 100%; height: 10px; background: #f1f5f9; border-radius: 5px; overflow: hidden; margin: 12px 0; }
    .coverage-bar-fill { height: 100%; border-radius: 5px; }
    .unread-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; margin-top: 12px; }
    .unread-file { font-size: 11px; font-family: 'SF Mono', SFMono-Regular, Consolas, monospace; color: #94a3b8; padding: 4px 8px; background: #f8fafc; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Boot sequence */
    .boot-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .boot-row { display: flex; align-items: center; padding: 10px 0; gap: 12px; border-bottom: 1px solid #f1f5f9; }
    .boot-row:last-child { border-bottom: none; }
    .boot-rank { font-size: 16px; font-weight: 700; color: #94a3b8; width: 28px; text-align: center; }
    .boot-file { font-size: 13px; font-family: 'SF Mono', SFMono-Regular, Consolas, monospace; color: #334155; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .boot-pct-bar { width: 100px; height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden; }
    .boot-pct-fill { height: 100%; background: #059669; border-radius: 3px; }
    .boot-pct { font-size: 13px; font-weight: 600; color: #059669; width: 64px; text-align: right; white-space: nowrap; }
    /* Token budget */
    .token-summary-row { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
    .token-summary-card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; flex: 1; min-width: 140px; text-align: center; }
    .token-big { font-size: 28px; font-weight: 700; color: #0f172a; }
    .token-label { font-size: 11px; color: #64748b; text-transform: uppercase; margin-top: 2px; }
    .token-table { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .token-row { display: grid; grid-template-columns: 1fr 100px 80px 80px; align-items: center; padding: 6px 0; gap: 8px; border-bottom: 1px solid #f8fafc; }
    .token-row:last-child { border-bottom: none; }
    .token-file { font-size: 12px; font-family: 'SF Mono', SFMono-Regular, Consolas, monospace; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .token-calc { font-size: 11px; color: #94a3b8; text-align: right; }
    .token-reads { font-size: 11px; color: #64748b; text-align: center; }
    .token-total { font-size: 12px; font-weight: 600; color: #0f172a; text-align: right; }
    /* Stale documentation */
    .stale-card { background: white; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .stale-row { display: flex; align-items: center; padding: 10px 0; gap: 12px; border-bottom: 1px solid #fef3c7; }
    .stale-row:last-child { border-bottom: none; }
    .stale-icon { font-size: 16px; flex-shrink: 0; }
    .stale-file { font-size: 13px; font-family: 'SF Mono', SFMono-Regular, Consolas, monospace; color: #334155; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .stale-detail { font-size: 12px; color: #92400e; white-space: nowrap; }
    @media (max-width: 640px) { .charts-row { grid-template-columns: 1fr; } .stats-row { justify-content: center; } .file-row { grid-template-columns: minmax(0, 1fr) 80px 30px; } .file-meta { display: none; } .coverage-header { flex-direction: column; text-align: center; } .token-row { grid-template-columns: 1fr 60px 60px; } .token-calc { display: none; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Workspace Heatmap</h1>
    <p class="subtitle">${esc(wsName)} · ${data.total} reads across ${data.uniqueFiles} files · ${formatDate(data.firstRead)} to ${formatDate(data.lastRead)}</p>

    ${glance.length > 0 ? `
    <div class="at-a-glance">
      <div class="glance-title">At a Glance</div>
      <div class="glance-sections">
        ${glance.map(g => `<div class="glance-section">${g}</div>`).join('')}
      </div>
    </div>` : ''}

    <nav class="nav-toc">
      ${navLinks.filter(l => l.show).map(l => `<a href="${l.href}">${l.label}</a>`).join('\n      ')}
    </nav>

    <div class="stats-row">
      <div class="stat"><div class="stat-value">${data.total}</div><div class="stat-label">Total Reads</div></div>
      <div class="stat"><div class="stat-value">${data.uniqueFiles}</div><div class="stat-label">Files Read</div></div>
      <div class="stat"><div class="stat-value">${data.uniqueSessions}</div><div class="stat-label">Sessions</div></div>
      <div class="stat"><div class="stat-value">${data.tiers.hot.length}</div><div class="stat-label">Hot Files</div></div>
      ${cov.mdTotal > 0 ? `<div class="stat"><div class="stat-value" style="color:${covPctColor}">${cov.mdCoverage}%</div><div class="stat-label">Doc Coverage</div></div>` : ''}
      <div class="stat"><div class="stat-value">${data.deadFiles.length}</div><div class="stat-label">Unread Docs</div></div>
      <div class="stat"><div class="stat-value">${data.days}d</div><div class="stat-label">Period</div></div>
    </div>

    ${cov.mdTotal > 0 ? `
    <h2 id="doc-health">📋 Documentation Health</h2>
    <div class="coverage-card">
      <div class="coverage-header">
        <div class="coverage-score">
          <div class="coverage-pct" style="color:${covPctColor}">${cov.mdCoverage}%</div>
          <div class="coverage-sublabel">${cov.mdRead} of ${cov.mdTotal} .md files</div>
        </div>
        <div class="coverage-detail">
          <div class="coverage-detail-line">Your agent reads <strong>${cov.mdRead}</strong> of <strong>${cov.mdTotal}</strong> markdown files in your workspace.</div>
          ${cov.mdUnread.length > 0 ? `<div class="coverage-detail-line" style="color:#94a3b8">${cov.mdUnread.length} documentation file${cov.mdUnread.length !== 1 ? 's' : ''} never touched — either unnecessary or hidden from your agent.</div>` : '<div class="coverage-detail-line" style="color:#059669">All markdown files are being read. Excellent coverage!</div>'}
          <div class="coverage-bar-track">
            <div class="coverage-bar-fill" style="width:${cov.mdCoverage}%;background:${covPctColor}"></div>
          </div>
        </div>
      </div>
      ${cov.mdUnread.length > 0 ? `
      <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:8px;">Unread Documentation</div>
      <div class="unread-grid">
        ${cov.mdUnread.slice(0, 20).map(f => `<div class="unread-file" title="${esc(f)}">${esc(f)}</div>`).join('')}
      </div>
      ${cov.mdUnread.length > 20 ? `<div style="font-size:12px;color:#94a3b8;margin-top:8px;">… and ${cov.mdUnread.length - 20} more</div>` : ''}` : ''}
    </div>` : ''}

    ${cov.bootFiles.length > 0 ? `
    <h2 id="boot">🚀 Boot Sequence</h2>
    <p style="font-size:13px;color:#64748b;margin-bottom:16px;">Files consistently loaded in the first 5 reads of each session. These form your agent's startup sequence.</p>
    <div class="boot-card">
      ${cov.bootFiles.slice(0, 10).map((bf, i) => `
      <div class="boot-row">
        <div class="boot-rank">${i + 1}</div>
        <div class="boot-file" title="${esc(bf.file)}">${esc(bf.file)}</div>
        <div class="boot-pct-bar"><div class="boot-pct-fill" style="width:${bf.pct}%"></div></div>
        <div class="boot-pct">${bf.pct}% <span style="font-weight:400;color:#94a3b8;font-size:11px">(${bf.sessions}/${bf.totalSessions})</span></div>
      </div>`).join('')}
    </div>` : ''}

    <h2 id="heatmap">File Heatmap</h2>

    ${Object.entries(tierMeta).map(([tier, meta]) => {
      const files = data.tiers[tier]
      if (files.length === 0) return ''
      return `
    <div class="tier-section">
      <div class="tier-header">
        <span class="tier-emoji">${meta.emoji}</span>
        <span class="tier-label" style="color:${meta.color}">${meta.label}</span>
        <span class="tier-count-badge">${files.length} file${files.length !== 1 ? 's' : ''}</span>
      </div>
      ${renderFileRows(files, meta.color)}
      ${files.length > 15 ? `<div style="font-size:12px;color:#94a3b8;padding:8px 0;">… and ${files.length - 15} more</div>` : ''}
    </div>`
    }).join('')}

    ${cov.tokenEstimates.length > 0 ? `
    <h2 id="tokens">💰 Token Budget</h2>
    <p style="font-size:13px;color:#64748b;margin-bottom:16px;">Estimated token cost of file reads (rough: file size ÷ 4 bytes per token).</p>
    <div class="token-summary-row">
      <div class="token-summary-card">
        <div class="token-big">${formatTokens(cov.totalTokens)}</div>
        <div class="token-label">Est. Total Tokens</div>
      </div>
      <div class="token-summary-card">
        <div class="token-big">${cov.tokenEstimates.length}</div>
        <div class="token-label">Files Costed</div>
      </div>
      ${data.uniqueSessions > 0 ? `
      <div class="token-summary-card">
        <div class="token-big">${formatTokens(Math.round(cov.totalTokens / data.uniqueSessions))}</div>
        <div class="token-label">Per Session</div>
      </div>` : ''}
    </div>
    <div class="token-table">
      <div class="token-row" style="font-weight:600;font-size:11px;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">
        <div>File</div>
        <div style="text-align:right">Tokens/Read</div>
        <div style="text-align:center">Reads</div>
        <div style="text-align:right">Total</div>
      </div>
      ${cov.tokenEstimates.slice(0, 15).map(te => `
      <div class="token-row">
        <div class="token-file" title="${esc(te.file)}">${esc(te.file)}</div>
        <div class="token-calc">~${formatTokens(te.tokens)}</div>
        <div class="token-reads">${te.reads}×</div>
        <div class="token-total">${formatTokens(te.total)}</div>
      </div>`).join('')}
      ${cov.tokenEstimates.length > 15 ? `<div style="font-size:12px;color:#94a3b8;padding:8px 0;">… and ${cov.tokenEstimates.length - 15} more files</div>` : ''}
    </div>` : ''}

    ${cov.staleFiles.length > 0 ? `
    <h2 id="stale">⏰ Stale Documentation</h2>
    <p style="font-size:13px;color:#64748b;margin-bottom:16px;">Files read frequently (10+ times) but not modified in over 2× the reporting period. May contain outdated information.</p>
    <div class="stale-card">
      ${cov.staleFiles.slice(0, 10).map(sf => `
      <div class="stale-row">
        <div class="stale-icon">⚠️</div>
        <div class="stale-file" title="${esc(sf.file)}">${esc(sf.file)}</div>
        <div class="stale-detail">${sf.reads} reads · modified ${formatAge(sf.modifiedAge)}</div>
      </div>`).join('')}
    </div>` : ''}

    <h2 id="patterns">Access Patterns</h2>
    <div class="charts-row">
      <div class="chart-card">
        <div class="chart-title">Reads by Time of Day (UTC)</div>
        ${periodCounts.map(p => `
        <div class="bar-row">
          <div class="bar-label">${p.label}</div>
          ${barHtml(p.count, maxPeriod, '#8b5cf6')}
          <div class="bar-value">${p.count}</div>
        </div>`).join('')}
      </div>
      <div class="chart-card">
        <div class="chart-title">Reads by Day of Week</div>
        ${dowLabels.map((label, i) => `
        <div class="bar-row">
          <div class="bar-label">${label}</div>
          ${barHtml(data.dowCounts[i], maxDow, '#0891b2')}
          <div class="bar-value">${data.dowCounts[i]}</div>
        </div>`).join('')}
      </div>
    </div>

    <div class="charts-row">
      <div class="chart-card">
        <div class="chart-title">Top File Extensions</div>
        ${data.extSorted.slice(0, 8).map(([ext, count]) => `
        <div class="bar-row">
          <div class="bar-label">.${esc(ext)}</div>
          ${barHtml(count, data.extSorted[0]?.[1] || 1, '#10b981')}
          <div class="bar-value">${count}</div>
        </div>`).join('')}
      </div>
      <div class="chart-card">
        <div class="chart-title">Top Sessions (by reads)</div>
        ${data.sessionSorted.length > 0 ? data.sessionSorted.slice(0, 8).map(([sess, count]) => `
        <div class="bar-row">
          <div class="bar-label">${esc(sess.slice(0, 12))}</div>
          ${barHtml(count, data.sessionSorted[0]?.[1] || 1, '#6366f1')}
          <div class="bar-value">${count}</div>
        </div>`).join('') : '<div style="font-size:13px;color:#94a3b8;">No session data available</div>'}
      </div>
    </div>

    <h2 id="directories">Directory Heatmap</h2>
    <div class="chart-card full" style="margin-bottom:24px;">
      <div class="chart-title">Reads by Directory</div>
      ${data.dirSorted.slice(0, 12).map(([dir, count]) => `
      <div class="bar-row">
        <div class="bar-label" title="${esc(dir)}">${esc(dir)}</div>
        ${barHtml(count, data.dirSorted[0]?.[1] || 1, '#d946ef')}
        <div class="bar-value">${count}</div>
      </div>`).join('')}
      ${data.dirSorted.length > 12 ? `<div style="font-size:12px;color:#94a3b8;padding:8px 0;">… and ${data.dirSorted.length - 12} more directories</div>` : ''}
    </div>

    ${data.dailyTrend.length > 1 ? `
    <h2 id="trend">Daily Trend</h2>
    <div class="trend-card">
      <div class="chart-title">Reads per Day</div>
      <svg width="100%" viewBox="0 0 ${trendW} ${trendH + 20}" preserveAspectRatio="none">
        <polyline points="${trendPoints}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round" />
        <polyline points="0,${trendH + 5} ${trendPoints} ${trendW},${trendH + 5}" fill="url(#grad)" stroke="none" />
        <defs>
          <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2563eb" stop-opacity="0.15" />
            <stop offset="100%" stop-color="#2563eb" stop-opacity="0.01" />
          </linearGradient>
        </defs>
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;padding-top:4px;">
        <span>${data.dailyTrend[0]?.[0] || ''}</span>
        <span>${data.dailyTrend[data.dailyTrend.length - 1]?.[0] || ''}</span>
      </div>
    </div>` : ''}

    <h2 id="insights">Insights</h2>
    ${insights.map(i => `
    <div class="insight-card">
      <div class="insight-header">
        <span class="insight-icon">${i.icon}</span>
        <span class="insight-title">${esc(i.title)}</span>
      </div>
      <div class="insight-desc">${esc(i.desc)}</div>
    </div>`).join('')}

    ${data.deadFiles.length > 0 ? `
    <h2 id="dead">Unread Documentation</h2>
    <p style="font-size:13px;color:#64748b;margin-bottom:12px;">These ${data.deadFiles.length} .md files exist in your workspace but have never been read by your agent.</p>
    <div class="dead-section">
      ${data.deadFiles.slice(0, 30).map(f => `<div class="dead-file">${esc(f)}</div>`).join('')}
      ${data.deadFiles.length > 30 ? `<div style="font-size:12px;color:#94a3b8;padding-top:8px;">… and ${data.deadFiles.length - 30} more</div>` : ''}
    </div>` : ''}

    ${data.total > 0 && data.tiers.hot.length > 0 ? `
    <div class="fun-ending">
      <div class="fun-headline">Your agent read ${esc(data.tiers.hot[0].file)} ${data.tiers.hot[0].count} times in ${data.days} days</div>
      <div class="fun-detail">That's ${Math.round(data.tiers.hot[0].count / data.days * 10) / 10}× per day. ${data.tiers.hot[0].count > 50 ? 'Maybe it\'s time to put that file on a diet. 🥗' : 'Seems about right. 👍'}</div>
    </div>` : ''}

    <div class="footer">
      <a href="https://github.com/fulf/workspace-heatmap">workspace-heatmap</a> · Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC
    </div>
  </div>
</body>
</html>`
}

/* ── Export ─────────────────────────────────────────────────────────── */

export function insights({ dir = null, workspace = null, days = 30, output = null, open = true }) {
  const ws = workspace || process.cwd()
  const heatmapDir = dir || resolve(ws, DEFAULT_DIR)
  const entries = loadEntries(heatmapDir, days)

  if (entries.length === 0) {
    console.log('\x1b[33mNo access data found.\x1b[0m Run \x1b[36mwhm init\x1b[0m to start tracking.')
    return null
  }

  const allFiles = getAllWorkspaceFiles(ws)
  const data = analyze(entries, allFiles, ws, days)
  const html = generateHtml(data, ws)

  const outPath = output || join(heatmapDir, 'insights.html')
  writeFileSync(outPath, html)
  console.log(`\x1b[32m✓\x1b[0m Report generated: ${outPath}`)
  console.log(`  ${data.total} reads · ${data.uniqueFiles} files · ${data.uniqueSessions} sessions · ${days} day window`)
  if (data.coverage.mdTotal > 0) {
    console.log(`  📋 Doc coverage: ${data.coverage.mdCoverage}% (${data.coverage.mdRead}/${data.coverage.mdTotal} .md files)`)
  }
  if (data.coverage.totalTokens > 0) {
    console.log(`  💰 Est. token spend: ~${formatTokens(data.coverage.totalTokens)}`)
  }

  if (open) {
    try {
      const cmds = ['xdg-open', 'open', 'start']
      for (const cmd of cmds) {
        try {
          execFileSync('which', [cmd], { stdio: 'ignore' })
          execFileSync(cmd, [outPath], { stdio: 'ignore' })
          break
        } catch {}
      }
    } catch {}
  }

  return outPath
}
