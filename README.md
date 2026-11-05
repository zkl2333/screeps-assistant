# Screeps Assistant

Screeps 外部读取、游戏内表达式执行、实时连接、代码备份和数据分析工具。正式服、PTR、赛季服和私服使用同一套命令，通过目标配置隔离。

同时提供本机 stdio MCP：Finch、Codex、zcode 和 Claude 可直接调用结构化工具；Grok Bot 使用同一 CLI，不需要远程 MCP 网关。

## 入口

所有命令统一用 `node bin/screeps-assistant.js <命令>`，在任何目录、任何 shell 下行为一致；`npm link` 后也可以直接用 `screeps-assistant <命令>`。`node bin/screeps-assistant.js --help` 列出全部命令和参数。

本工具没封装的只读端点（如市场行情 `gameMarketOrders`、资金流水 `userMoneyHistory`）再用上游 CLI 兜底：`npx --no-install screeps-api call <方法> ...`，只调用只读方法。

> **Windows 警告：不要经 `npm run query --` 传 console 表达式。** cmd.exe 会把 `>`（含 `=>`）、`|`、`&`、`^`、`%` 当特殊字符，导致表达式截断或生成垃圾文件。请直接执行 `node bin/screeps-assistant.js console --file probe.js`，或用 stdin：`--file -`。Git Bash 会把以 `/` 开头的参数改写成路径，表达式同样建议来自文件或 stdin。

## 安装

```bash
npm ci
```

## 目标与配置

本地 `.screeps.yml` 保存凭据，已被 Git 忽略。`--target` 选择其中的服务器块，内置四个目标：

| 目标 | 服务器 | 默认分片 | 可选分片 | 代码分支 |
|---|---|---|---|---|
| `main` | 正式服 | `shard2` | shard0～shard3、shardX | `main` |
| `ptr` | PTR（正式服测试环境，经常 502，连得上时可用） | `shard2` | shard0～shard3 | `main` |
| `season` | 赛季服 | `shardSeason` | shardSeason | `default` |
| `pserver` | 私服 | `shard0` | shard0 | `default` |

```yaml
servers:
  main:
    url: https://screeps.com/
    token: "你的token"
  ptr:
    url: https://screeps.com/ptr/
    token: "你的token"            # PTR 与正式服共用账号和 token
  season:
    url: https://screeps.com/season/
    token: "你的token"
```

服务器块里可以加三个本工具专用的可选字段，覆盖内置默认值；新赛季换了分片名或分支时只改配置，不改代码：

```yaml
servers:
  season:
    url: https://screeps.com/season/
    token: "你的token"
    shards: [shardSeason]       # 允许的分片，--shard 会按它校验
    defaultShard: shardSeason   # 省略 --shard 时使用
    codeBranch: default         # code、summary 和代码备份默认读取的分支
```

`.screeps.yml` 里内置目标之外的服务器块也能直接当 `--target` 用，分片按上面三个字段确定（都省略时为 `shard0`）。

### 多账号

账号嵌套在所属服务器之下。服务器块自身的 `token` 是默认账号，其它账号挂在 `accounts` 子表里：

```yaml
servers:
  main:
    url: https://screeps.com/
    token: "默认账号token"        # 不带 --account 时使用
    accounts:
      yachiyo:                  # 用 --account yachiyo 选择
        token: "yachiyo的token"
```

所有命令加 `--account <账号名>` 即切换到该账号；省略则用该服务器的默认账号：

```bash
node bin/screeps-assistant.js account --target main                        # 默认账号
node bin/screeps-assistant.js account --target main --account yachiyo      # Yachiyo
node bin/screeps-assistant.js rooms --target main --shard shard2 --account yachiyo
```

## 查询命令

