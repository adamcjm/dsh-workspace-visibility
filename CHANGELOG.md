# Changelog

All notable changes to `@adamcjm/dsh-workspace-visibility` are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
