# workspace-heatmap 📊

Track which files your AI agent actually reads. Discover what's hot, what's cold, and what's dead weight in your workspace.

## Why?

AI agents read workspace files every session — but do they read *all* of them? Most workspaces accumulate files that nobody (human or AI) touches. Each unread file is wasted context, wasted tokens, or a sign your agent is missing important information.

**workspace-heatmap** silently tracks every file read and generates a heatmap showing:
- 🔴 **Hot** files — read daily (keep lean, they're your token budget)
- 🟡 **Warm** files — read weekly (working memory)
- 🔵 **Cold** files — rarely read (candidates for skills or archiving)
- ⚫ **Dead** files — never read (prune or investigate why)
- 📋 **Documentation coverage** — what % of your .md files are actually read?
- 🚀 **Boot sequence** — which files your agent loads first, every session
- ⏰ **Stale docs** — frequently read but never updated
- 💰 **Token budget** — estimated token cost of all file reads

## Quick Start

```bash
# Install globally
npm install -g workspace-heatmap

# Set up tracking in your agent workspace
cd ~/my-agent-workspace
whm init

# After a few sessions, check the heatmap
whm report

# Generate a beautiful HTML report
whm insights
```

Or use directly without installing:

```bash
npx workspace-heatmap init
npx whm report
```

## How It Works

### Claude Code
`whm init` adds a `postToolExecution` hook to `.claude/settings.json`. Every time Claude Code uses the `Read` tool, the hook silently logs the file path. Zero friction — the agent doesn't know it's being tracked.

### OpenClaw
`whm init` adds tracking instructions to `AGENTS.md`. The agent logs reads as part of its normal workflow.

### Retroactive Mining
Already have session transcripts? Mine them:

```bash
# Auto-detects format (OpenClaw or Claude Code)
whm mine ~/.openclaw/agents/main/sessions/
whm mine ~/.claude/projects/*/

# Multiple directories
whm mine ./sessions/ /other/sessions/

# Include Write/Edit tracking too
whm mine ./sessions/ --include-writes

# Re-mine everything (ignores dedup cache)
whm mine ./sessions/ --force
```

The miner automatically deduplicates — running it twice on the same transcripts won't double-count.

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
whm report --days=7     # Also works with = syntax
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
- 📋 **Documentation health** — coverage score, unread .md files
- 🚀 **Boot sequence** — files consistently loaded at session start
- 🔴🟡🔵 File heatmap with tiers (hot/warm/cold/dead)
- 💰 **Token budget** — estimated token cost per file and total
- ⏰ **Stale documentation** — frequently read, rarely updated files
- 📈 Daily trend sparkline
- 🕐 Access patterns (time of day, day of week)
- 📁 Directory heatmap
- 💡 Actionable insights and recommendations

### Mining Options

```bash
whm mine <dir>                    # Auto-detect format, deduplicate
whm mine <dir> --format openclaw  # Force OpenClaw format
whm mine <dir> --format claude-code  # Force Claude Code format
whm mine <dir> --include-writes   # Track Write/Edit too
whm mine <dir> --force            # Re-mine everything
whm mine <dir> --dry-run          # Preview without writing
```

## Documentation Coverage (v0.4.0)

The primary use case improvement: understand whether your AI documentation is actually useful.

### Documentation Health Score

```
📋 Documentation Health
  Coverage: 8 of 23 .md files read (35%)
  Unread:  CONTRIBUTING.md, ideas/001-specialized-agents.md, old-notes/setup-log.md …
```

Counts all `.md` files in your workspace, shows how many your agent actually reads, and lists the unread ones. Low coverage means your agent is missing documentation — or you have files that aren't needed.

### Boot File Detection

```
🚀 Boot Sequence (first 5 reads, >80% of sessions)
  AGENTS.md                   100% (34/34 sessions)
  SOUL.md                      95% (32/34 sessions)
  memory/2026-02-15.md          92% (31/34 sessions)
  USER.md                      41% (14/34 sessions)  ← inconsistent!
```

Identifies files that appear in the first 5 reads of >80% of sessions. These are your agent's "boot files" — its startup sequence. If an important file isn't consistently loaded, something may be wrong with your AGENTS.md instructions.

### Staleness Detection

```
⏰ Stale Documentation (read often, not updated)
  TOOLS.md                     52 reads · last modified 6w ago
  USER.md                      44 reads · last modified 12w ago
```

Cross-references read frequency with file modification time (`mtime`). Files read >10 times but not modified in >2× the reporting period are flagged as potentially stale. Your agent may be consuming outdated information every session.

### Token Cost Estimation

```
💰 Token Budget (estimated)
  AGENTS.md                    ~2,100 tok × 142 = 298K tokens
  MEMORY.md                    ~1,800 tok × 128 = 230K tokens
  SOUL.md                      ~500 tok × 38 = 19K tokens
  ──────────────────────────────────────────────────────────
  Total:                       ~612K tokens on file reads
```

Estimates tokens per file read (file_size_bytes ÷ 4), multiplied by read count. Shows where your token budget is going. A file that costs 2K tokens per read × 142 reads = 284K tokens/month is powerful motivation to trim it.

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

📋 Documentation Health
  Coverage: 8 of 23 .md files read (35%)
  Unread:  CONTRIBUTING.md, ideas/001-specialized-agents.md, ...

🚀 Boot Sequence (first 5 reads, >80% of sessions)
  AGENTS.md                            100% (34/34 sessions)
  SOUL.md                               95% (32/34 sessions)

⏰ Stale Documentation (read often, not updated)
  TOOLS.md                             52 reads · last modified 6w ago

💰 Token Budget (estimated)
  AGENTS.md                            ~2,100 tok × 142 = 298K tokens
  MEMORY.md                            ~1,800 tok × 128 = 230K tokens
  Total:                               ~612K tokens on file reads

💡 Insights
  → AGENTS.md is 17% of all reads — keep it lean
  → 8 files rarely read — consider moving to skills or archiving
  → 12 files never read — dead weight in your workspace
  → Only 35% of .md files read — your agent may be missing documentation
  → Tracked across 34 sessions
```

## Supported Platforms

| Platform | Live Tracking | Transcript Mining |
|----------|:------------:|:-----------------:|
| Claude Code | ✅ (hook) | ✅ |
| OpenClaw | ✅ (AGENTS.md) | ✅ |
| Generic | ✅ (manual `whm track`) | — |

Format auto-detection works by examining transcript content — no configuration needed.

## Data Format

Reads are stored in `.heatmap/access.jsonl` (one JSON line per read):

```json
{"f":"MEMORY.md","ts":1739661600,"s":"abc123"}
{"f":"src/app.ts","ts":1739661605,"tool":"Edit","op":"w","s":"abc123"}
```

Fields:
- `f` — file path (relative to workspace)
- `ts` — Unix timestamp
- `s` — session ID (optional)
- `tool` — tool name if not "Read" (optional)
- `op` — "w" for writes (optional, reads omitted)
- `src` — "mined" if retroactively extracted (optional)

## Programmatic API

```javascript
import { track, report, mine, init, insights } from 'workspace-heatmap'

// Track a read
track({ file: 'MEMORY.md', session: 'abc123' })

// Generate terminal report
report({ days: 7, all: true })

// Generate HTML report
insights({ days: 14, output: './report.html' })

// Mine transcripts
mine({ transcriptDirs: ['./sessions/'], format: 'auto' })
```

## FAQ

**Does this slow down my agent?**
No. The tracker appends one line to a JSONL file (~0.1ms). The hook runs after the Read completes, not before.

**Will my agent see the tracking?**
With Claude Code hooks: no, it's invisible. With OpenClaw: the agent runs the tracker command, but it's silent.

**How big does the log get?**
~100 bytes per read. At 100 reads/day, that's ~3KB/day or ~1MB/year. Negligible.

**Will mining the same transcripts twice duplicate data?**
No. Since v0.3.0, the miner tracks which files have been processed (via content hash) and skips them. Use `--force` to override.

**Can I track writes too?**
Yes! Use `--include-writes` when mining, or log manually: `whm track <file> --tool Write`.

**Do the new features (docs health, boot files, etc.) need re-mining?**
No! All new v0.4.0 features work with existing logged data. No re-mining required.

## License

MIT — see [LICENSE](./LICENSE)
