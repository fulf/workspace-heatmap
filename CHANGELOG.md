# Changelog

## [0.6.3] — 2026-02-18

### Fixed
- **Files outside workspace no longer tracked** — both the live hook tracker and the miner now skip any file paths that resolve outside the workspace directory. Fixes `absolute paths outside the workspace` and other absolute paths appearing in reports.

## [0.6.2] — 2026-02-18

### Fixed
- **Sorting not applied on page load** — "Group folders" checkbox was checked but sort wasn't applied until toggling. Now calls `sortHeatmap()` on initial load.

## [0.6.1] — 2026-02-18

### Added
- **Sorting controls in `whm insights` File Heatmap section** — interactive controls bar above the directory tree:
  - **Sort toggle:** "By Reads" (default, sorts by total read count) and "Alphabetical" (sorts by name)
  - **Group folders checkbox** (default: checked) — when checked, directories are grouped above files at each tree level; when unchecked, directories and files are intermixed and sorted together
  - All client-side vanilla JS — no server round-trip. Sort keys embedded as `data-reads` and `data-name` attributes on each `.dir-node`, `.dir-root-file`, and `.tree-file-row` element
  - Controls styled to match report aesthetic (Inter font, slate pill buttons, rounded toggle group)

## [0.6.0] — 2026-02-18

### Added
- **Interactive directory tree in `whm insights`** — replaces the flat hot/warm/cold file list with a collapsible directory tree. Top-level directories are sorted by total reads; click to expand subdirectories and files. Files inside each directory show count, bar, tier color, last access, and session count. Heat-coded directory dot (🔴/🟡/🔵) based on hottest file in the subtree. All vanilla JS, no dependencies — report stays self-contained.
- **`whm report --depth <n>`** — terminal tree view. Shows directory-level summaries to depth n. Color-codes each directory by heat tier. Root-level files shown below directories sorted by read count.
- **`whm report --dir <path>`** — filter terminal report to only show files within a specific directory path. Combines with `--depth` for tree view within a subtree.
- **`buildDirectoryTree(sorted, fileDataMap)`** helper in `src/utils.mjs` — builds a nested tree structure (`name`, `path`, `totalReads`, `fileCount`, `children`, `files`) from sorted file data, with automatic propagation of totals from leaves to root.

### Changed
- `whm insights` heatmap section now shows `🗂️ File Heatmap` with directory tree instead of tier-grouped flat list
- Old `.tier-section` CSS classes removed; replaced by `.dir-tree`, `.dir-node`, `.dir-header`, `.tree-file-row` etc.

## [0.5.6] — 2026-02-18

### Changed
- **README.md fully rewritten** to reflect current state: PostToolUse stdin hooks, Read+Grep tracking, `@file` reference chain resolution, SessionStart hook for CLAUDE.md, unread docs (.md only), `--version` flag, npx usage notes, existing hooks preservation, and updated FAQ.

## [0.5.5] — 2026-02-18

### Changed
- **Removed Bash from default hooks** — Bash tracking fired on every shell command, added latency, and regex extraction of file paths from commands was too fragile. Default hooks now track `Read` and `Grep` only. Bash parsing still works in the tracker if invoked manually.

## [0.5.4] — 2026-02-18

### Added
- **Recursive `@file` reference tracking** — `CLAUDE.md` can contain `@SOUL.md`, `@docs/setup.md` etc. which Claude Code auto-loads. These referenced files can themselves contain more `@file` references. `whm init` now recursively resolves the entire chain and tracks all auto-loaded files via the SessionStart hook.

## [0.5.3] — 2026-02-18

### Added
- **Track `CLAUDE.md` on session start** — Claude Code reads `CLAUDE.md` automatically at startup (not via the Read tool), so PostToolUse hooks miss it. Now adds a `SessionStart` hook to log the read when `CLAUDE.md` exists in the workspace.

## [0.5.2] — 2026-02-18

### Changed
- **Dead files → Unread Documentation** — dead files section now only shows `.md` files. Code, configs, and non-documentation files are excluded. We care about unread documentation, not whether the agent reads `package.json`.
- Updated all labels: "Dead Files" → "Unread Docs" / "Unread Documentation" in terminal report and HTML insights

## [0.5.1] — 2026-02-18

### Added
- **Multi-tool tracking** — now tracks `Read`, `Grep`, and `Bash` file reads (was Read only)
  - **Grep**: logs the search path (`tool_input.path`)
  - **Bash**: extracts file paths from `cat`, `head`, `tail`, `less`, `more`, `wc`, `sort`, `uniq` and similar commands; ignores non-file-reading commands
- `whm init` registers PostToolUse hooks for all three tools

## [0.5.0] — 2026-02-18