```bash
# 账号、分片、己方房间
node bin/screeps-assistant.js account --target main
node bin/screeps-assistant.js shards --target main
node bin/screeps-assistant.js rooms --target main --shard shardX

# 房间摘要（房间名可写位置参数或 --room）
node bin/screeps-assistant.js room E43N28 --target main --shard shard2

# 房间全部对象：不需要视野，不占 console 额度
node bin/screeps-assistant.js room E43N28 --objects --filter type=creep --fields name,x,y,hits,fatigue,username --target main --shard shard2

# 官方房间统计
node bin/screeps-assistant.js history E43N28 --target main --shard shard2
node bin/screeps-assistant.js history E43N28 --interval 180 --stat creepsLost --target main --shard shard2
node bin/screeps-assistant.js history E43N28 --pick stats --fields total --compact --target main --shard shard2
node bin/screeps-assistant.js history E43N28 --tick 77950310 --target main --shard shard2

# Memory（路径可用位置参数或 --path；省略即查整个 Memory）与 Segment
node bin/screeps-assistant.js memory rooms.E43N28 --target main --shard shard2
node bin/screeps-assistant.js segment --id 0,1 --target main --shard shard2

# 代码模块、市场挂单、消息索引
node bin/screeps-assistant.js code --target main --branch main
node bin/screeps-assistant.js market --target main --shard shard2
node bin/screeps-assistant.js messages --target main

# 环境概况（赛季能力、反应堆支持、世界尺寸、游戏时间）
node bin/screeps-assistant.js world --target season

# 地图分析：单房间、范围扫描、ASCII 地形图、范围汇总
node bin/screeps-assistant.js map --target season --room W2N39
node bin/screeps-assistant.js map --target season --around E5S5 --radius 2
node bin/screeps-assistant.js map --target main --shard shard2 --room E41N23 --ascii
node bin/screeps-assistant.js map --target season --around E5S5 --radius 3 --summary-only
```

`room` 摘要字段：`towers` / `spawns` / `labs` / `factories` 为房间内该类型建筑总数（含敌方）；`ownTowers` / `ownSpawns` / `ownLabs` / `ownFactories` 为己方数量；`storageEnergy` / `terminalEnergy` / `spawning` 仍只统计己方。

`room --objects` 输出官方房间对象接口的原样数组（每个建筑的 `store`、creep 的 `hits` / `fatigue` / `ageTime` / `actionLog`、墓碑、废墟等），带 `user` 的对象补上 `username`，便于 `--filter username=Invader`。没视野的房间也能读。

`history` 读官方房间统计（room-overview）：

- `--interval` 是每格分钟数：`8`（默认，最近约 64 分钟）、`180`（约 24 小时）、`1440`（按天，约一周）；
- 每个统计项给出 `total`（序列求和）和 `series`；`end` 是这一格结束的本地时间（带时区偏移），最后一格通常还没结束，标 `inProgress: true`；
- 每格的 `ticks: [from, to]` 是这一格覆盖的 tick 范围，按当前 tick 和分片平均 tick 时长**估算**（顶层 `gameTime`、`tickMs` 就是这两个换算依据），越久远误差越大，边界附近可能差一格。相邻两格首尾相接，进行中的格子 `to` 等于 `gameTime`；读不到当前 tick 或 tick 时长时三个字段都没有，统计照常输出；
- `--tick <tick>` 只保留覆盖该 tick 的那一格（`total` 也只算这一格，顶层多一个 `tick`）；不给 `--interval` 时自动从 8、180、1440 里选能覆盖它的最细一档。tick 还没到、早于最大一档的范围、或读不到时钟时会报错；
- 统计项：`energyHarvested`（采集）、`energyConstruction`（建造和维修）、`energyCreeps`（孵化和续命）、`energyControl`（升级产生的 GCL 进度，不是能量）、`creepsProduced`、`creepsLost`、`powerProcessed`；`--stat` 只看一项；
- 赛季服的房间统计时有时无，没有数据时 `stats` 为空。

`map` 命令说明：

- 范围四选一：`--room` 单房间、`--rooms` 逗号分隔列表、`--around` 中心房间加 `--radius`（默认 1）、`--all` 整个分片（请求很多，慎用）；
- `--concurrency` 控制并发请求数（默认 4，必须是 >= 1 的整数）；
- 地形永不变化，永久缓存在本地 `.cache/map/`（`--no-cache` 关闭；可选 `--cache-ttl` 毫秒强制过期）；房间状态和对象每次实时查询；
- 默认输出逐房间 JSON（地形统计、能源矿、矿物、赛季资源、反应堆、守护者巢穴、入侵核心）；`--summary-only` 只输出范围汇总；`--ascii` 打印 50×50 文字地形图。

## Console 表达式与稳定回包

