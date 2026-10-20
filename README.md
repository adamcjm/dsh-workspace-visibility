# @adamcjm/dsh-workspace-visibility

[![npm version](https://img.shields.io/npm/v/@adamcjm/dsh-workspace-visibility.svg)](https://www.npmjs.com/package/@adamcjm/dsh-workspace-visibility)
[![license](https://img.shields.io/npm/l/@adamcjm/dsh-workspace-visibility.svg)](LICENSE)

**English** | [中文](#中文)

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

## Screenshots

| Workspace “…” menu | View options |
| --- | --- |
| ![Workspace row menu with Hide workspace](https://raw.githubusercontent.com/adamcjm/dsh-workspace-visibility/main/docs/screenshots/workspace-menu.en.png) | ![View options menu with Show hidden workspaces](https://raw.githubusercontent.com/adamcjm/dsh-workspace-visibility/main/docs/screenshots/view-options.en.png) |

After hiding, the workspace row and all of its sessions disappear; the sidebar foot shows the
hidden count so nothing is ever stranded:

![Sidebar after hiding a workspace, with the hidden-count fallback at the foot](https://raw.githubusercontent.com/adamcjm/dsh-workspace-visibility/main/docs/screenshots/hidden-workspace.en.png)

<sub>Screenshots use demo workspace names; this English edition shows the English UI — the 中文 section below shows the same flow in Chinese.</sub>

## Install

Requires **DeepSeek Harness 0.2.0-rc.2 or newer** (tested on 0.2.0-rc.2 and 0.2.1-rc.2).

### From npm (recommended)

```sh
dsh plugin --profile <profile> add @adamcjm/dsh-workspace-visibility
```

`dsh plugin add` records the dependency and the bundle entry, installs it into the profile,
and finishes in two steps:

1. **Restart the DSH app** — the Host plugin tree is assembled at process start.
2. **Hard-refresh the page** (Cmd/Ctrl+Shift+R) so the renderer loads the new client bundle.

Equivalent manual setup — `~/.dsh/profiles/<profile>/package.json`:

```jsonc
{
  "dependencies": {
    "@adamcjm/dsh-workspace-visibility": "^0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": ["…", "@adamcjm/dsh-workspace-visibility"]
    }
  }
}
```

then `cd ~/.dsh/profiles/<profile> && pnpm install`, restart DSH, refresh.

If the profile enforces pnpm's `minimumReleaseAge`, a just-published version can be
refused; add the package name to `minimumReleaseAgeExclude` in that profile's
`pnpm-workspace.yaml` (recent pnpm versions do this automatically).

### From a GitHub release (pinned tag)

```sh
dsh plugin --profile <profile> add https://codeload.github.com/adamcjm/dsh-workspace-visibility/tar.gz/refs/tags/v0.1.0
```

Pin a tag or commit you tested; do not follow `main` for daily use.

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

---

<a id="中文"></a>

# 中文

一个 [DeepSeek Harness](https://github.com/omdsh-dev/dsh) 插件：**把选中的工作区从侧边栏隐藏**，
需要时再放出来。不归档、不删除、不重命名、不改写任何工作区或会话数据。

两个入口都在你原本就要找的位置：

1. **工作区行 →「…」菜单 → 隐藏工作区**（在「显示隐藏工作区」打开时，这一项变为 *取消隐藏工作区*）。
2. **侧栏「WorkSpaces」区头 → 视图选项 → 显示隐藏工作区** —— 一个持久化开关，打开后隐藏行
   重新出现，可逐行恢复。

侧栏底部还有一个兜底入口（**“隐藏的工作区: N”**），切换同一个开关，避免侧栏改版导致隐藏行
“找不回来”。

设计上只做显示过滤：

- 不调用归档 / 取消归档 / 重命名 / 移动 / 删除；
- 不写 Host 配置、不落文件、不联网；
- 唯一写入是浏览器里的一个 `localStorage` 键。

## 截图

| 工作区行「…」菜单 | 视图选项菜单 |
| --- | --- |
| ![工作区菜单里的「隐藏工作区」](https://raw.githubusercontent.com/adamcjm/dsh-workspace-visibility/main/docs/screenshots/workspace-menu.png) | ![视图选项里的「显示隐藏工作区」](https://raw.githubusercontent.com/adamcjm/dsh-workspace-visibility/main/docs/screenshots/view-options.png) |

隐藏后，该工作区行连同它名下的会话一起消失；侧栏底部显示隐藏计数，保证永远能找回来：

![隐藏工作区后的侧栏与底部隐藏计数入口](https://raw.githubusercontent.com/adamcjm/dsh-workspace-visibility/main/docs/screenshots/hidden-workspace.png)

<sub>截图使用演示用的工作区名称；本节使用中文界面（英文节为同一流程的英文界面截图）。</sub>

## 安装

要求 **DeepSeek Harness 0.2.0-rc.2 或更新版本**（已在 0.2.0-rc.2 与 0.2.1-rc.2 验证）。

### 从 npm（推荐）

```sh
dsh plugin --profile <profile> add @adamcjm/dsh-workspace-visibility
```

`dsh plugin add` 会把依赖与 bundle 条目一起写进 profile 并完成安装，然后：

1. **重启 DSH 应用** —— Host 插件树在进程启动时组装。
2. **强制刷新页面**（Cmd/Ctrl+Shift+R），让渲染端加载新的 client bundle。

等价的纯手动配置 —— `~/.dsh/profiles/<profile>/package.json`：

```jsonc
{
  "dependencies": {
    "@adamcjm/dsh-workspace-visibility": "^0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": ["…", "@adamcjm/dsh-workspace-visibility"]
    }
  }
}
```

然后 `cd ~/.dsh/profiles/<profile> && pnpm install`，重启 DSH，刷新页面。

如果该 profile 启用了 pnpm 的 `minimumReleaseAge`，刚发布的版本可能被拒绝；把包名加入该
profile 的 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（较新的 pnpm 会自动处理）。

### 从 GitHub Release 安装（钉住 tag）

```sh
dsh plugin --profile <profile> add https://codeload.github.com/adamcjm/dsh-workspace-visibility/tar.gz/refs/tags/v0.1.0
```

日常使用请钉住验证过的 tag 或 commit，不要跟随 `main`。

### 本地开发（`link:`）

把 profile 指向本地 checkout，改完代码重启即可生效，不需要重新安装：

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

`link:` 安装出来的是符号链接，之后改 `lib/client.js` 只需重启 Host + 刷新页面，不用重装。

## 使用

1. 悬停任意工作区行，打开「…」菜单 → **隐藏工作区**。
   该工作区行连同它名下的会话一起从侧边栏消失。
2. 打开「WorkSpaces」区头的 **视图选项**（滑块图标）→ **显示隐藏工作区**。
   隐藏行重新出现，带淡化 + 斜体标记。
3. 打开被显示行的「…」菜单 → **取消隐藏工作区**，永久恢复。

「显示隐藏工作区」打开期间再隐藏另一个工作区，会立刻隐藏它并自动关掉这个开关，
保证“隐藏”动作总是立即生效。

开关状态与隐藏集合存放在 `localStorage` 的 `dsh-workspace-visibility.state.v1`
（与官方视图选项同级别）。清掉这个键即全部恢复。

## 为什么这样做

官方侧边栏（`@deepseek-ai/dsh-client-ui-workspace`）只给**会话**行菜单和会话行按钮暴露了
slot；工作区行的「…」菜单和视图选项菜单都是硬编码数组，没有扩展点。因此两个入口以 DOM
方式追加进对应菜单，并克隆官方菜单项自己的 class，样式跟随官方。

**隐藏本身不碰行 DOM**：插件包装 `workspaces.list` 客户端模型（`getSnapshot` /
`subscribe`，官方侧边栏本来就是懒读这个缝），投影一份过滤后的快照。侧边栏、搜索、Hero
工作区选择器在同一处失去该工作区，菜单 DOM 变化也不影响隐藏效果。

投影里解决的一个坑：官方分组会把“不属于任何可见工作区”的会话收进 **「未分组」**。
如果只把工作区从 `items` 里删掉，它名下的会话会全部漏进未分组。投影改为把这些会话作为
**仅视图层的已归档 id** 合并进归档集合，官方归档过滤器自然把它们藏起来 —— 不写 Host
归档、不丢数据。

## 范围与已知限制

- **只在本浏览器生效。** 隐藏集合与开关属于单个 origin，不跨设备；清站点数据即遗忘。
  DSH Desktop 与 `dsh web` profile 是不同 origin（`dsh web` 每次启动端口还会随机），两者
  不共享隐藏集合。
- **两个菜单项是 DOM 追加的。** 未来侧边栏改版可能移动菜单；隐藏本身不受影响（走数据投影），
  侧栏底部兜底入口始终可用。如升级后菜单项消失，请用底部兜底恢复。
- **隐藏工作区的展开状态会丢。** 官方视图 store 会清理“看不见的工作区”的展开记录，
  恢复后该组默认折叠。
- **正在使用的工作区也可以隐藏。** 侧栏行与该组会话消失，主视图里正在进行的对话不受影响；
  用开关把行找回来即可。
- **与归档视图的交互。** 切到官方的「全部对话（显示已归档）」时，被隐藏工作区的会话会以
  已归档行出现在「未分组」（投影把它们标成了视图层已归档）。默认的「隐藏已归档」视图不受影响。
- 不是 Host 功能：其它客户端（另一个浏览器、TUI profile）照旧看到全部工作区。

## 验证

离线契约自检（不需要 DSH 进程）：

```sh
npm test
```

它在 `vm` 沙箱里加载真实的 `lib/client.js`，检查加载器契约、快照投影（含“不漏进未分组”）、
持久化、包装的引用稳定性与卸载还原，以及对着 fake Cordis context 跑一遍完整 `apply()`。

在真实页面中（重启 DSH 后）：

```js
// 插件已加载
document.getElementById('dsh-workspace-visibility/style') !== null
// 隐藏集合已持久化
localStorage.getItem('dsh-workspace-visibility.state.v1')
```

## 卸载

1. 卸载前先打开「显示隐藏工作区」把隐藏项恢复（或直接卸载——隐藏 id 会变成惰性数据）。
2. 从 profile 的 `dependencies` 与 `dsh.profile.bundles` 中移除，`pnpm install`，重启 DSH。
3. 可选：清掉 `localStorage` 的 `dsh-workspace-visibility.state.v1`。

## 目录结构

```
lib/client.js      浏览器半侧：投影、菜单、兜底入口（零构建）
lib/index.js       host 半侧：仅占位挂载
cordis.patch.yml   bundle 层，插入单个插件行
locale/*.json      插件管理器的标题/描述
icon.svg           插件图标
test/verify.mjs    零依赖自检（`npm test`）
```

## 许可

MIT © adamcjm
