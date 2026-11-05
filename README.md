# Screeps Assistant

Screeps 外部读取、游戏内表达式执行、实时连接、代码备份和数据分析工具。正式服、PTR、赛季服和私服使用同一套命令，通过目标配置隔离。

同时提供本机 stdio MCP 服务：支持 MCP 的客户端（如 Claude、Codex）可直接调用结构化工具；不支持 MCP 的智能体平台直接调用同一套 CLI 即可，不需要远程 MCP 网关。

## 入口

所有命令统一用 `node bin/screeps-assistant.js <命令>`，在任何目录、任何 shell 下行为一致；`npm link` 后也可以直接用 `screeps-assistant <命令>`。`node bin/screeps-assistant.js --help` 列出全部命令和参数。

本工具没封装的只读端点（如市场行情 `gameMarketOrders`、资金流水 `userMoneyHistory`）再用上游 CLI 兜底：`npx --no-install screeps-api call <方法> ...`，只调用只读方法。

> **Windows 警告：不要经 `npm run query --` 传 console 表达式。** cmd.exe 会把 `>`（含 `=>`）、`|`、`&`、`^`、`%` 当特殊字符，导致表达式截断或生成垃圾文件。请直接执行 `node bin/screeps-assistant.js console --file probe.js`，或用 stdin：`--file -`。Git Bash 会把以 `/` 开头的参数改写成路径，表达式同样建议来自文件或 stdin。

## 安装

需要 Node.js（开发与测试使用 v24）。

```bash
npm ci
```

## 目标与配置

