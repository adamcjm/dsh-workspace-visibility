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

- 不调用归档 / 取消归档 / 重命名 / 移动 / pin / 删除；
- 不改工作区记录、会话日志与归档集合；
- 唯一写入是 Host 上的一个小文件（`$DSH_HOME/storages/workspace-visibility.json`）。

## 截图

| 工作区行「…」菜单 | 视图选项菜单 |
| --- | --- |
| ![工作区菜单里的「隐藏工作区」](https://raw.githubusercontent.com/adamcjm/dsh-workspace-visibility/main/docs/screenshots/workspace-menu.png) | ![视图选项里的「显示隐藏工作区」](https://raw.githubusercontent.com/adamcjm/dsh-workspace-visibility/main/docs/screenshots/view-options.png) |

隐藏后，该工作区行连同它名下的会话一起消失；侧栏底部显示隐藏计数，保证永远能找回来：

![隐藏工作区后的侧栏与底部隐藏计数入口](https://raw.githubusercontent.com/adamcjm/dsh-workspace-visibility/main/docs/screenshots/hidden-workspace.png)

<sub>截图使用演示用的工作区名称；本节使用中文界面（英文节为同一流程的英文界面截图）。</sub>

## 持久化与多客户端同步

隐藏集合与「显示隐藏工作区」开关是 **Host 状态**，不是浏览器状态：

- 它们存在 `$DSH_HOME/storages/workspace-visibility.json`，由本插件的 Host 半侧原子写入
  （临时文件 + rename）。
- 浏览器**不保留副本**——本插件不读写 `localStorage`（0.1.x 用户的旧键会被删除一次，
  旧数据直接丢弃、不做迁移）。
- 浏览器启动时拉取一次状态，随后跟随 **SSE 流**（`/workspace-visibility/stream`）：
  任一客户端里的变更会被推送给所有已连接客户端——Desktop、其它标签页、其它浏览器——
  无需刷新。这与官方工作区排序的 `workspace/follow` 推送模型一致。
- 本地变更以**增量**方式发送（`POST /workspace-visibility/mutate`），两个客户端隐藏不同
  工作区时不会互相覆盖。
- 结果：状态能跨 Desktop 重启与随机端口保留；连接同一个 Host 的所有客户端看到同一份
  隐藏集合；连接不同 Host（或不同 `DSH_HOME`）的客户端各有自己的状态。
- **跨 DSH 界面（Desktop ↔ web）。** DSH Desktop 与 `dsh web` 是两个独立的 Host 进程，
  但共享同一个 `$DSH_HOME`。两个进程都会监听共享状态文件：一方写入后，另一方会在 1 秒内
  读到并广播给自己已连接的客户端；同时写入走跨进程锁 + read-modify-write，所以 Desktop
  里隐藏一个工作区，打开的 web 界面会跟着变，反之亦然，双方都不会覆盖对方的改动。

### Profile 与 Host

状态路径由 `$DSH_HOME` 决定，**与 profile 无关**——所以当 `desktop` profile 与 `web`
profile 使用同一个 `DSH_HOME` 时，它们共享同一份状态文件。具体来说：

- **同一个 `DSH_HOME`**（同一台机器上的默认 `~/.dsh`）——DSH Desktop、`dsh web`、
  desktop profile、web profile 任意组合都共享一份隐藏集合；更新在 1 秒内到达：
  同一个 Host 内走 SSE 推送，Desktop Host 与 `dsh web` Host 之间走跨进程文件监听。
- **不同的 `DSH_HOME`**（另一台机器、自定义 `DSH_HOME`、远程 Host）——各自拥有独立的
  状态文件与隐藏集合。没有跨机器同步：插件只把状态存在本地，不调用任何网络服务。
- **没装本插件的 profile**（例如只有 TUI 的 profile）不受影响，照旧显示所有工作区。
  状态文件与 profile 无关，之后在那边装上插件会直接读到同一份隐藏集合，无需迁移。
- **远程浏览器访问**正在运行的 Host 时，共享的是那个 Host 的状态——浏览器半侧只跟
  它连接的 Host 通信，状态由 Host（及其 `DSH_HOME`）决定。

### 容错

状态按不可信输入处理，插件不会把 Host 弄崩：

- 状态文件缺失、不可读、损坏或异常过大（> 1 MiB）时按空状态处理并记录日志，不抛错；
- 非字符串条目直接丢弃；id 列表去重并有上限；
- 工作区被删除后，它对应的隐藏记录会被自动清理（加载时、每次读取时、以及每分钟一次），
  针对未知工作区的隐藏请求会被忽略——已删除的工作区不会留下失效记录；
- 工作区 registry 不可用时保留原状态、不做清理，也不报错；
- 写入失败（目录只读、磁盘满）时保留内存状态、记录警告，请求仍然正常返回；
- 浏览器侧同步失败会排队重试，SSE 流自动重连，解析失败的帧直接忽略。

### 从 0.1.x 升级

旧 `localStorage` 键（`dsh-workspace-visibility.state.v1`）由 Host 的 `legacyCleanupDone`
标记驱动、只删除一次。不做迁移：0.1.x 里隐藏的工作区在升级后会重新显示。

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

- **Host 状态，同一 Host 上的所有客户端共享。** 隐藏集合与开关存在
  `$DSH_HOME/storages/workspace-visibility.json`；连接同一个 Host 的浏览器、标签页、
  Desktop 与 web 界面看到同一份集合，跨 Desktop 重启与随机端口保留，清站点数据也不会丢。
  连接不同 Host（或不同 `DSH_HOME`）的客户端各有自己的状态。
- **两个菜单项是 DOM 追加的。** 未来侧边栏改版可能移动菜单；隐藏本身不受影响（走数据投影），
  侧栏底部兜底入口始终可用。如升级后菜单项消失，请用底部兜底恢复。
- **隐藏工作区的展开状态会丢。** 官方视图 store 会清理“看不见的工作区”的展开记录，
  恢复后该组默认折叠。
- **正在使用的工作区也可以隐藏。** 侧栏行与该组会话消失，主视图里正在进行的对话不受影响；
  用开关把行找回来即可。
- **与归档视图的交互。** 切到官方的「全部对话（显示已归档）」时，被隐藏工作区的会话会以
  已归档行出现在「未分组」（投影把它们标成了视图层已归档）。默认的「隐藏已归档」视图不受影响。
- **不属于工作区注册表。** 状态文件归本插件所有；未安装本插件的 TUI 会话或另一套 DSH
  安装照旧看到全部工作区。

## 验证

离线契约自检（不需要 DSH 进程）：

```sh
npm test
```

`npm test` 跑两个零依赖测试套件。浏览器套件在 `vm` 沙箱里加载 `lib/client.js`：加载器契约、
快照投影（含“不漏进未分组”）、内存 store、bootstrap/SSE/增量同步、包装与卸载、完整
`apply()`。Host 套件对着 fake web server 驱动 `lib/index.js`：原子写入、增量、SSE 广播、
重启后重新加载、损坏文件容错。

在真实页面中（重启 DSH 后）：

```js
// 插件已加载
document.getElementById('dsh-workspace-visibility/style') !== null
// 页面 console：状态由 Host 提供，不在 localStorage
await (await fetch('/workspace-visibility/state')).json()
```

Host 命令行：

```sh
cat "${DSH_HOME:-$HOME/.dsh}/storages/workspace-visibility.json"
```

## 卸载

1. 卸载前先打开「显示隐藏工作区」把隐藏项恢复（或直接卸载——隐藏 id 会变成惰性数据）。
2. 从 profile 的 `dependencies` 与 `dsh.profile.bundles` 中移除，`pnpm install`，重启 DSH。
3. 可选：删除 Host 状态文件 `$DSH_HOME/storages/workspace-visibility.json`（若想保留恢复
   能力，先打开「显示隐藏工作区」逐项取消隐藏）。

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