表达式来源三选一：位置参数（按空格拼回）、`--expr <表达式>`、`--file <路径或探针名>`；`--file -` 从 stdin 读取。文件按 UTF-8 处理并去 BOM/首尾空白。最推荐文件和 stdin，可完整保留箭头函数、管道符、正则和多行代码。

默认模式会包装表达式并生成 8 位请求 ID：游戏内先执行用户代码，再把 `@@sa:<id>:<tick>:<kind>:<payload>` 写入 results；工具只认本次 ID，忽略 bot 日志和其他回包。成功值会尽量 JSON 化；JSON 序列化失败时用字符串表示；用户抛错返回错误栈（CLI 默认只显示错误首行和第一条 `at`，完整文本保留在错误对象上）。若结果字符串本身是 JSON 文本，CLI 会自动解包，因此 `JSON.stringify(...)` 的旧习惯仍可用。

有一个包装层作用域例外：用户代码能看到包装函数参数 `c`（表达式源码字符串），因此不要依赖名为 `c` 的全局变量；局部声明或箭头函数参数 `c` 不受影响。

服务器约在 1000 字节拒绝超长表达式；包装层最多占 320 字符，用户代码通常保留约 680 UTF-8 字节。CLI 会在联网前校验长度，并提示缩短/拆分、改用单引号，或必要时用 `--raw`。包装层会用 `global.__sa` 按 ID 缓存结果 100 tick；同一 ID 重发只返回缓存，不重复执行用户代码。

```bash
# Windows / Git Bash 推荐入口
node bin/screeps-assistant.js console --file probe.js --target main --shard shard2
node bin/screeps-assistant.js console --file - --target season < probe.js

# heredoc 定界符加单引号，内容不经 shell 展开
node bin/screeps-assistant.js console --file - --target main --shard shard2 <<'EOF'
Object.values(Game.creeps).filter(c => c.memory.role === 'scout').map(c => c.name)
EOF

# 单次执行；默认等待 15s，最多发送 3 次（初次 + 2 次重试）
node bin/screeps-assistant.js console --expr "Game.time" --target main --timeout 15000 --retry 2

# 输出协议信封，便于核对 ID、tick 和尝试次数；undefined 显示为 value:null + valueKind:"undefined"
node bin/screeps-assistant.js console --file probe.js --target main --envelope

# 连拍：每 10 秒一帧，默认 10 帧；每帧新 ID 且默认不重试
node bin/screeps-assistant.js console --file probe.js --target main --repeat 10 --times 10

# raw 模式：不包装、不重试，收到第一个非空 results 后返回
node bin/screeps-assistant.js console --file probe.js --target main --raw --retry 0
```

- `--retry 0`：只发送一次。默认包装模式 `--retry` 为 2，重试前等待 8s、15s；写入类表达式建议显式设为 0，避免两次发送之间遇到 global 重置时重复执行。
- `rejected`：服务器拒绝 POST，例如表达式过长；不会重试。
- `rate-limit`：console 端点额度受限；不会重试，并显示重置时间。
- `expression`：用户表达式执行抛错；返回 tick，stderr 默认只显示错误首行和第一条 `at`，完整文本保留在错误对象上，不会重试。
- `protocol`：本次 ID 的回包格式或 JSON 解析失败；不会重试。
- `timeout`：等待期间未收到本次 ID 回包。可能是该 tick 主循环超 CPU 导致服务端丢命令，也可能已执行但回包丢失；错误会说明发送次数和期间的服务端报错。
- `--repeat` 至少 2 秒；`--times` 为 1～60，给出 `--repeat` 时默认 10。`timeout`/`expression` 记为失败帧后继续，`rejected`/`rate-limit` 立即停止并以非零码退出。stdout 是 JSON Lines，stderr 输出重试进度、Ctrl+C 状态和额度汇总；Ctrl+C 在任一帧开始前到达时不会执行该帧。

### 探针

一次性 console 表达式放 `probes/`，除说明文件外不入库。`--file` 先按原样找文件；找不到时，不带目录的名字会当作探针名去 `probes/` 下找，`.js` 可省略，所以在任何目录下都能这样用：

```bash
node bin/screeps-assistant.js console --file my-probe --target main --shard shard2
```

