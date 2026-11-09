# Screeps Assistant — 外部读取与监控工具

基于 [screepers/node-screeps-api](https://github.com/screepers/node-screeps-api)（社区维护的非官方封装）的 Screeps 外部 HTTP + WebSocket API 命令行工具集。

这是 Screeps 的外部工具与通用游戏知识仓库，提供房间与账号信息读取、游戏内 Console 表达式执行、实时监控、数据分析、代码只读备份，以及不依赖具体 Bot 框架的游戏机制和 API 资料。某个具体 Bot 的设计与实现不在本仓库维护。

## 技术栈

- **Runtime:** Node.js v24
- **包管理:** npm
- **核心依赖:** `screeps-api` (v2.x, CommonJS)
- **认证方式:** Auth Token（Screeps 账户设置 → Auth Tokens）

## 项目结构

```
├── .screeps.yml          # 本地 API 配置（含 token，已 gitignore）
├── bin/
│   └── screeps-assistant.js # 正式命令入口（查询只读 + console 透传）
├── src/commands.js       # 命令表：命令名、参数、处理函数（CLI 与 MCP 共用）
├── src/api/              # 目标配置、只读 API、查询层与 console 执行
├── src/cli/              # 参数解析与输出选项
├── src/mcp/              # stdio MCP 入口（按命令表生成 screeps_<命令> 工具）
├── src/map/              # 跨环境地图分析（纯函数）与联网扫描
├── tools/backup/         # 线上代码只读备份
├── tools/live/           # WebSocket 与 CPU 采样
├── probes/               # 一次性 console 探针（只有 README 入库）
├── tests/                # 本地测试与 fixture
├── docs/                 # API、使用说明和通用游戏知识
└── skills/               # Screeps 专用技能
```

## 常用命令

入口统一用 `node bin/screeps-assistant.js`（`--help` 看全部命令）；MCP 客户端用 `src/mcp/server.mjs`。

```bash
# 安装依赖
npm ci

# 查询（只读）
node bin/screeps-assistant.js summary --target main --shard shard2
node bin/screeps-assistant.js room W1N1 --target main --shard shard2              # 房间摘要
node bin/screeps-assistant.js room W1N1 --objects --filter type=creep --fields name,x,y,hits,fatigue --target main --shard shard2  # 全部对象，不需要视野
node bin/screeps-assistant.js overview W1N1 --interval 180 --target main --shard shard2  # 官方房间统计
node bin/screeps-assistant.js memory rooms.W1N1 --target main --shard shard2      # 路径用位置参数；省略路径即查根
node bin/screeps-assistant.js segment --id 0 --target main --shard shard2
node bin/screeps-assistant.js code --target ptr                                     # 核对 PTR 上的代码分支
node bin/screeps-assistant.js world --target season                                 # 环境概况：赛季能力、反应堆、世界尺寸
node bin/screeps-assistant.js map --target main --shard shard2 --room W1N1 --ascii  # 文字地形图

# 游戏内表达式（探针放 probes/，--file 可直接写探针名）
node bin/screeps-assistant.js console --expr "Game.time" --target main --shard shard2
node bin/screeps-assistant.js console --file my-probe --target main --shard shard2

# 本地验证
npm test
git diff --check

# 代码管理（只读拉取）
npm run pull                  # 只读拉取正式代码
node tools/backup/pull-code.js main ./dist # 拉取指定分支到指定目录
node tools/backup/pull-code.js main ./dist --target main --account alt # 多账号拉取
```

仓库不提供 `npm run query` 这类脚本入口（npm 在 Windows 默认用 cmd.exe 跑 scripts，会在 node 启动前就把 `=>` 里的 `>` 当重定向）。表达式直接走 `node bin/screeps-assistant.js console --file ...` 或 stdin。

## 配置说明

`.screeps.yml` 使用 [SS3 Unified Credentials File](https://github.com/screepers/screepers-standards/blob/master/SS3-Unified_Credentials_File.md) 格式，`--target` 选择其中的服务器块。内置目标 `main`、`ptr`、`season`、`pserver`；服务器块里可选的 `shards` / `defaultShard` / `codeBranch` 会覆盖内置默认值，内置之外的服务器块也能直接当目标。多账号挂在服务器块的 `accounts` 下，用 `--account` 选择。完整示例见 [`README.md`](./README.md)。

```yaml
servers:
  main:
    url: https://screeps.com/
    token: "你的auth-token"
  ptr:
    url: https://screeps.com/ptr/
    token: "你的auth-token"   # PTR 与正式服共用 token
```

Token 获取：https://screeps.com → 账户设置 → Auth Tokens → 生成。

## Screeps API 要点

- **所有 HTTP 端点基址:** `https://screeps.com/api/`
- **认证:** `X-Token` + `X-Username` header（值为 token）
- **Shard 必须指定:** 官方服务器 5 个 shard（shard0~shard3 + shardX），大部分接口需要传 shard 参数
- **WebSocket:** 连接后 subscribe 频道即可接收实时推送（cpu/console/code/room:XXX/memory/XXX）
- **代码推送:** `POST /api/user/code` —— 本工具不提供，也不应调用它直推线上正式环境（见下文「代码发布边界」）
- **Memory:** 返回 gzip+base64 格式，`screeps-api` 已自动解包

## 注意事项

- 不要将 `.screeps.yml` 提交到 git（含 token）
- Screeps API 有速率限制（120 req/min 全局），`screeps-api` 内置了重试逻辑
- 官方服务器已于 2018 年废弃密码认证，必须使用 Auth Token；账号密码登录只适用于私服

## 代码发布边界

本工具**不提供代码上传能力**，也不应被用作绕过 Bot 发布流程的旁路。

- Bot 的正式代码走它自己的发布流程（例如 CI / GitHub Actions）。不要通过 `POST /api/user/code`、上游 `screeps-api` CLI 或任何脚本，把代码直接推到线上正式环境。
- 本工具在发布流程里只负责只读核对：拉取线上代码、对比版本、观察运行状态。
- 本地 simulator 和私服上的调试不受此限。
- 只读查询、监控、拉取代码、分析 Memory：允许直接用 API。

直接用 API 部署会让线上代码与版本库漂移，CI 历史无法审计，之后的协作者和 Agent 也会基于错误的代码来源做判断。一旦发现漂移：

1. 立刻停止继续直接部署；
2. 以版本库为唯一真相源；
3. 把缺失的改动补回仓库，重新走发布流程。

## 项目定位与协作职责

**screeps-assistant** 只维护 Screeps 外部工具。工作围绕以下职责展开：

- **读取状态：** 查询账号、Shard、房间、资源、敌情、Memory 和运行状态。
- **Console 执行：** 执行用户明确要求的游戏内表达式并返回输出。默认按同一请求 ID 自动重试，游戏内用 `global.__sa` 按 ID 缓存结果（100 tick 后清理），重复到达不会再次执行。仅当两次发送之间发生 global 重置（如发布新代码）时可能重复执行，写入类表达式建议 `--retry 0`；`--raw` 关闭包装与重试。
- **监听 console：** 想看 bot 自己打印的日志（例如发布后观察有没有新报错）不用发表达式，用 `logs`：`node bin/screeps-assistant.js logs --errors --duration 120 --target main --shard shard2`。它只订阅 console 事件流，不占 console 发送额度；只能往后听、没有历史，日志里的 tick 是估算的（误差约 ±1～2 tick）。
- **监控分析：** 提供 HTTP / WebSocket 采集、结构化输出和通用分析能力。
- **代码备份：** 从 Screeps 只读拉取代码，辅助核对线上版本。
- **工具开发：** 修改本项目的 API 客户端、查询命令和分析脚本。
- **仓库边界：** 通用游戏知识和 API 资料可进入本仓库；某个 Bot 的设计、实现计划、源码改动、发布结果和验收记录属于该 Bot 自己的仓库。
- **核对线上版本：** 用本仓库工具核对 Bot 线上状态时，以 Bot 发布流程（如 CI）的结果为准，不要改用本地 API 直推作为“补救”。
- **操作边界：**
  - 查询和只读分析可直接执行
  - 排查、评估和 review 默认只执行只读操作
  - Console 表达式由用户显式给出，或由 Agent 根据已确认的目标构造后经用户确认；写入类表达式（改 Memory、执行游戏动作）不得未经确认自行构造并执行
  - 重生、放弃房间等不可逆游戏操作，执行前必须明确告知影响
  - Bot 代码发布见上文「代码发布边界」
- **探针：** 线上排查先用内置命令（`room --objects`、`memory` 加 `--filter` / `--fields`、`overview`、`history`），读 bot 运行时状态才写 console 探针；探针放 `probes/`（不入库），不要放仓库根目录。

每次处理任务时，优先读取本目录及相关子目录的 `AGENTS.md`，再根据需要查询 Screeps API 和游戏状态。不要把本仓库当成 Bot 的设计仓库或旁路发布通道。

### 工具知识维护

- 已验证的 API 调用、字段含义和读取限制记录在 `docs/api/screeps-api.md`。
- 这里只记录工具如何读取数据，不记录 Bot 应如何设计或下一步实现什么。
- 不把凭证、Auth Token、密码或完整私有 Memory 写入文档。

### 文档归属

- 修改文档前先读 [`docs/README.md`](./docs/README.md)。
- 本仓库维护读取工具、API / WebSocket 用法、字段限制和框架无关的 Screeps 游戏知识。
- 某个 Bot 的领域模型、算法设计、代码计划、发布结果和线上验收写在该 Bot 自己的仓库。
- 查询结果默认是临时输出；需要长期保留的结论，先整理成与具体 Bot 无关的 API 知识，再写入 `docs/api/`。
- Agent 规则只写在根目录 `AGENTS.md`，不另建 `.agent`、`.agents`、`agent-memory` 目录或新的项目计划文件。

### 入口优先级

1. **本工具的 CLI 和 MCP 是主入口。** 目标、分片、多账号和输出选项（`--pick` / `--filter` / `--fields` / `--compact`）在所有命令上一致。已封装的端点不要再走上游 CLI：

   查询命令只在 `src/commands.js` 的命令表里登记一次，CLI 和 MCP 都从它生成：MCP 工具名固定为 `screeps_<命令名>`，参数名是 CLI flag 的 camelCase 形式（`--all-shards` → `allShards`）。**加命令或加参数只改命令表**，不要去 bin 或 `src/mcp/server.mjs` 里另写一份；表外的只有 `console`（带请求 ID 和重试）和 `help`。

   | 上游方法 | 本工具命令 |
   |---|---|
   | `gameTime`、`gameWorldSize` | `world` |
   | `authMe` | `account` |
   | `userRooms` | `rooms` |
   | `gameRoomObjects` | `room <房间> --objects`（摘要用 `room <房间>`） |
   | `gameRoomOverview` | `overview <房间>` |
   | `history`（房间回放） | `history <房间> --tick <tick> [--to <tick>]` |
   | console 实时流（socket `console` 订阅） | `logs [--errors] [--duration <秒>] [--grep <关键词>]` |
   | `userMemoryGet` | `memory <路径>` |
   | `userMemorySegmentGet` | `segment --id <id>` |
   | `userCodeGet` | `code` |
   | `gameMarketMyOrders` | `market` |
   | `userMessagesIndex`、`userMessagesUnreadCount` | `messages` |
   | `userMessagesList`（某段对话全文） | `messages <用户名或 id>` |
   | `gameShardsInfo` | `shards` |
   | `gameRoomStatus`、`gameRoomTerrainUnencoded` | `map` |

2. **上游 `screeps-api` CLI 只做兜底**，用于本工具没封装的只读端点：

   ```bash
   npx --no-install screeps-api call <method> ...
   ```

   常用的未封装只读方法：市场 `gameMarketOrdersIndex`、`gameMarketOrders`、`gameMarketStats`、`userMoneyHistory`；地图 `gameMapStats`、`gameRoomTerrain`、`gameRoomDecorations`；实验数据 `experimentalPvp`、`experimentalNukes`、`warpathBattles`。

   上游 CLI 要在本仓库目录下运行才能找到 `.screeps.yml`，用 `--server <名字>` 选服务器块（默认 `main`），只用服务器块自身的 token，不认本工具的 `accounts` 和目标覆盖字段。房间和 shard 应显式传入。`gameMapStats` 的 `rooms` 是逗号分隔的房间名列表，`stat` 另外支持 `owner0` 和 `claim0`；`resource` 使用 `screeps-api` 的 `MarketResources` 值；PVP/Warpath 接口的 interval 是独立的 tick 参数。完整命令以 `npx --no-install screeps-api --help` 为准。

上游 CLI 也暴露写入接口。Agent 只能用它的只读方法；禁止经上游 CLI 调用代码提交、Memory/Segment 写入、`userConsole`、建筑/旗帜/Intent、重生/放弃房间、市场写入、消息发送/标记已读或装饰修改等副作用 API。游戏内表达式一律走本工具的 `console` 命令（带请求 ID 匹配和同 ID 去重），不要用上游的 `userConsole`。Bot 代码发布仍只走它自己的发布流程。

官方房间统计用 `overview <房间>` 查询，字段含义见 [`docs/api/screeps-api.md`](./docs/api/screeps-api.md) 的「官方房间统计」。统计只能说明官方记录的区间数据，不能直接替代完整的房间实时 Energy 收支。

通知、报错或 console 日志只给了一个 tick、想看那一刻房间里发生了什么，用 `history <房间> --tick <tick> [--to <tick>]`（官方房间回放，任意房间可查，约 19 天内）；tick 标签的含义、取不到时的几种原因见 [`docs/api/screeps-api.md`](./docs/api/screeps-api.md) 的「官方房间回放」。
