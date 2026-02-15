#!/usr/bin/env node
/**
 * Init — detect environment and install tracking hooks.
 * Supports Claude Code (.claude/settings.json) and OpenClaw (AGENTS.md).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { execSync } from 'node:child_process'

const DEFAULT_DIR = '.heatmap'

function findPackageBin() {
  // Try to find the installed tracker path
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim()
    const trackerPath = join(globalRoot, 'workspace-heatmap', 'src', 'tracker.mjs')
    if (existsSync(trackerPath)) return trackerPath
  } catch {}

  try {
    const bunRoot = join(process.env.HOME, '.bun', 'install', 'global', 'node_modules')
    const trackerPath = join(bunRoot, 'workspace-heatmap', 'src', 'tracker.mjs')
    if (existsSync(trackerPath)) return trackerPath
  } catch {}

  // Fallback: use npx
  return null
}

function detectEnvironment(workspace) {
  const indicators = {
    claudeCode: existsSync(join(workspace, '.claude')),
    openClaw: existsSync(join(workspace, 'AGENTS.md')) && existsSync(join(workspace, 'SOUL.md')),
    git: existsSync(join(workspace, '.git')),
  }

  return indicators
}

function initClaudeCode(workspace, trackerPath) {
  const settingsDir = join(workspace, '.claude')
  const settingsFile = join(settingsDir, 'settings.json')

  if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true })

  let settings = {}
  if (existsSync(settingsFile)) {
    try { settings = JSON.parse(readFileSync(settingsFile, 'utf-8')) } catch { settings = {} }
  }

  // Add postToolExecution hook for Read tool
  if (!settings.hooks) settings.hooks = {}
  if (!settings.hooks.postToolExecution) settings.hooks.postToolExecution = []

  // Check if already installed
  const existing = settings.hooks.postToolExecution.find(h =>
    h.command?.includes('workspace-heatmap') || h.command?.includes('tracker.mjs')
  )
  if (existing) {
    return { installed: false, reason: 'already installed' }
  }

  const cmd = trackerPath
    ? `node "${trackerPath}" "$FILE_PATH" --dir "${join(workspace, DEFAULT_DIR)}"`
    : `npx -y workspace-heatmap track "$FILE_PATH" --dir "${join(workspace, DEFAULT_DIR)}"`

  settings.hooks.postToolExecution.push({
    matcher: 'Read',
    command: cmd,
  })

  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n')
  return { installed: true, file: settingsFile }
}

function initOpenClaw(workspace) {
  const agentsFile = join(workspace, 'AGENTS.md')
  if (!existsSync(agentsFile)) {
    return { installed: false, reason: 'AGENTS.md not found' }
  }

  const content = readFileSync(agentsFile, 'utf-8')

  // Check if already installed
  if (content.includes('workspace-heatmap') || content.includes('ReadTracked')) {
    return { installed: false, reason: 'already installed' }
  }

  const instruction = `

## File Access Tracking (workspace-heatmap)

After every file read, log the access for heatmap tracking:
\`\`\`bash
node ${join(workspace, 'node_modules', 'workspace-heatmap', 'src', 'tracker.mjs')} "<file_path>"
\`\`\`
Or if installed globally: \`whm track "<file_path>"\`
This is silent and fast (<5ms). Do it after every \`read\` call.
`

  writeFileSync(agentsFile, content + instruction)
  return { installed: true, file: agentsFile }
}

export function init({ workspace = null, force = false }) {
  const ws = workspace || process.cwd()
  const env = detectEnvironment(ws)
  const heatmapDir = join(ws, DEFAULT_DIR)
  const trackerPath = findPackageBin()

  // Create .heatmap directory
  if (!existsSync(heatmapDir)) {
    mkdirSync(heatmapDir, { recursive: true })
  }

  // Add .heatmap to .gitignore
  const gitignorePath = join(ws, '.gitignore')
  if (env.git) {
    let gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : ''
    if (!gitignore.includes('.heatmap')) {
      gitignore += '\n# Workspace heatmap data\n.heatmap/\n'
      writeFileSync(gitignorePath, gitignore)
    }
  }

  const results = {
    workspace: ws,
    environment: env,
    heatmapDir,
    installations: [],
  }

  if (env.claudeCode) {
    const result = initClaudeCode(ws, trackerPath)
    results.installations.push({ target: 'claude-code', ...result })
  }

  if (env.openClaw) {
    const result = initOpenClaw(ws)
    results.installations.push({ target: 'openclaw', ...result })
  }

  if (!env.claudeCode && !env.openClaw) {
    // Generic — just create the directory and tell them how to use it
    results.installations.push({
      target: 'generic',
      installed: true,
      note: 'Created .heatmap/ directory. Use `whm track <file>` to log reads manually.',
    })
  }

  return results
}
