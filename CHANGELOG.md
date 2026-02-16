# Changelog

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
