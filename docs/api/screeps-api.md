# Screeps API 已验证知识

> 这里只保留本仓库读取工具依赖的 API 调用方式、字段含义和判断边界。bot 的设计、计划和验收记录统一放在 `screeps-bot/handbook/`。

## 记录规则

1. 真实请求成功并核对返回数据后，才标记为 `verified`。
2. 结论必须注明验证日期、环境、调用方式和限制条件。
3. 新结果与旧结论冲突时追加纠偏，不静默覆盖。
4. API 返回缺失字段不等于业务事实不存在，必要时组合端点交叉验证。
5. 禁止记录 Auth Token、密码、Cookie 或完整私有 Memory。

## 客户端与基础查询

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **客户端：** `ScreepsHttpClient.fromConfig('main', { app: 'default' })`
- **常用方法：** `authMe()`、`gameTime(shard)`、`userMemoryGet()`
- `userMemoryGet()` 的返回值可能带 `{ ok, data }` 包装，读取前先检查 `data`。
- 查询非默认 shard 的 tick 必须显式调用 `gameTime(shard)`；未传 shard 的 tick 不能作为其他 shard 的验收证据。

## 查询账号房间

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **方法：** `userRooms()`
- **关键字段：** `result.shards.shard0` 至 `result.shards.shardX`
- 空数组只说明该账号没有被该端点列出的房间，不代表地图房间没有被其他玩家占领。
- 刚出生后该端点可能存在同步延迟；需要与 `gameRoomObjects()` 交叉核对。

## 地图起始定位房间

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **方法：** `userWorldStartRoom(shard)`
- 返回值是地图默认起始或定位房间，不代表该房间具有 Respawn Area 资格。
- 不能用这个端点单独判断是否可以重生。

## Respawn Area 判断

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **方法：** `gameRoomStatus(room, shard)` 或 `gameMapStats(rooms, 'owner0', shard)`
- **关键字段：** `room.respawnArea` / `stats[room].respawnArea`
- 该字段是 Unix 毫秒时间戳；只有 `respawnArea != null && respawnArea > Date.now()` 才表示当前有效。
- `status: 'normal'` 本身不代表可重生。

## 房间占领判断

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **方法：** `gameRoomObjects(room, shard)`，必要时使用 `userFindById(userId)` 查询用户名。
- 检查带 `user` 的 Spawn，以及 `user != null` 且 `level > 0` 的 Controller。
- `gameMapStats(..., 'owner0', ...)` 的 `users` 可能不展示实际占领者，不能单独作为占领结论。

## 房间资源与 Keeper

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **方法：** `gameRoomObjects(room, shard)`
- Source：`objects.filter(o => o.type === 'source')`
- Keeper Lair：`objects.filter(o => o.type === 'keeperLair')`
- Mineral：`objects.find(o => o.type === 'mineral')?.mineralType`
- 房间选择时应同时考虑占领状态、Source 数量、Keeper 和矿物，不能只比较 Source 数量。

## `objectSummary` 房间摘要字段

- **状态：** `verified`
- **来源：** `src/api/client.js` → `objectSummary(objects, userId)`，由 `room` 命令输出；要看全部原样对象用 `room <房间> --objects`。
- `towers` / `spawns` / `labs` / `factories`：房间内该类型建筑**总数**（含敌方），用于敌情判断；勿当作己方数量。
- `ownTowers` / `ownSpawns` / `ownLabs` / `ownFactories`：仅当前账号拥有的数量。
- `storageEnergy` / `terminalEnergy` / `spawning` / `constructionSites`：仍只统计己方。

## Console 通道

- **状态：** `verified`
- **验证日期：** 2026-10
- **来源：** 开源 driver/engine 源码核对与线上实测；客户端使用 `api.userConsole(expression, shard)` 和 socket `console` 订阅。
- `POST /api/user/console` 只提交命令，不返回执行结果。表达式超长等服务端拒绝可能仍是 HTTP 200，body 为 `{error: "..."}`；约 1000 字节开始受限，不能只靠异常或 HTTP 状态判断。
- 开源 driver 在 tick 开始取运行数据时就会把 console 队列清空。若该 tick 用户主循环先达到 CPU 上限，后续 console 命令不会执行，socket 可能只收到一条不带请求标识的顶层 `error`（如 CPU time limit reached）。
- socket `console` 事件的 `event.data` 形如 `{messages: {log: [...], results: [...]}, shard}` 或 `{error, shard}`。driver 用 `"" + eval(code)` 把最后一条语句的值转成字符串放入 `results`；`log` 可能包含 bot 每 tick 输出，不能作为本次回包依据。POST 后收到结果通常需要 2～5 秒。
- 端点额度：`POST /api/user/console` 360 次/小时；`GET /api/user/memory` 1440 次/天；`GET /api/user/memory-segment` 360 次/小时。响应头会更新 `api.rateLimits`，可用 `api.rateLimits.find('POST', '/api/user/console')` 读取 `{limit, remaining, reset, toReset}`；端点 429 默认不重试。

