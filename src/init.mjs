#!/usr/bin/env node
/**
 * Init — detect environment and install tracking hooks.
 * Supports Claude Code (.claude/settings.json) and OpenClaw (AGENTS.md).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { execSync } from 'node:child_process'

const DEFAULT_DIR = '.heatmap'

/**
 * Reject paths containing characters that are dangerous in shell interpolation.
 * Throws if the path contains ", `, $, or \.
 */
function validatePath(p) {
  if (/["`$\\]/.test(p)) {
    throw new Error(
      `Path contains shell-unsafe characters (", \`, $, \\) and cannot be used in hook commands: ${p}`
    )
  }
}

/**
 * Extract @file references from a markdown file's content.
 * Matches patterns like @SOUL.md, @docs/setup.md, @./relative/path.md
 * Avoids matching email addresses or @mentions.
 */
function extractAtReferences(content) {
  const refs = []
  // Match @path where path looks like a file (contains . or /)
  // Negative lookbehind for word chars (avoids email@domain)
  const pattern = /(?<![.\w])@((?:\.\/)?[\w./_-]+\.[\w]+)/g
  let match
  while ((match = pattern.exec(content)) !== null) {
    refs.push(match[1])
  }
  return refs
}

/**
 * Recursively collect all files referenced via @file chains starting from a root file.
 * Returns a Set of relative file paths (including the root).
 */
function collectAtReferenceChain(workspace, rootFile, visited = new Set()) {
  if (visited.has(rootFile)) return visited
  const fullPath = join(workspace, rootFile)
  if (!existsSync(fullPath)) return visited

  visited.add(rootFile)

  try {
    const content = readFileSync(fullPath, 'utf-8')
    const refs = extractAtReferences(content)
    for (const ref of refs) {
      // Resolve relative to the referencing file's directory
      const refDir = dirname(rootFile)
      const resolved = refDir === '.' ? ref : join(refDir, ref)
      // Also try relative to workspace root
      const candidates = [resolved, ref]
      for (const candidate of candidates) {
        if (!visited.has(candidate) && existsSync(join(workspace, candidate))) {
          collectAtReferenceChain(workspace, candidate, visited)
          break
        }
      }
    }
  } catch {}

  return visited
}

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
    claudeCode: existsSync(join(workspace, '.claude')) || existsSync(join(workspace, 'CLAUDE.md')),
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

  // Add PostToolUse hooks for file-reading tools (Claude Code 2025+ format)
  if (!settings.hooks) settings.hooks = {}
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = []

  // Check if already installed (check both old and new format)
  const existingNew = settings.hooks.PostToolUse?.find(h =>
    h.hooks?.some(hk => hk.command?.includes('workspace-heatmap') || hk.command?.includes('tracker.mjs'))
  )
  const existingOld = settings.hooks.postToolExecution?.find(h =>
    h.command?.includes('workspace-heatmap') || h.command?.includes('tracker.mjs')
  )
  if (existingNew || existingOld) {
    return { installed: false, reason: 'already installed' }
  }

  // Migrate old format if present
  if (settings.hooks.postToolExecution) {
    delete settings.hooks.postToolExecution
  }

  // Validate paths before interpolating into shell command
  const heatmapDir = join(workspace, DEFAULT_DIR)
  if (trackerPath) validatePath(trackerPath)
  validatePath(heatmapDir)

  const cmd = trackerPath
    ? `node "${trackerPath}" --stdin --dir "${heatmapDir}"`
    : `npx -y workspace-heatmap track --stdin --dir "${heatmapDir}"`

  // Track Read and Grep (file-reading tools)
  const trackedTools = ['Read', 'Grep']
  for (const tool of trackedTools) {
    settings.hooks.PostToolUse.push({
      matcher: tool,
      hooks: [{ type: 'command', command: cmd }],
    })
  }

  // Track CLAUDE.md + all @file reference chains on session start
  // (Claude Code reads these automatically, not via the Read tool)
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = []
  const claudeMdPath = join(workspace, 'CLAUDE.md')
  if (existsSync(claudeMdPath)) {
    const autoReadFiles = collectAtReferenceChain(workspace, 'CLAUDE.md')
    const hookCommands = []
    for (const file of autoReadFiles) {
      validatePath(file)
      const fileCmd = trackerPath
        ? `node "${trackerPath}" "${file}" --dir "${heatmapDir}"`
        : `npx -y workspace-heatmap track "${file}" --dir "${heatmapDir}"`
      hookCommands.push({ type: 'command', command: fileCmd })
    }
    if (hookCommands.length > 0) {
      settings.hooks.SessionStart.push({
        hooks: hookCommands,
      })
    }
  }

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
