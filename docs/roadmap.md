# 路线图

记录 `screeps-assistant` 之后可能做的功能。顺序是建议顺序，不是排期承诺；条目开工前先和维护者确认。

- **范围**：只收通用能力，也就是换成另一个 Bot 后仍然有用的查询、控制台和 MCP 功能（判断办法见 [`README.md`](./README.md) 里“判断归属”那一段）。依赖某个 Bot 的实现、需要改 Bot 仓库的事项不放这里。
- **优先级**：功能性和易用性优先，目标是让内置命令直接回答常见现场问题，少写一次性探针。安全加固暂缓，不新增工具级的写入命令（见根目录 [`README.md`](../README.md) 的「安全边界」）。

## 已完成（2026-11-05）

- `ptr` 目标，以及在 `.screeps.yml` 的服务器块里覆盖 `shards` / `defaultShard` / `codeBranch`；
- `room --objects`（原样对象，带 `username`）、通用 `--pick`、`probes/` 目录与 `--file <探针名>` 查找；
- `overview`：官方房间统计，每格带估算的 tick 范围，`--tick` 选格；
- `history`：官方房间回放，`--tick` 还原某个 tick 的房间现场，`--to` 列出一段 tick 内每个对象的变化；
- `logs`：订阅 console 事件流听 bot 的日志，去 HTML、按分片和关键词过滤，每行附估算 tick；
- `status` 补成 CLI 命令，与 MCP 对齐；
- MCP 补齐：查询命令收进 `src/commands.js` 命令表，CLI 和 MCP 都从它生成，工具名统一为 `screeps_<命令名>`，参数名用 CLI flag 的 camelCase 形式；`pick` / `filter` / `fields` 三个输出选项在所有工具上通用；`logs` 在 MCP 里封顶 60 秒。

### 已完成（2026-11-09）

- `messages <用户名或 id>`：读一段对话的完整往来（`userMessagesList`）。用户名用索引自带的 users 表解析，之前只能绕过本工具调上游 CLI；输出裁到 `date/type/text/unread`（原回包每方都带整块 badge，整段线程很容易超 MCP 结果上限）。纯 GET，不标已读。

## 待做

### 1. `--arg` 传参（长表达式中转与 `chunk` 分片已完成）

- **已完成**：单次 `console`（CLI 与 MCP `screeps_console`）已支持自动中转超长表达式（`Memory.__sa_boot_<id>` 单次引导，被清理时自动降级 `global.__sa_b` 分片）。
- **待做**：`--arg 名=值`（可重复；值按 JSON 解析，不行就当字符串）把参数注入表达式作用域，同一个探针文件可以复用。

### 2. `room` 摘要加深（已完成 2026-11-20）

- **已实现**：去掉恒为空的 `role`/`squadName`，补齐己方/敌方 creep `ttl`、`hits`/`hitsMax`、敌方 `username`、`controller.ownerName` 与 `ticksToDowngrade`、`energyAvailable`/`energyCapacityAvailable`、`sources`/`mineral` 与 `structures` 血量/数量概览。

### 3. `code --verify <路径>`（已完成 2026-11-20）

- **已实现**：支持 `--verify <文件或目录>`，下载线上模块与本地构建产物逐一比对字节长度和 SHA-256 哈希（CLI 与 MCP `screeps_code` 同步支持）。只读，不写线上。

### 4. MCP 补齐（已完成 2026-11-07，剩常驻 socket）

- **已完成**：查询命令收进命令表 `src/commands.js`，CLI 与 MCP 同源；工具名 `screeps_<命令名>`，参数名取 CLI flag 的 camelCase；`room --objects`、`overview`、`history`、`logs`、`map`、`code`、`market`、`messages`、`summary`、`world` 全部补齐；`pick` / `filter` / `fields` 在 MCP 上通用，超长结果靠它们收窄；`logs` 单次封顶 60 秒。
- **还差**：常驻 socket，避免每次 console 调用都重连。超长结果目前是报错不返回，若以后要真分页再单独开条目。

### 5. `history --changed`（已完成 2026-11-20）

- **已实现**：`history --to` 支持 `--changed hits,store`，只保留 `changes` 里含这些键的记录并裁剪 `changes`，默认行为不变（CLI 与 MCP `screeps_history` 同步支持）。