### Fixed
- **Claude Code hook stdin support** — Claude Code hooks receive context via stdin JSON, not `$FILE_PATH` env var. Hook now reads stdin and extracts `tool_input.file_path`. Also captures `session_id` and `tool_name` automatically.

### Added
- `--stdin` flag for `whm track` — reads Claude Code hook JSON from stdin instead of positional file arg
- Auto-detects piped stdin (no `--stdin` flag needed when stdin is not a TTY)
- Session ID extracted from stdin JSON (`session_id` field)

### Changed
- `whm init` now generates stdin-based hook commands for Claude Code

## [0.4.4] — 2026-02-18

### Added
- `whm --version` / `whm -v` / `whm -V` / `whm version` — prints the current version

## [0.4.3] — 2026-02-18

### Fixed
- **Claude Code hooks format corrected** — `matcher` is a string (tool name), not an object. Fixes settings validation error on init.

## [0.4.2] — 2026-02-18

### Fixed
- **Claude Code hooks use new format** — Claude Code now requires `PostToolUse` with `hooks` array (was `postToolExecution` with flat `command`). Old format caused settings validation error.
- Auto-migrates old `postToolExecution` hooks on re-init

## [0.4.1] — 2026-02-18

### Fixed
- **Claude Code detection missed `CLAUDE.md`** — projects with `CLAUDE.md` (newer Claude Code config) but no `.claude/` directory were detected as "generic" instead of Claude Code. Now checks for both `.claude/` and `CLAUDE.md`.

## [0.4.0] — 2026-02-16

### Added
- **Documentation coverage score** — counts .md files, shows read vs unread, coverage percentage
- **Boot file detection** — identifies files consistently in the first 5 reads of >80% of sessions
- **Staleness detection** — flags files read >10× but not modified in >2× the reporting period
- **Token cost estimation** — estimates token spend per file (size/4 × reads) with totals
- All four new metrics appear in both terminal report and HTML insights
- `src/utils.mjs` — shared utilities extracted from report/insights (eliminates duplication)
- `formatTokens()` utility for human-friendly token counts (K/M)
- `computeCoverage()` shared function for documentation analysis

### Fixed
- **Security: command injection in `init.mjs`** — paths with shell-unsafe chars (`"`, `` ` ``, `$`, `\`) are now rejected before interpolation into hook commands
- **Security: command injection in `insights.mjs`** — `open` command now uses `execFileSync(cmd, [outPath])` instead of string interpolation
- **`--key=value` flag syntax** now works (previously `--days=7` would break)
- **Buffered writes in `mine()`** — entries are collected and written in a single `appendFileSync` instead of one per entry (major speedup for large mines)

### Changed
- `report.mjs` and `insights.mjs` now import shared code from `utils.mjs`
- `analyze()` in insights.mjs split into `computeTiers()`, `computePatterns()`, and `computeCoverage()`
- HTML insights nav updated with new section links
- Stats row in HTML includes doc coverage percentage
- At-a-glance section includes documentation coverage and token spend summaries
- Insights section includes new recommendations for doc coverage and stale files

## [0.3.0] — 2026-02-16

### Added
- `whm insights` — Beautiful HTML report inspired by Claude Code's `/insights`
  - At-a-glance workspace health summary
  - File heatmap with hot/warm/cold/dead tiers
  - Daily trend sparkline (SVG)
  - Time-of-day & day-of-week access patterns
  - Directory heatmap, file extension breakdown
  - Actionable insights and recommendations
- Auto-detect transcript format (`--format auto`, now default)
- Deduplication: `whm mine` tracks processed transcripts, skips already-mined files
- `--include-writes` flag: track Write/Edit tool calls alongside reads
- `--force` flag: re-mine already-processed transcripts
- LICENSE file (MIT)
- CHANGELOG.md

### Fixed
- **Claude Code mining was completely broken** — wrapper type check (`type: "message"`) didn't match Claude Code's `type: "assistant"`. Zero Claude Code reads were being extracted.
- Session IDs now use full UUID instead of truncated 8 chars (prevents collisions)
- Export `insights` from package index

### Changed
- `--format` default changed from `openclaw` to `auto` (auto-detects from transcript content)
- Mine output now reports skipped files count

## [0.2.0] — 2026-02-16

### Added
- `whm insights` command (initial version, published briefly before fixes)

## [0.1.0] — 2026-02-16

### Added
- Initial release
- `whm init` — auto-detect Claude Code / OpenClaw and install tracking hooks
- `whm track <file>` — lightweight file read logger (<1ms)
- `whm report` — terminal heatmap with hot/warm/cold/dead tiers
- `whm mine <dir>` — extract reads from session transcripts
- `whm status` — tracking status overview
