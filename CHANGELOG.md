# Changelog

All notable changes to `@adamcjm/dsh-workspace-visibility` are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] — 2026-10-20

### Fixed

- Unhiding the last hidden workspace (or hiding a workspace while the show-hidden
  switch was on) reset the switch locally without telling the Host, so the Host
  state — and every other connected client — kept it on. The implicit reset now
  travels as a `setShowHidden: false` increment as well.

## [0.2.0] — 2026-10-20

### Changed

- **State moved to the Host.** Hidden ids and the show-hidden switch now live in
  `$DSH_HOME/storages/workspace-visibility.json`, written atomically from a serialized
  queue. The browser keeps no copy — localStorage is no longer read or written (except
  the one-shot removal of the 0.1.x key, driven by the Host `legacyCleanupDone` flag).
- **Multi-client sync.** The browser half fetches the state once at boot and then follows
  an SSE stream (`/workspace-visibility/stream`): a change in Desktop reaches an open Web
  page, other tabs and other browsers sharing the same Host without a refresh — the same
  push model as the shipped `workspace/follow` stream. Local mutations travel as
  increments (`POST /mutate`) so two clients cannot overwrite each other.
- Survives Desktop restarts and port changes, unlike the 0.1.x localStorage state.
- New Host test suite (`test/host.mjs`): atomic writes, increments, SSE broadcast,
  restart reload, corrupt-file tolerance.

## [0.1.3] — 2026-10-20

### Changed

- The English README now shows screenshots captured in the English UI (Rename / Delete
  workspace / Hide workspace, Group by / Order by / Filter sessions / Show hidden
  workspaces); the Chinese section keeps the Chinese-UI screenshots.
- Screenshots remain anonymized: demo workspace/session names only, sidebar-only crops,
  no local paths.

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
