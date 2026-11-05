# Screeps Assistant — 外部读取与监控工具

基于 [screepers/node-screeps-api](https://github.com/screepers/node-screeps-api)（社区维护的非官方封装）的 Screeps 外部 HTTP + WebSocket API 命令行工具集。

这是 Screeps 的外部工具与通用游戏知识仓库，提供房间与账号信息读取、游戏内 Console 表达式执行、实时监控、数据分析、代码只读备份，以及不依赖具体 Bot 框架的游戏机制和策略资料。bot 的设计与实现不在本仓库维护。

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
├── src/api/              # 目标配置、只读 API、查询层与 console 执行
├── src/cli/              # 参数解析与输出选项
├── src/mcp/              # stdio MCP 入口
├── src/map/              # 跨环境地图分析（纯函数）与联网扫描
├── tools/backup/         # 线上代码只读备份
├── tools/live/           # WebSocket 与 CPU 采样
├── probes/               # 一次性 console 探针（只有 README 入库）
├── tests/                # 本地测试与 fixture
├── docs/                 # API、使用说明、通用游戏知识和参考资料
└── skills/               # Screeps 专用技能
```

## 常用命令

入口统一用 `node bin/screeps-assistant.js`（`--help` 看全部命令）；MCP 客户端用 `src/mcp/server.mjs`。

```bash
# 安装依赖
npm ci

# 查询（只读）
node bin/screeps-assistant.js summary --target main --shard shard2
node bin/screeps-assistant.js room E43N28 --target main --shard shard2              # 房间摘要
node bin/screeps-assistant.js room E43N28 --objects --filter type=creep --fields name,x,y,hits,fatigue --target main --shard shard2  # 全部对象，不需要视野
node bin/screeps-assistant.js overview E43N28 --interval 180 --target main --shard shard2  # 官方房间统计
node bin/screeps-assistant.js memory rooms.E43N28 --target main --shard shard2      # 路径用位置参数；省略路径即查根
node bin/screeps-assistant.js segment --id 0 --target main --shard shard2
node bin/screeps-assistant.js code --target ptr                                     # 核对 PTR 上的代码分支
node bin/screeps-assistant.js world --target season                                 # 环境概况：赛季能力、反应堆、世界尺寸
node bin/screeps-assistant.js map --target main --shard shard2 --room E43N28 --ascii  # 文字地形图

# 游戏内表达式（探针放 probes/，--file 可直接写探针名）
node bin/screeps-assistant.js console --expr "Game.time" --target main --shard shard2
node bin/screeps-assistant.js console --file my-probe --target main --shard shard2

# 本地验证
npm test
git diff --check

# 代码管理（只读拉取）
npm run pull                  # 只读拉取正式代码
node tools/backup/pull-code.js main ./dist # 拉取指定分支到指定目录
node tools/backup/pull-code.js main ./dist --target main --account yachiyo # 多账号拉取
```

不要经 `npm run query --` 传 console 表达式：Windows 的 cmd.exe 会把 `=>` 里的 `>` 当重定向。

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
- **代码推送:** `POST /api/user/code` —— **正式 bot 禁止直接调用，必须走 GitHub Actions**
- **Memory:** 返回 gzip+base64 格式，`screeps-api` 已自动解包

## 相关仓库

| 仓库 | 说明 |
|------|------|
| `../screeps-bot`（同级目录） | 游戏 AI 代码、领域设计与实现计划（TypeScript + esbuild） |
| `https://github.com/zkl2333/screeps-bot` | bot 的 GitHub 仓库，**唯一正式部署入口** |

## ⚠️ 注意事项

- 不要将 `.screeps.yml` 提交到 git（含 token）
- Screeps API 有速率限制（120 req/min 全局），`screeps-api` 内置了重试逻辑
- 密码认证已于 2018 年废弃，必须使用 Auth Token
- `screeps-bot/screeps.json` 中的旧密码已暴露在 git 历史中，建议更换

---

## 🚨 铁律：Bot 发布流程（必须遵守）

**`screeps-bot` 的正式线上代码，只能通过 GitHub Actions 发布。**

### 唯一合法发布路径

1. 在 `screeps-bot` 本地修改代码
2. 提交到 Git
3. 推送到 GitHub `main` 分支
4. 等待 GitHub Actions workflow `Deploy to Screeps` 成功
5. 用 Actions 日志 / 只读 API 核对线上是否与仓库一致

### 明确禁止

- ❌ 本地执行 `npm run push-main` / `push-*` 直接把代码推到 Screeps 正式 `main`
- ❌ 使用 `screeps-api` / `deploy-github.js` / `POST /api/user/code` 直接部署 bot
- ❌ 图方便“先线上再补仓库”或“只改线上不改仓库”
- ❌ 绕过 CI 制造仓库代码与线上代码漂移

### 允许的例外（仅限非生产）

- 本地 simulator / 私服调试：可用 `push-sim` / `push-pserver` 等，**不得**用于官方服正式 `main`
- 只读查询、监控、拉代码、分析 Memory：允许直接用 API
- console 表达式：允许执行，但表达式必须由用户显式给出或经用户确认；写入类表达式（改 Memory、执行游戏动作）不得自行构造

### 违规后果与纠偏

直接 API 部署会造成：

- 线上代码与 GitHub 仓库漂移
- CI 历史无法审计
- 后续 Agent / 协作者基于错误代码源做决策

一旦发现漂移：

1. 立刻停止继续直接部署
2. 以 GitHub `main` 为唯一真相源
3. 把缺失改动补回仓库并走 Actions 重新发布
4. 在 `screeps-bot/handbook/operations/` 记录漂移事件与纠正结果

**不要抱侥幸心理。规章制度必须落实到每次改 bot 的工作中。**

---

## 项目定位与协作职责

**screeps-assistant** 只维护 Screeps 外部工具。后续工作围绕以下职责展开：

- **读取状态：** 查询账号、Shard、房间、资源、敌情、Memory 和运行状态。
- **Console 执行：** 执行用户明确要求的游戏内表达式并返回输出；排查、评估和 review 默认只读，普通游戏操作可根据已确认目标构造表达式。默认按同一请求 ID 自动重试，游戏内用 `global.__sa` 按 ID 缓存结果（100 tick 后清理），重复到达不会再次执行。仅当两次发送之间发生 global 重置（如发布新代码）时可能重复执行，写入类表达式建议 `--retry 0`；`--raw` 关闭包装与重试。
- **监控分析：** 提供 HTTP / WebSocket 采集、结构化输出和通用分析能力。
- **代码备份：** 从 Screeps 只读拉取代码，辅助核对线上版本。
- **工具开发：** 修改本项目的 API 客户端、查询命令和分析脚本。
- **仓库边界：** 通用游戏知识可进入本仓库；TI 或当前 bot 的设计、实现计划、源码改动、发布结果和验收记录全部进入 `screeps-bot`。
- **检查 CI：** 使用本仓库工具核对 bot 线上状态时，仍必须以 GitHub Actions 发布结果为准，不得改用本地 API 直推作为“补救”。
- **操作边界：**
  - 查询和只读分析可直接执行
  - 排查、评估和 review 默认只执行只读操作；用户明确要求执行普通游戏操作时，可以根据已确认的目标和 bot API 构造并执行相应 Console 表达式
  - 重生、放弃房间等不可逆游戏操作，执行前必须明确告知影响
  - **bot 正式部署只能走 GitHub Actions，禁止直接 API 提交代码**
- **探针：** 线上排查先用内置命令（`room --objects`、`memory` 加 `--filter` / `--fields`、`overview`），读 bot 运行时状态才写 console 探针；探针放 `probes/`（不入库），不要放仓库根目录。

每次处理任务时，优先读取本目录及相关子目录的 `AGENTS.md`，再根据需要查询 Screeps API 和游戏状态。不要把本仓库当成 bot 设计仓库或旁路发布通道。

### 工具知识维护

- 已验证的 API 调用、字段含义和读取限制记录在 `docs/api/screeps-api.md`。
- 这里只记录工具如何读取数据，不记录 bot 应如何设计或下一步实现什么。
- 不把凭证、Auth Token、密码或完整私有 Memory 写入文档。
- 任何绕过 GitHub Actions 的 bot 部署尝试都视为流程违规，纠偏记录写入 `screeps-bot/handbook/operations/`。

### 文档归属

- 修改文档前先读 [`docs/README.md`](./docs/README.md)。
- 本仓库维护读取工具、API / WebSocket 用法、字段限制和框架无关的 Screeps 游戏知识。
- TI 及当前 bot 的领域模型、算法设计、代码计划、发布结果和线上验收全部写入 `screeps-bot/handbook/`。
- 查询结果默认是临时输出；需要长期保留时写入 bot 的对应领域或 `handbook/operations/`。
- 不创建 `.agent`、`.agents`、`agent-memory` 或新的项目计划文件；根目录 `AGENTS.md` 是唯一 Agent 规则入口。

### 入口优先级

1. **本工具的 CLI 和 MCP 是主入口。** 目标、分片、多账号和输出选项（`--pick` / `--filter` / `--fields` / `--compact`）在所有命令上一致。已封装的端点不要再走上游 CLI：

   | 上游方法 | 本工具命令 |
   |---|---|
   | `gameTime`、`gameWorldSize` | `world` |
   | `authMe` | `account` |
   | `userRooms` | `rooms` |
   | `gameRoomObjects` | `room <房间> --objects`（摘要用 `room <房间>`） |
   | `gameRoomOverview` | `overview <房间>` |
   | `userMemoryGet` | `memory <路径>` |
   | `userMemorySegmentGet` | `segment --id <id>` |
   | `userCodeGet` | `code` |
   | `gameMarketMyOrders` | `market` |
   | `userMessagesIndex`、`userMessagesUnreadCount` | `messages` |
   | `gameShardsInfo` | `shards` |
   | `gameRoomStatus`、`gameRoomTerrainUnencoded` | `map` |

2. **上游 `screeps-api` CLI 只做兜底**，用于本工具没封装的只读端点：

   ```bash
   npx --no-install screeps-api call <method> ...
   ```

   常用的未封装只读方法：市场 `gameMarketOrdersIndex`、`gameMarketOrders`、`gameMarketStats`、`userMoneyHistory`；地图 `gameMapStats`、`gameRoomTerrain`、`gameRoomDecorations`；消息 `userMessagesList`；历史与实验数据 `history`（房间回放）、`experimentalPvp`、`experimentalNukes`、`warpathBattles`。

   上游 CLI 要在本仓库目录下运行才能找到 `.screeps.yml`，用 `--server <名字>` 选服务器块（默认 `main`），只用服务器块自身的 token，不认本工具的 `accounts` 和目标覆盖字段。房间和 shard 应显式传入。`gameMapStats` 的 `rooms` 是逗号分隔的房间名列表，`stat` 另外支持 `owner0` 和 `claim0`；`resource` 使用 `screeps-api` 的 `MarketResources` 值；PVP/Warpath 接口的 interval 是独立的 tick 参数。完整命令以 `npx --no-install screeps-api --help` 为准。

上游 CLI 也暴露写入接口。Agent 只能用它的只读方法；禁止经上游 CLI 调用代码提交、Memory/Segment 写入、`userConsole`、建筑/旗帜/Intent、重生/放弃房间、市场写入、消息发送/标记已读或装饰修改等副作用 API。游戏内表达式一律走本工具的 `console` 命令（带请求 ID 匹配和同 ID 去重），不要用上游的 `userConsole`。正式 bot 部署仍只能走 GitHub Actions。

官方房间统计用 `overview <房间>` 查询，字段含义见 [`docs/api/screeps-api.md`](./docs/api/screeps-api.md) 的「官方房间统计」。统计只能说明官方记录的区间数据，不能直接替代完整的房间实时 Energy 收支。