## 仍需按次确认

- Respawn Area 是否存在可直接查询“所有者”的专用端点。
- 客户端重生界面与 HTTP API 之间的同步延迟。
- 各 shard 的 CPU、tick 延迟、人口和房间状态；这些都是动态事实，做决策前必须重新查询。

## 官方房间统计

- **状态：** `verified`
- **验证日期：** 2026-11-05（正式服 shard2，E43N28，三档 interval 各取一次）
- **客户端方法：** `api.gameRoomOverview(room, interval, shard)`
- **端点：** `GET /api/game/room-overview`
- **命令：** `node bin/screeps-assistant.js overview E43N28 --interval 8 --target main --shard shard2`
- `interval` 是每格分钟数，只有三档：`8` 返回 8 格（约 64 分钟），`180` 返回 8 格（约 24 小时），`1440` 实测返回 7 格（按天）。
- 返回 `stats`（时间序列）、`totals`（区间总计）和 `statsMax`。`statsMax` 的键形如 `energy8`、`creepsProduced180`，同一 interval 下各能量项的值相同，不是本房间的区间最大值；`overview` 不输出它。
- 时间序列的 `endTime` 不是游戏 tick，也不是直接的 Unix 时间戳，而是以 `interval` 分钟为单位的 Unix 时间格号：`endTime × interval × 60000` 就是这一格结束时刻的 Unix 毫秒。相邻两格差 1；最后一格通常还没结束（结束时刻在当前时间之后），数值仍在累积。`overview` 命令已换算成带时区的本地时间，并给进行中的格子标 `inProgress`。
- tick 换算（估算）：统计只带墙钟时间，不带 tick。`overview` 用 `api.gameTime(shard)`（`{ok, time}`，当前 tick）加 `api.gameShardsInfo()` 里当前分片的 `tick`（最近若干 tick 的平均时长，毫秒，带小数且每次读到都略有波动；2026-11-05 shard2 实测在 3800～3950 之间）估算：墙钟时刻 `ms` 对应的 tick = `gameTime - (读到 gameTime 时的 Date.now() - ms) / tick 时长`。一格覆盖 `[结束 - interval×60000, 结束)`，已结束格子的 `ticks` 上界取下一格下界减 1，进行中的格子上界取 `gameTime`。这只是估算，不是引擎记录的 tick：实际 tick 时长会波动，越久远误差越大，格子边界附近可能差一格，也要求本机时钟与服务器时间大致同步。读不到这两项时 `overview` 不输出 `ticks`、`gameTime`、`tickMs`，统计照常输出。
- `totals` 只列非零项，数值等于序列求和；`overview` 的 `total` 按序列求和，零值项也有。
- 官方房间统计包括：`energyHarvested`、`energyConstruction`、`energyCreeps`、`energyControl`、`creepsProduced`、`creepsLost`、`powerProcessed`。
- `energyConstruction` 是 Creep 建造和维修消耗；`energyCreeps` 是 Spawn 和 Renew 消耗；`energyControl` 表示升级产生的 GCL 进度，不是 Energy 数量。
- 赛季服的房间统计时有时无，没有数据时不能当作该房间没有活动。
- 注意 `api.history(room, tick, shard)` 是另一个接口：房间回放（`/room-history/...`），按 100 tick 一块；它由本工具的 `history` 命令提供（见下一节「官方房间回放」），不要和房间统计（`overview`）混用。
- 该工具只读，不向 Screeps 提交游戏操作；官方接口的读取发生在 Bot 外部，不占 Bot 的游戏 CPU。

## 官方房间回放（room-history）

