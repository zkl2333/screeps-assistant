# 路线图

记录 `screeps-assistant` 之后可能做的功能。顺序是建议顺序，不是排期承诺；条目开工前先和维护者确认。

- **范围**：只收通用能力，也就是换成另一个 Bot 后仍然有用的查询、控制台和 MCP 功能（判断办法见 [`README.md`](./README.md) 里“判断归属”那一段）。依赖某个 Bot 的实现、需要改 Bot 仓库的事项不放这里。
- **优先级**：功能性和易用性优先，目标是让内置命令直接回答常见现场问题，少写一次性探针。可按需补齐工具级写入命令，但所有写入操作须经用户明确授权（见根目录 [`README.md`](../README.md) 的「安全边界」）。

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

### 已完成（2026-11-26）

- **`console` 防 429 自动降级与 `--arg` 传参**：`transport='auto'` 下中长脚本（≤ 2500 字符）优先走纯 `global.__sa_b` 分片，超长脚本遇 `POST /api/user/memory` 429 或写入失败自动降级分片；CLI 支持可重复 `--arg 名=值`（MCP 支持 `args` 对象）注入变量到表达式作用域；修复 CLI `inbox list`/`push` 缺导入问题；扩充 `__sa.t` 工具包（新增 `stock`、`labs`、`factory`、`intershard`、`powerCreeps`）。
- **输出过滤管道与 CLI 易用性**：`--filter` 支持 `|` 多值 OR、`^=` 前缀、`*=` 包含与数值比较（`<` `<=` `>` `>=`）；`--pick` 支持逗号多路径；`--fields` 兼容普通单对象；新增通用 `--limit`；支持 `--server` / `--eval` / `--duration 10s` 等直觉别名与拼写提示；`helpText()` 改为从 `COMMAND_TABLE` 自动生成。
- **多分片 / 多房间 / 批量查询**：`--shard shard2,shard3,shardX` 与 `--all-shards` 覆盖 `summary`、`rooms`、`memory`、`segment`、`market`、`stock`、`console`；`room` 支持逗号多房间；`market --resource` 支持逗号多品批量查盘口。
- **帝国资源盘点与诊断**：新增 `stock`（纯 HTTP 0 console 额度汇总 storage/terminal/lab/factory 库存与 Boost）；加深 `room` 摘要（storage/terminal 全资源、lab/factory/nuker/spawning/safeMode 详情）；`segment` 默认自动 JSON 解码并支持 `--stats` 体积占比与 `--raw`；`history` 新增 `--best-effort` 自动截断未落盘块并跳过缺失 404 块；`status --ping` 联网诊断 `/api/version`、鉴权与 tick 推进；`authMe` 5 分钟非敏感本地缓存。
- **MCP 体验对齐**：落地常驻 console WebSocket 会话池（空闲自动回收、断线自动重建），`screeps_console` 对齐 `args`、`allShards`、`transport` 及 `pick`/`filter`/`fields`/`limit` 输出裁剪。
- **实时事件订阅与唤醒引擎（`watch`）**：基于官方 WebSocket（`room:` / `memory:` / `console` / `code` / `newMessage` / `cpu`，0 轮询、0 console 额度）实现多路组合事件订阅；支持 `creep-enter`/`creep-leave`/`creep-die`/`hostile-enter`/`hostile-cleared`/`structure-destroyed`/`damage`/`low-hp`/`nuke`/`controller` 实时差分、`--memory` + `--until` 状态机等待、`--check-initial` 首帧检查、默认单次命中即退出唤醒调用方，以及 `--stream` + `--cooldown` + `--exec` 常驻哨兵回调模式。

## 待做

### 1. 大结果真分页 / 流式导出的按需评估

- MCP 超长结果目前靠 `pick` / `filter` / `fields` / `limit` 裁剪；如后续仍有超大对象完整翻页需求再单独设计游标分页。

### 2. 工具级受控写入命令（按需扩展）

- 遵循根目录 `README.md` 与 `AGENTS.md` 的「安全边界」：工具级持久化写入统一采用 **Dry-run 预览 + `--confirm`（MCP `confirm: true`）二次确认**，所有写入须经用户明确授权。
