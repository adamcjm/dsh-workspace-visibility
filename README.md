# @adamcjm/dsh-workspace-visibility

A [DeepSeek Harness](https://github.com/omdsh-dev/dsh) plugin that lets you **hide chosen
workspaces from the sidebar** — and bring them back whenever you want — without touching
any workspace, session or archive data.

Two entries, exactly where you already look:

1. **Workspace row →“…” menu → Hide workspace** (it reads *Unhide workspace* once the
   hidden rows are on screen again).
2. **Sidebar → View options → Show hidden workspaces** — a persisted switch that reveals
   every hidden workspace so you can restore it.

A sidebar-foot fallback entry (**“Hidden workspaces: N”**) toggles the same switch, so a
future sidebar restyle can never strand a hidden workspace.

Display-only by design:

- no archive, unarchive, rename, move or delete calls;
- no Host configuration, no files, no network requests;
- the only state written is one `localStorage` key in your browser.

## Install

### From npm (published releases)

```sh
dsh plugin --profile <profile> add @adamcjm/dsh-workspace-visibility
```

Then restart the DSH app (the Host plugin tree is assembled at process start) and
hard-refresh the page.

### From a local checkout (development, `link:`)

Point the profile at the checkout so edits apply on the next restart without an install
step:

```jsonc
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "@adamcjm/dsh-workspace-visibility": "link:/absolute/path/to/dsh-workspace-visibility"
  },
  "dsh": {
    "profile": {
      "bundles": ["…", "@adamcjm/dsh-workspace-visibility"]
    }
  }
}
```

```sh
cd ~/.dsh/profiles/<profile> && pnpm install
```

The `link:` protocol installs a symlink, so later edits to `lib/client.js` only need a
page refresh after the Host restart — no reinstall.

### From GitHub

```sh
dsh plugin --profile <profile> add https://codeload.github.com/adamcjm/dsh-workspace-visibility/tar.gz/refs/heads/main
```

`latest` and tags are independent from the DSH runtime; pin a version you tested.

## Use

1. Hover a Workspace row and open its **“…”** menu → **Hide workspace**.
   The workspace row disappears together with the sessions it owns.
2. Open **View options** (the sliders icon in the “WorkSpaces” header) →
   **Show hidden workspaces**. Hidden rows come back, dimmed and italicised.
3. Open a revealed row's **“…”** menu → **Unhide workspace** to restore it permanently.

While **Show hidden workspaces** is on, hiding another workspace still hides it
immediately (the switch turns back off), so the action always shows its effect.

The switch state and hidden ids live in `localStorage` under
`dsh-workspace-visibility.state.v1`, next to the shipped view options. Clearing that key
restores everything.

## Why it is built this way

The shipped sidebar (`@deepseek-ai/dsh-client-ui-workspace`) exposes slots for **Session**
row menus and buttons, but the Workspace row's “…” menu and the View options menu are
hardcoded arrays with no slot. Both entries are therefore appended to those menus as DOM,
cloning the shipped item's own classes, so they follow the shipped styling.

Hiding does **not** touch the DOM rows: the plugin wraps the `workspaces.list` client model
(`getSnapshot` / `subscribe`, the same lazy seam the shipped sidebar reads) and projects a
filtered snapshot. The sidebar, its search results and the Hero workspace picker all lose
the workspace in one place, and hiding keeps working even if the menu DOM changes.

The one pitfall solved by the projection: the shipped grouping trails every session not
owned by a *visible* workspace into an **“Ungrouped”** bucket. Removing a workspace from
`items` alone would spill all of its sessions there. The projection instead marks those
sessions as view-only archived ids, so the shipped archive filter keeps them out — with no
Host archive write and no data loss.

## Scope and known limits

- **Browser-local.** Hidden ids and the switch belong to one browser origin. They do not
  follow you to another device, and clearing site data forgets them. DSH Desktop and a
  `dsh web` profile use different origins (and, with `dsh web`, a new random port on every
  start), so the two do not share the hidden set.
- **The menu entries are DOM-appended.** A future sidebar restyle can move the menus; the
  hiding itself is unaffected (it is projection-based), and the sidebar-foot fallback stays
  available. If the entries go missing after a DSH upgrade, restore hidden workspaces from
  that fallback at the sidebar foot.
- **Collapsed groups lose their expansion state** for a hidden workspace (the shipped view
  store prunes records of workspaces it no longer sees). Restoring the workspace shows its
  group collapsed again.
- **A hidden workspace may be the one holding the open Session.** The sidebar row and its
  sessions disappear; the conversation in the main panel keeps working. Use the switch to
  bring the row back.
- **Archived-view interaction.** With the shipped *All conversations (show archived)*
  filter selected, sessions of a hidden workspace are shown by the product as archived rows
  under “Ungrouped” (the projection marks them view-only archived). The default *Hide
  archived* view is unaffected.
- Not a Host feature: other clients (another browser, a TUI profile) keep seeing every
  workspace.

## Verify

Offline contract self-check (no DSH process needed):

```sh
npm test
```

It evaluates the shipped `lib/client.js` in a `vm` sandbox and checks the loader contract,
the snapshot projection (including the no-Ungrouped-spill rule), persistence, the model
wrapper's reference stability and disposal, and a full `apply()` run against a fake Cordis
context.

In a live page, after restarting DSH:

```js
// the plugin is loaded
document.getElementById('dsh-workspace-visibility/style') !== null
// the hidden set is persisted
localStorage.getItem('dsh-workspace-visibility.state.v1')
```

## Uninstall

1. Before uninstalling, turn **Show hidden workspaces** on and unhide what you hid (or the
   rows stay hidden only until the plugin is removed — the ids are inert afterwards).
2. Remove the package from the profile's `dependencies` and `dsh.profile.bundles`, run
   `pnpm install`, then restart DSH.
3. Optionally clear `dsh-workspace-visibility.state.v1` from `localStorage`.

## Layout

```
lib/client.js      browser half: projection, menus, fallback entry (no build step)
lib/index.js       host half: mount-only placeholder
cordis.patch.yml   bundle layer inserting the one plugin row
locale/*.json      plugin-manager title/description
icon.svg           plugin icon
test/verify.mjs    zero-dependency self-check (`npm test`)
```

## License

MIT © adamcjm