- **状态：** `verified`
- **验证日期：** 2026-11-05（正式服 shard2，E43N28 等己方房间，只读）
- **客户端方法：** `api.history(room, tick, shard)`（`ScreepsHttpClient`）
- **端点：** `GET /room-history/{shard}/{room}/{tick}.json`（路径不在 `/api` 下）
- **命令：** `node bin/screeps-assistant.js history E43N28 --tick 77949750 [--to 77949780] --target main --shard shard2`
- `tick` 会向下取整到 100 的倍数，一块覆盖 100 个 tick。**任意房间都有回放**（己方、别人的、没视野的都行），只是**不活跃的房间不记录**。
- 回包 `{timestamp, room, base, ticks}`：`timestamp` 是这一块写入的 Unix 毫秒（比块结束晚几十秒）；`ticks` 是以 tick 为键的对象。`ticks[base]` 是**完整快照**（`{[_id]: 对象}`，E43N28 约 360 个对象，不含旗子），之后每个 tick 是**相对上一 tick 的差异**。**每块自己独立**：只取一块就能还原块内任意 tick。块内的 tick 从 `base` 起连续，遇到第一个没记录的 tick 就断，所以可能不足 100 帧。
- 差异格式（与引擎 `getDiff` 一致，已核对源码）：
  - `diff[id] === null`：这个对象消失了；`id` 在上一帧不存在：`diff[id]` 是完整的新对象；
  - 否则 `diff[id]` 只含变化的键：值为 `null` 表示这个键被删了或变成 null（分不开）；标量或类型变化给新值；
  - 值是对象或数组的键只做**一层**子差异：`store: {energy: 50}` 只列变化的子键，子键的值是整个新值；**数组的子差异是以下标为键的对象**（如 creep 的 `body: {"3": {"type":"move","hits":0}}`），不是数组；
  - 子键被删除时引擎写的是 `undefined`，JSON 序列化会丢掉，所以回放里**看不到“子键被删”**（实测 `store` 里值为 0 的资源键会一直保留，实际几乎碰不到）；
  - 回放不含旗子；creep 的 `_actionLog`、`_ticksToLive` 和私有的 `say` 已被去掉，其它内部字段仍在（creep 的 `_fatigue`、`_oldFatigue`，tower、link、lab、factory 的 `_actionLog`，spawn、extension 的 `_off`），变化记录里会出现。
- **tick 标签的含义**：`ticks[N]` 是引擎处理完第 N 个 tick 后的房间现场，也就是 bot 在 `Game.time = N+1` 时看到的状态；bot 在 `Game.time = N` 发出的意图，结果就在 `ticks[N]`。本 tick 新生成的对象（刚孵出的 creep、墓碑）要晚一帧才出现，死掉的 creep 在 `ticks[N]` 已经没了。实测两次：墓碑 `deathTime = 77949718` 在 `ticks[77949719]` 才出现、creep 在 `ticks[77949718]` 就消失；墓碑 `deathTime = 77954062` 在 `ticks[77954063]` 才出现（2026-11-05，shard2，E43N28）。
- **取不到时是 HTTP 404**：错误对象是 `ScreepsApiError`，状态码在 `error.status`（`error.response` 是 undefined），`message` 是 `Request failed with status code 404`，`error.data` 是 nginx 的 HTML。404 有三种可能，响应里分不出来：① 这一块还没写完——**当前正在进行的那一块查不到**，最新只能查到上一块（实测 `gameTime = 77949738` 时 `77949700` 块 404、`77949600` 块可用）；② 过了保留期；③ 房间那时不活跃。分类要再读一次 `api.gameTime(shard)` 对照当前 tick。工具按约 30 万 tick 粗分：块起点比当前 tick 早得更多的报“已经过了官方的保留期”，保留期内的报“房间不活跃或官方缺块”（保留期内的活跃房间也偶尔整块 404）。
- **保留期**约 19 天：2026-11-05 08:07（UTC）实测，tick 77655500 的块（写入时间 2026-10-17 04:09 UTC，距当时的 tick 约 30 万）还在，tick 77650000 的块已经 404（中间的块没有逐个探）。按 tick 数算只是约数，实际应按写入时间过期。
- **块里可能有 `null` 占位帧，也可能整块缺失**（2026-11-05 在 E43N28 上扫描 44 个连续块的实测，不是统计规律）：绝大多数块是“第一帧完整快照 + 99 帧差异”，但 3 块形如“前 98 或 99 帧的值是 `null`，只有最后一两帧有数据”（有数据的第一帧是完整快照，推测是官方写入中断后补写的块），另有 4 块整块 404（在保留期内，房间也是活跃的）。`null` 帧是“没有记录”，不能当成空差异，更不能当成“所有对象消失”。
- 回放里的 `user` 只是 user id。`GET /api/user/find?id=` 即 `api.userFindById(id)` 能反查：返回 `{ok: 1, user: {_id, username, badge, gcl, power, steam}}`（**不要输出 `steam`**，只取 `username`）；id 不存在时返回 `{ok: 1, user: {error: '…'}}` 之类，要容错。特殊 id：`'2'` 是 `Invader`，`'3'` 是 `Source Keeper`（不是合法 ObjectId，别拿去查）。
- 还原：取一块，`state = structuredClone(ticks[base])`，之后逐 tick 应用差异即得到任意 tick 的现场。跨块那一格没有差异可用（下一块的第一帧是快照），用上一块还原到最后一帧的状态和下一块的快照逐对象比出差异。引擎在差异里把“键被删”也写成 `null`，所以还原出来的状态会留着 `null`，而官方快照里直接没有这个键（实测如 creep 的 `_oldFatigue`）；比较时要把 `null` 和缺键当成同一回事，否则块边界会多出没发生过的变化。用这个方法对 E43N28 的 9 对相邻块实测，块边界那一格的变化条数（9～26）和块内相邻帧（平均约 20）同量级，没有累积漂移。

