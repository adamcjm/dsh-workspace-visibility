# Changelog

All notable changes to `@adamcjm/dsh-workspace-visibility` are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] — 2026-10-20

### Fixed

- npm published the Chinese standalone README as the package readme because a second
  `README*.md` file sat in the package root. The standalone Chinese edition moved to
  `docs/README.zh-CN.md`; the bilingual `README.md` is now the only root README, so GitHub
  and npm both render English + 中文.

## [0.1.1] — 2026-10-20

### Changed

- Both READMEs now publish a bilingual edition (English + 中文) so GitHub and npm show the
  same instructions.
- Added screenshots: workspace menu entry, view-options switch, hidden sidebar state.
- Added the install section for every supported channel (npm, GitHub release, link checkout).

### Changed

- **Docs:** expanded installation instructions (npm, manual profile setup, pinned GitHub
  release, local `link:` checkout) in both READMEs, and added npm badges.

## [0.1.0] — 2026-10-20

### Added

- Workspace row "…" menu gains **Hide workspace / Unhide workspace**, targeting
  the shipped menu without a slot of its own.
- Sidebar **View options** menu gains a **Show hidden workspaces** switch,
  persisted in `localStorage`.
- Hiding a workspace removes its sidebar group and every session it owns from
  the browsing projection, without leaking those sessions into the
  “Ungrouped” bucket, and without archiving, deleting or rewriting anything.
- Sidebar-foot restore entry (“Hidden workspaces: N”) as a fallback whenever the
  view-options entry cannot be injected.
- Marker styling for hidden rows while the switch is on, so a hidden row is
  recognizable before restoring it.
- Zero-dependency self-check (`npm test`) covering the loader contract, the
  snapshot filter, persistence and state transitions.