本地 `.screeps.yml` 保存凭据，已被 Git 忽略；Token 在 Screeps 账户设置 → Auth Tokens 里生成，文件格式遵循 [SS3 统一凭据文件](https://github.com/screepers/screepers-standards/blob/master/SS3-Unified_Credentials_File.md)。`--target` 选择其中的服务器块，内置四个目标：

| 目标 | 服务器 | 默认分片 | 可选分片 | 代码分支 |
|---|---|---|---|---|
| `main` | 正式服 | `shard2` | shard0～shard3、shardX | `main` |
| `ptr` | PTR（正式服测试环境；维护期间经常返回 502，需稍后重试） | `shard2` | shard0～shard3 | `main` |
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
      alt:                      # 用 --account alt 选择
        token: "备用账号token"
```

所有命令加 `--account <账号名>` 即切换到该账号；省略则用该服务器的默认账号：

```bash
node bin/screeps-assistant.js account --target main                        # 默认账号
node bin/screeps-assistant.js account --target main --account alt          # 备用账号
node bin/screeps-assistant.js rooms --target main --shard shard2 --account alt
```

## 查询命令

```bash
# 账号、分片、己方房间
node bin/screeps-assistant.js account --target main
node bin/screeps-assistant.js shards --target main
node bin/screeps-assistant.js rooms --target main --shard shardX

# 房间摘要（房间名可写位置参数或 --room）
node bin/screeps-assistant.js room W1N1 --target main --shard shard2

# 房间全部对象：不需要视野，不占 console 额度
node bin/screeps-assistant.js room W1N1 --objects --filter type=creep --fields name,x,y,hits,fatigue,username --target main --shard shard2

# 官方房间统计
node bin/screeps-assistant.js overview W1N1 --target main --shard shard2
node bin/screeps-assistant.js overview W1N1 --interval 180 --stat creepsLost --target main --shard shard2
node bin/screeps-assistant.js overview W1N1 --pick stats --fields total --compact --target main --shard shard2
node bin/screeps-assistant.js overview W1N1 --tick 77950310 --target main --shard shard2

# 房间回放（官方 room-history，任意房间可查）：某个 tick 的房间现场，或一段 tick 内每个对象的变化
node bin/screeps-assistant.js history W1N1 --tick 77949750 --filter type=creep --fields name,username,x,y,hits --target main --shard shard2
node bin/screeps-assistant.js history W1N1 --tick 77949750 --to 77949780 --filter type=creep --fields tick,op,name,x,y,changes --target main --shard shard2

# 日志（订阅 console 事件流，只听不发表达式）：发布后盯 2 分钟有没有新报错 / 看某个模块在打什么 / 一行一条
node bin/screeps-assistant.js logs --errors --duration 120 --target main --shard shard2
node bin/screeps-assistant.js logs --duration 30 --grep spawn --target main --shard shard2
node bin/screeps-assistant.js logs --duration 20 --text --target main --shard shard2

# Memory（路径可用位置参数或 --path；省略即查整个 Memory）与 Segment
node bin/screeps-assistant.js memory rooms.W1N1 --target main --shard shard2
node bin/screeps-assistant.js segment --id 0,1 --target main --shard shard2

# 代码模块、市场挂单、消息索引
node bin/screeps-assistant.js code --target main --branch main
node bin/screeps-assistant.js market --target main --shard shard2
node bin/screeps-assistant.js messages --target main

# 环境概况（赛季能力、反应堆支持、世界尺寸、游戏时间）
node bin/screeps-assistant.js world --target season

# 地图分析：单房间、范围扫描、ASCII 地形图、范围汇总
node bin/screeps-assistant.js map --target season --room W1N1
node bin/screeps-assistant.js map --target season --around W1N1 --radius 2
node bin/screeps-assistant.js map --target main --shard shard2 --room W1N1 --ascii
node bin/screeps-assistant.js map --target season --around W1N1 --radius 3 --summary-only
```

`room` 摘要字段：`towers` / `spawns` / `labs` / `factories` 为房间内该类型建筑总数（含敌方）；`ownTowers` / `ownSpawns` / `ownLabs` / `ownFactories` 为己方数量；`storageEnergy` / `terminalEnergy` / `spawning` 仍只统计己方。

`room --objects` 输出官方房间对象接口的原样数组（每个建筑的 `store`、creep 的 `hits` / `fatigue` / `ageTime` / `actionLog`、墓碑、废墟等），带 `user` 的对象补上 `username`，便于 `--filter username=Invader`。没视野的房间也能读。

`overview` 读官方房间统计（room-overview）：

- `--interval` 是每格分钟数：`8`（默认，最近约 64 分钟）、`180`（约 24 小时）、`1440`（按天，约一周）；
- 每个统计项给出 `total`（序列求和）和 `series`；`end` 是这一格结束的本地时间（带时区偏移），最后一格通常还没结束，标 `inProgress: true`；
- 每格的 `ticks: [from, to]` 是这一格覆盖的 tick 范围，按当前 tick 和分片平均 tick 时长**估算**（顶层 `gameTime`、`tickMs` 就是这两个换算依据），越久远误差越大，边界附近可能差一格。相邻两格首尾相接，进行中的格子 `to` 等于 `gameTime`；读不到当前 tick 或 tick 时长时三个字段都没有，统计照常输出；
- `--tick <tick>` 只保留覆盖该 tick 的那一格（`total` 也只算这一格，顶层多一个 `tick`）；不给 `--interval` 时自动从 8、180、1440 里选能覆盖它的最细一档。tick 还没到、早于最大一档的范围、或读不到时钟时会报错；
- 统计项：`energyHarvested`（采集）、`energyConstruction`（建造和维修）、`energyCreeps`（孵化和续命）、`energyControl`（升级产生的 GCL 进度，不是能量）、`creepsProduced`、`creepsLost`、`powerProcessed`；`--stat` 只看一项；
- 赛季服的房间统计时有时无，没有数据时 `stats` 为空。

**房间回放（`history`）**读官方 room-history：通知、报错或 console 日志里只有一个 `Game.time` 时，用它看那一刻房间里发生了什么。任意房间都能查（己方、别人的、没视野的都行），不占 console 额度。两种用法见上面的示例：

- 只给 `--tick`：还原那个 tick 的房间现场。输出是和 `room --objects` 同形状的对象数组（官方原样字段），带 `user` 的对象补上 `username`；`--filter` / `--fields` 直接可用，不需要 `--pick`。
- 再给 `--to`（必须大于 `--tick`，最多相隔 1000 tick）：输出 `(tick, to]` 内每个对象的变化记录，按 tick 升序。每条记录的字段：`tick`、`op`（`added` 新出现、`removed` 消失、`changed` 有变化）、`id`、`type`、`structureType`（工地、建筑才有）、`name`（墓碑取 `creepName`）、`user`、`x`、`y`、`changes`（只有 `changed` 带）、`username`。`x`、`y` 是变化之后的位置，`removed` 取消失前的位置。
- `changes` 是官方逐 tick 差异的原样：只列这一格变化的键；值为 `null` 表示这个键被删或变成了 null；`store`、`body` 这类子对象只列变化的子键，数组（如 `body`）以下标为键。子键被删在官方数据里看不到。
- **tick 的含义**：回放里的 tick N 是引擎处理完第 N 个 tick 之后的房间现场，也就是 bot 在 `Game.time = N+1` 时看到的状态；bot 在 `Game.time = N` 发出的意图，结果就在 tick N 里。本 tick 新生成的对象（刚孵出的 creep、墓碑）要晚一帧才出现，死掉的 creep 在 tick N 就已经不在了。例如墓碑的 `deathTime` 是 77954062，它在 tick 77954063 才出现，那只 creep 在 tick 77954062 就已消失。
- 官方每 100 tick 存一块（块起点是 100 的整数倍，块里第一帧是完整快照，之后是逐 tick 差异）。只给 `--tick` 时只请求它所在的那一块；给了 `--to` 就按顺序请求涉及的每一块（1000 tick 最多 11 块，实测 9 块约 8 秒），块边界那一格用上一块的最后一帧和下一块的快照比出差异。
- 取不到时官方返回 404，响应里分不出原因，工具会再读一次当前 tick 帮忙判断：① 这一块还没写完（正在进行的这一块查不到，最新只能查到当前 tick 向下取整到 100 再减 1）；② 过了保留期（正式服实测约 19 天，约 30 万 tick）；③ 房间那时不活跃，官方不记录。偶尔还会遇到块里前面全是 `null`、只记录了末尾一两帧（报“回放块缺少起始帧”，并写明这一块从哪个 tick 才开始有记录），或整块缺失（同上面的 404）；块里记录到中途就断的，报错会写明记录到哪个 tick。
- 回放里的 `user` 只是 user id，工具用 `userFindById` 反查出 `username`（只取用户名；`Invader`、`Source Keeper` 内置），查不到的对象没有 `username` 字段。

`map` 命令说明：

- 范围四选一：`--room` 单房间、`--rooms` 逗号分隔列表、`--around` 中心房间加 `--radius`（默认 1）、`--all` 整个分片（请求很多，慎用）；
- `--concurrency` 控制并发请求数（默认 4，必须是 >= 1 的整数）；
- 地形永不变化，永久缓存在本地 `.cache/map/`（`--no-cache` 关闭；可选 `--cache-ttl` 毫秒强制过期）；房间状态和对象每次实时查询；
- 默认输出逐房间 JSON（地形统计、能源矿、矿物、赛季资源、反应堆、守护者巢穴、入侵核心）；`--summary-only` 只输出范围汇总；`--ascii` 打印 50×50 文字地形图。

## 日志（logs）

`logs` 订阅官方 console 事件流（WebSocket 的 `console` 频道），听 bot 在游戏控制台里自己打印的日志，也就是网页客户端 Console 面板里的那些文字。它去掉 HTML 颜色和链接标签，按条件过滤，给每行附上估算的 tick，输出为数组（可接 `--pick` / `--filter` / `--fields`），或用 `--text` 一行一条。

```bash
# 发布后盯 2 分钟有没有新报错
node bin/screeps-assistant.js logs --errors --duration 120 --target main --shard shard2

# 看某个模块在打什么
node bin/screeps-assistant.js logs --duration 30 --grep spawn --target main --shard shard2

# 人读：一行一条，行首是 ~tick 分片
node bin/screeps-assistant.js logs --duration 20 --text --target main --shard shard2

# 所有分片的日志，只留 shard 和 text 两个字段，最多 10 行
node bin/screeps-assistant.js logs --duration 15 --all-shards --fields shard,text --limit 10 --target main --shard shard2
```

**和 `console` 命令的区别**：`console` 往游戏里发一条表达式、取回返回值；`logs` 不发送任何东西，只订阅事件流，听 bot 每个 tick 自己打的日志。监听不占 console 发送额度（`POST /api/user/console` 每小时 360 次的那个）。

参数：

- `--duration <秒>`：听多久，默认 30，最多 600；
- `--grep <关键词>`：只留文本（去掉 HTML 之后）包含关键词的行，不区分大小写，是纯子串，不是正则；
- `--errors`：只留报错，包括脚本抛出的未捕获异常，以及文本里带 `*Error`（如 `TypeError`）、`Exception`、`Uncaught`、`报错`、`错误`、`异常` 的行。这是文本匹配，覆盖不到 bot 其它写法的报错；和 `--grep` 同用是“且”；
- `--all-shards`：默认只输出目标分片（`--shard`）的日志。一条订阅里混着你所有分片的日志，加上它才输出其它分片；
- `--limit <行数>`：最多输出多少行，默认 200，最多 5000。收满就提前结束监听，不等 `--duration`；先按 `--grep` / `--errors` 过滤再计数；
- `--text`：一行一条，格式 `~tick 分片 [错误] 文本`（没有 tick 时省略 `~tick`）。不能和 `--pick` / `--filter` / `--fields` / `--compact` 同用，这些只作用于默认的数组输出；
- Ctrl+C 提前结束监听，已收集的日志照常输出；stderr 有一行汇总（实际听了几秒、收到几行、输出几行，是否提前结束），不进 stdout。

输出数组里每个条目的字段：

| 字段 | 含义 |
|---|---|
| `tick` | 估算的 tick，只有目标分片的行才有；估算不出来时没有这个字段 |
| `shard` | 这行日志来自哪个分片 |
| `text` | 去掉 HTML 标签、解码实体后的文本，保留 bot 用来对齐的空格 |
| `error` | 只有为 `true` 时才有：脚本抛出的未捕获异常 |

要点：

- **只能往后听，没有历史。** 这个流只有实时数据，订阅之前打印的日志查不到。活跃的 bot 每个 tick 都可能打印日志（实测 25 秒内收到 23 行），所以要靠 `--grep` / `--errors` / `--limit` 收窄；
- **tick 是估算的。** 事件里没有 tick。工具在监听开始和结束时各读一次当前 tick（`gameTime`），日志行按到达时间在两者之间线性插值取整，误差约 ±1～2 tick，不依赖本机时钟与服务器同步。只有目标分片的行有 tick（锚点读的是目标分片，其它分片的行没有）；读不到当前 tick 时条目没有 `tick` 字段，监听结果不受影响，stderr 汇总里会提示；
- **日志里的 tick 与 `history` 的对应关系**：日志 tick N 是 bot 运行时的 `Game.time = N`，它看到的现场是回放 tick `N-1`，它发出的意图的结果在回放 tick `N`。所以拿到一行日志的 tick，可以接 `history <房间> --tick <N-1>` 看 bot 当时看到的房间，用 `--tick <N>` 看它这一步的结果；
- 表达式回包（`messages.results`）不属于 bot 日志，会被忽略；清理后为空的行会被跳过；一条日志内部的换行原样保留，所以 `--text` 下一个条目可能占多行。

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
Object.values(Game.creeps).filter(c => c.memory.role === 'harvester').map(c => c.name)
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

写探针前先看内置命令能不能直接回答：房间现场用 `room --objects`，某个历史 tick 的现场用 `history`，Memory 用 `memory` 加 `--filter` / `--fields`，房间统计用 `overview`。只有要读 bot 的运行时状态（`global` 上的对象、bot 自己的方法）时才需要探针。详见 [`probes/README.md`](probes/README.md)。

## 输出选项

`--compact` 将 JSON 压缩为单行；默认仍为 2 空格缩进。`--pick <路径>` 先取结果的子路径，之后的 `--filter` / `--fields` 作用于取出的部分。`--filter` 支持 `路径=值`、`路径!=值` 和点号路径，多条件用逗号分隔且为“且”。`--fields` 对数组元素或对象条目保留指定路径，输出键名保留路径原文。

```bash
node bin/screeps-assistant.js memory creeps --target season --filter role=harvester --fields role,home --compact
node bin/screeps-assistant.js overview W1N1 --target main --shard shard2 --pick stats --fields total
node bin/screeps-assistant.js room W1N1 --target main --shard shard2 --pick summary.hostileCreeps
```

`memory creeps` 返回的是「creep 名 → 该 creep 的 memory」对象集合，对象过滤会保留原键，所以 creep 名在键上。示例里的 `role`、`home` 只是常见字段名，实际取决于你的 Bot 往 creep Memory 里写了什么。

## MCP

先在本仓库执行 `npm ci`，然后将 MCP 客户端的 stdio 命令配置为：

```bash
node /path/to/screeps-assistant/src/mcp/server.mjs
```

`.screeps.yml` 按仓库位置读取，不依赖启动目录。MCP 工具直接调用 API，不经过 shell，也不启动 CLI 子进程。目前提供 8 个工具：状态检查、账号、分片、己方房间列表、房间摘要、Memory、Segment 和通用 Console。CLI 里较新的 `room --objects`、`overview`、`history`、`logs` 等命令暂未提供 MCP 版本（见[路线图](docs/roadmap.md)）。Console 传入的是完整游戏内 JavaScript，默认不重试，超时表示执行结果未知。

不支持 MCP、只能执行命令的智能体平台（例如云端沙箱里的 Agent）直接使用本 CLI。简单表达式可以用 `--expr`；复杂表达式使用 stdin：

```bash
node bin/screeps-assistant.js console --file - --target main --shard shardX <<'EOF'
Object.values(Game.creeps).filter(c => c.room.name === 'W1N1').map(c => c.name)
EOF
```

`skills/` 下的文件是 Skill 格式的参考；不同平台发现和加载 Skill 的方式不同，不要假设把 `SKILL.md` 复制过去就会被自动发现，请按各平台的要求安装。

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
docs/                      API、使用文档和路线图（docs/roadmap.md）
skills/                    Screeps 专用知识
```

## 安全边界

按能力分四层，查询只读、console 透传是唯二的例外通道：

- **环境隔离**：只连 `.screeps.yml` 里配置的服务器，分片按目标的分片列表校验，凭据本地 `.screeps.yml` 不提交，多账号用 `--account` 显式切换；
- **查询只读**：查询命令全部调用读取 API，不产生任何游戏副作用；
- **console 透传**：`console` 命令执行用户显式输入的游戏内表达式并原样返回输出。表达式在服务器端 eval，能力等同官方游戏内控制台——是否写入由表达式决定，工具不代写、不审查；默认按同一请求 ID 自动重试，游戏内 `global.__sa` 会按 ID 缓存结果（100 tick 后清理），重复到达不会再次执行。仅当两次发送之间发生 global 重置（如发布新代码）时可能重复执行，写入类表达式建议 `--retry 0`；`--raw` 关闭包装与重试；
- **无工具级写入**：不提供代码上传、市场交易、消息发送或标记已读、建筑/旗帜/Intent 创建、重生或放弃房间的命令；Bot 的代码发布请走它自己的发布流程（如 CI），本工具不是旁路发布通道。

## 验证

```bash
npm test
git diff --check
```

一次性探针放 `probes/`，一次性查询导出写到系统临时目录。仓库根目录不保留房间快照、Memory 导出或控制台表达式碎片。
