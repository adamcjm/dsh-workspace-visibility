# @adamcjm/dsh-workspace-visibility

[English](../README.md) | 中文

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

<sub>截图使用演示用的工作区名称，界面语言为中文。</sub>

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
