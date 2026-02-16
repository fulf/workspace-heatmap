# workspace-heatmap 📊

Track which files your AI agent actually reads. Discover what's hot, what's cold, and what's dead weight in your workspace.

## Why?

AI agents read workspace files every session — but do they read *all* of them? Most workspaces accumulate files that nobody (human or AI) touches. Each unread file is wasted context, wasted tokens, or a sign your agent is missing important information.

**workspace-heatmap** silently tracks every file read and generates a heatmap showing:
- 🔴 **Hot** files — read daily (keep lean, they're your token budget)
- 🟡 **Warm** files — read weekly (working memory)
- 🔵 **Cold** files — rarely read (candidates for skills or archiving)
- ⚫ **Dead** files — never read (prune or investigate why)

## Quick Start

```bash
# Install globally
npm install -g workspace-heatmap

# Set up tracking in your agent workspace
cd ~/my-agent-workspace
whm init

# After a few sessions, check the heatmap
whm report
```

## How It Works

### Claude Code
`whm init` adds a `postToolExecution` hook to `.claude/settings.json`. Every time Claude Code uses the `Read` tool, the hook silently logs the file path. Zero friction — the agent doesn't know it's being tracked.

### OpenClaw
`whm init` adds tracking instructions to `AGENTS.md`. The agent logs reads as part of its normal workflow.

### Retroactive Mining
Already have session transcripts? Mine them:

```bash
# OpenClaw transcripts
whm mine ~/.openclaw/agents/main/sessions/

# Multiple directories
whm mine ./sessions/ /other/sessions/ --format openclaw
```

## Commands

| Command | Description |
|---------|-------------|
| `whm init` | Set up tracking (detects Claude Code / OpenClaw automatically) |
| `whm track <file>` | Log a single file read (used by hooks) |
| `whm report` | Show the workspace heatmap (terminal) |
| `whm insights` | Generate a beautiful HTML report |
| `whm mine <dir>` | Extract reads from session transcripts |
| `whm status` | Show tracking status and stats |

### Report Options

```bash
whm report              # Last 30 days (terminal)
whm report --days 7     # Last 7 days  
whm report --all        # Include dead (never-read) files
whm report --json       # JSON output for scripting
```

### Insights (HTML Report)

Generate a rich, visual HTML report inspired by Claude Code's `/insights`:

```bash
whm insights                        # Open in browser
whm insights --days 14              # Last 14 days
whm insights --output report.html   # Custom output path
whm insights --no-open              # Don't auto-open
```

The report includes:
- 📊 At-a-glance summary with workspace health assessment
- 🔴🟡🔵 File heatmap with tiers (hot/warm/cold/dead)
- 📈 Daily trend sparkline
- 🕐 Access patterns (time of day, day of week)
- 📁 Directory heatmap
- 💡 Actionable insights and recommendations

## Example Output

```
📊 Workspace File Heatmap (last 30 days, 847 reads)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 HOT — read daily
  AGENTS.md                            ████████████████████  142   2h ago
  MEMORY.md                            ███████████████████   128   2h ago
  memory/2026-02-15.md                 ██████████████         87   3h ago

🟡 WARM — read weekly
  TOOLS.md                             ████████               52   1d ago
  USER.md                              ███████                44   1d ago
  SOUL.md                              ██████                 38   2d ago

🔵 COLD — read rarely
  IDENTITY.md                          ██                      8   5d ago
  ideas/032-superset-assistant.md      █                       3  12d ago

⚫ DEAD — never read (12 files)
  ideas/001-specialized-agents.md
  old-notes/setup-log.md
  ...

💡 Insights
  → AGENTS.md is 17% of all reads — keep it lean
  → 8 files rarely read — consider moving to skills or archiving
  → 12 files never read — dead weight in your workspace
  → Tracked across 34 sessions
```

## Data Format

Reads are stored in `.heatmap/access.jsonl` (one JSON line per read):

```json
{"f":"MEMORY.md","ts":1739661600,"s":"abc123"}
{"f":"memory/2026-02-15.md","ts":1739661605,"tool":"Read","s":"abc123"}
```

Fields:
- `f` — file path (relative to workspace)
- `ts` — Unix timestamp
- `s` — session ID (optional)
- `tool` — tool name if not "Read" (optional)
- `src` — "mined" if retroactively extracted (optional)

## Programmatic API

```javascript
import { track, report, mine, init } from 'workspace-heatmap'

// Track a read
track({ file: 'MEMORY.md', session: 'abc123' })

// Generate report
report({ days: 7, all: true })

// Mine transcripts
mine({ transcriptDirs: ['./sessions/'], format: 'openclaw' })
```

## FAQ

**Does this slow down my agent?**
No. The tracker appends one line to a JSONL file (~0.1ms). The hook runs after the Read completes, not before.

**Will my agent see the tracking?**
With Claude Code hooks: no, it's invisible. With OpenClaw: the agent runs the tracker command, but it's silent.

**How big does the log get?**
~100 bytes per read. At 100 reads/day, that's ~3KB/day or ~1MB/year. Negligible.

**Can I track writes too?**
Not yet, but the architecture supports it. PRs welcome.

## License

MIT
