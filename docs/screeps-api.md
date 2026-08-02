# Screeps API 已验证知识

> 这里只保留本仓库读取工具依赖的 API 调用方式、字段含义和判断边界。bot 的设计、计划和验收记录统一放在 `screeps-bot/docs/`。

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

## 仍需按次确认

- Respawn Area 是否存在可直接查询“所有者”的专用端点。
- 客户端重生界面与 HTTP API 之间的同步延迟。
- 各 shard 的 CPU、tick 延迟、人口和房间状态；这些都是动态事实，做决策前必须重新查询。

## 官方房间统计

- **客户端方法：** `api.gameRoomOverview(room, interval, shard)`
- **端点：** `GET /api/game/room-overview`
- **示例：** `npm --silent run api -- room-overview E42N24 8 shard2`
- `interval=8` 表示每 8 分钟一个数据点，返回最近 64 分钟；`180` 为最近 24 小时，`1440` 为最近 8 天。
- 返回 `stats`（时间序列）、`totals`（区间总计）和 `statsMax`（区间最大值）。时间序列中的 `endTime` 是官方单调递增标识，不是游戏 tick 或 Unix 时间戳。
- 官方房间统计包括：`energyHarvested`、`energyConstruction`、`energyCreeps`、`energyControl`、`creepsProduced`、`creepsLost`、`powerProcessed`。
- `energyConstruction` 是 Creep 建造和维修消耗；`energyCreeps` 是 Spawn 和 Renew 消耗；`energyControl` 表示升级产生的 GCL 进度，不是 Energy 数量。
- 该工具只读，不向 Screeps 提交游戏操作；官方接口的读取发生在 Bot 外部，不占 Bot 的游戏 CPU。

## 统一只读 CLI

`npm --silent run api -- <command> ...` 是 Agent 调用 Screeps API 的统一入口。默认输出单行 JSON，添加 `--pretty` 可格式化输出。

当前 CLI 白名单覆盖所有已识别的只读 HTTP 方法，分为：基础/认证与历史、地图/房间、无持久化副作用的名称检查、市场与 Shard、排行榜/赛季、用户读取、Memory/Segment、消息读取、实验 PVP/核弹/Warpath 和 Seasonal World scoreboard。具体命令和参数以根目录 `AGENTS.md` 及 `npm --silent run api -- --help` 为准。

名称生成、名称检查和 `map-stats` 使用官方 `POST` 端点，但它们不修改持久化游戏状态，因此纳入只读 CLI。CLI 不接受任意客户端方法名，不开放原始 `authQueryToken`、`req()`、`userCodeSet`、`userMemorySet`、`userMemorySegmentSet`、`userConsole`、建筑/旗帜/Intent、重生、市场写入、消息发送/标记已读或装饰修改等副作用接口。`token-info` 只输出当前 Token 的权限元数据，始终删除 Token 字段。