写探针前先看内置命令能不能直接回答：房间现场用 `room --objects`，Memory 用 `memory` 加 `--filter` / `--fields`，房间统计用 `history`。只有要读 bot 的运行时状态（`global` 上的对象、bot 自己的方法）时才需要探针。详见 [`probes/README.md`](probes/README.md)。

## 输出选项

`--compact` 将 JSON 压缩为单行；默认仍为 2 空格缩进。`--pick <路径>` 先取结果的子路径，之后的 `--filter` / `--fields` 作用于取出的部分。`--filter` 支持 `路径=值`、`路径!=值` 和点号路径，多条件用逗号分隔且为“且”。`--fields` 对数组元素或对象条目保留指定路径，输出键名保留路径原文。

```bash
node bin/screeps-assistant.js memory creeps --target season --filter role=scout --fields role,origin --compact
node bin/screeps-assistant.js history E43N28 --target main --shard shard2 --pick stats --fields total
node bin/screeps-assistant.js room E43N28 --target main --shard shard2 --pick summary.hostileCreeps
```

`memory creeps` 返回的是「creep 名 → 该 creep 的 memory」对象集合，对象过滤会保留原键，所以 creep 名在键上。

## MCP

先在本仓库执行 `npm ci`，然后将 MCP 客户端的 stdio 命令配置为：

```bash
node /path/to/screeps-assistant/src/mcp/server.mjs
```

`.screeps.yml` 按仓库位置读取，不依赖启动目录。MCP 工具直接调用 API，不经过 shell，也不启动 CLI 子进程。第一版工具包括账号、Shard、房间、Memory、Segment 和通用 Console；Console 传入的是完整游戏内 JavaScript，默认不重试，超时表示执行结果未知。

Grok Bot 在它的云端电脑中使用本 CLI。简单表达式可以用 `--expr`；复杂表达式使用 stdin：

```bash
node bin/screeps-assistant.js console --file - --target main --shard shardX <<'EOF'
Object.values(Game.creeps).filter(c => c.room.name === 'E49N32').map(c => c.name)
EOF
```

在 Grok Bot 中完成一次 CLI 工作流后，可让它保存为私有 Skill；不要假设复制一个通用 `SKILL.md` 文件就会被 Grok 自动发现。

## 工具目录

```text
bin/                       正式命令入口
src/api/                   目标配置、只读 API、查询层和 console 执行
src/cli/                   参数解析与输出选项
src/mcp/                   stdio MCP 入口
src/map/                   跨环境地图分析（纯函数）和联网扫描
tools/backup/              线上代码只读备份
tools/live/                WebSocket 和 CPU 采样
probes/                    一次性 console 探针（不入库）
tests/                     本地测试
docs/                      API 和使用文档
skills/                    Screeps 专用知识
```

## 安全边界

按能力分四层，查询只读、console 透传是唯二的例外通道：

- **环境隔离**：只连 `.screeps.yml` 里配置的服务器，分片按目标的分片列表校验，凭据本地 `.screeps.yml` 不提交，多账号用 `--account` 显式切换；
- **查询只读**：查询命令全部调用读取 API，不产生任何游戏副作用；
- **console 透传**：`console` 命令执行用户显式输入的游戏内表达式并原样返回输出。表达式在服务器端 eval，能力等同官方游戏内控制台——是否写入由表达式决定，工具不代写、不审查；默认按同一请求 ID 自动重试，游戏内 `global.__sa` 会按 ID 缓存结果（100 tick 后清理），重复到达不会再次执行。仅当两次发送之间发生 global 重置（如发布新代码）时可能重复执行，写入类表达式建议 `--retry 0`；`--raw` 关闭包装与重试；
- **无工具级写入**：不提供代码上传、市场交易、消息发送或标记已读、建筑/旗帜/Intent 创建、重生或放弃房间的命令；bot 正式代码发布只走 `screeps-bot` 的 GitHub Actions，本工具不是旁路发布通道。

正式 Bot 代码只能通过 GitHub Actions 发布，不能从本项目旁路上传。

## 验证

```bash
npm test
git diff --check
```

一次性探针放 `probes/`，一次性查询导出写到系统临时目录。仓库根目录不保留房间快照、Memory 导出或控制台表达式碎片。
