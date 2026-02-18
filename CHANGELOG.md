# Changelog

## [0.4.2] — 2026-02-18

### Fixed
- **Claude Code hooks use new format** — Claude Code now requires `PostToolUse` with `matcher.tools` array and `hooks` array (was `postToolExecution` with flat `matcher`/`command`). Old format caused settings validation error.
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