## 官方 console 事件流（WebSocket）

- **状态：** `verified`
- **验证日期：** 2026-11-05（正式服，只读订阅 25 秒；同一个 25 秒窗口里收到了 shardX、shard3、shard2 三个分片的事件）
- **客户端方法：** `await api.socket.connect()` 后 `await api.socket.subscribe('console', cb)`；收尾用 `api.socket.unsubscribe('console', cb)` 和 `api.socket.disconnect()`。连接与清理的写法见 `src/api/console.js` 的 `openConsoleSession`：`api.socket.on('error', () => {})` 加 `api.socket.off('error', console.error)` 可以静默 socket 错误（screeps-api 默认把它用 `console.error` 整段打印）。
- **命令：** `node bin/screeps-assistant.js logs --duration 30 --target main --shard shard2`（实现见 `src/api/logs.js`）
- `cb(event)` 的 `event` 键是 `type`、`id`、`path`、`data`；`event.data` 的键是 `messages`、`shard`；脚本抛出未捕获异常时是 `error`（和 `shard`），见上面「Console 通道」。
- `data.messages.log`：字符串数组，是 bot 这个 tick 打印的日志，**每条是带 HTML 的字符串**。例如 `[<font color="#ffffff">    主循环</font>]         Bucket： 9791`，或 `<font color="#ff8080">[<font color="#80ff80">      单位</font>]<font color="#80ff80">[<a href="#!/room/shard2/E44N28">E44N28</a>]</font> TRR_7m 本 Tick 消耗了 6.33 CP`。颜色是 `<font color>`，房间名是 `<a href="#!/room/{shard}/{room}">` 链接，bot 用空格给标签对齐，去标签后要保留这些空格。
- `data.messages.results`：表达式执行结果。本工具 `console` 命令的 `@@sa:` 协议回包走这里；`logs` 忽略它。
- `data.shard`：这条事件属于哪个分片。**一条订阅里混着所有分片的日志**，不是只给 `--shard` 指定的那一个，要按 `data.shard` 过滤。
- `data.error`：脚本抛出未捕获异常时的错误文本（`src/api/console.js` 的 `dispatch` 就是这么处理的），`logs` 把它当作一条 `error: true` 的记录。
- **事件里没有 tick。** 只能按到达时间估算：监听开始和结束时各读一次 `api.gameTime(shard)`（`{ok, time}`，当前 tick），中间按到达时间线性插值取整。这种“两端锚点加实测斜率”的做法不依赖 `gameShardsInfo` 的平均 tick 时长，也不要求本机时钟与服务器同步；两端各有 ±0.5 tick 的取整误差，整体误差约 ±1～2 tick。锚点读的是目标分片的 tick，其它分片的日志算不出 tick。
- `api.gameTime(shard)` 缺 shard 时是**同步 throw**，不返回 rejected promise；要统一按失败处理，得用 `async` 包一层（`const attempt = async call => call();`，`src/api/queries.js` 和 `src/api/logs.js` 都这么做）。
- **只有实时数据，没有历史**：订阅之前打印的日志查不到。bot 平时很能说（实测 25 秒收到 23 行，含每单位 CPU 消耗、限流跳过等），需要过滤和上限。
- 订阅是 WebSocket 上的只读订阅，不调用 `POST /api/user/console`，所以不占那个 360 次/小时的发送额度。

## 上游 CLI

本仓库命令没封装的只读端点，用上游 `screeps-api` CLI 兜底：

```bash
npx --no-install screeps-api call gameMarketOrders O shard2
npx --no-install screeps-api call userMoneyHistory
```

已封装端点与本仓库命令的对照、上游 CLI 的配置差异和禁用的写入接口，见 [`AGENTS.md`](../../AGENTS.md) 的「入口优先级」。完整命令以 `npx --no-install screeps-api --help` 和 `npx --no-install screeps-api call --help` 为准。
