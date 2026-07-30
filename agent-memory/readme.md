# Screeps Agent 本地知识库

> 用途：记录已经通过真实 Screeps API 验证的调用方式、字段含义和常见误判，供后续 Agent 决策、编程和排障复用。
> 文件行数 > 200 时，请考虑拆分为多个子文件，考虑渐进加载。
> 安全：这里禁止写入 Auth Token、密码、Cookie 或其他凭证。
> 时效：会随时变化的状态等信息不应直接写入知识库；只记录可验证的调用方式和字段含义。
> 整洁：记录应保持简洁明了，避免冗余信息。
> 可读：记录应保持可读性，避免过度依赖代码片段；必要时提供示例调用和返回数据。
> 腐坏：记录应保持最新状态，避免使用已知失效或过时的信息。

## 分拆知识库

- [Planner V2 已验证记录](./planner-v2.md)：M0–M5、shard tick 修正、线上最终状态和后续效率瓶颈。
## 维护规则

1. 只有真实请求成功并核对返回数据后，才能标记为 `verified`。
2. 每条记录包含验证日期、环境、调用方式、关键字段和限制条件。
3. 新结果与旧结论冲突时，不直接覆盖；追加“修正记录”，说明旧结论为什么失效。
4. 只读查询可以自动记录；重生、部署、推送等有副作用的操作必须先得到用户明确授权。
5. API 返回缺失字段不等于业务事实不存在，必要时组合多个端点交叉验证。

## 已验证调用

### 1. 获取账号、游戏时间和 Memory

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **调用：** `ScreepsHttpClient.fromConfig('main', { app: 'default' })`
- **方法：** `authMe()`、`gameTime()`、`userMemoryGet()`
- **用途：** 获取用户名、GCL、CPU、Credits、当前 tick 和 Memory 根对象。
- **注意：** `userMemoryGet()` 返回对象中可能有 `{ ok, data }` 包装层；读取前先检查 `data`。

### 2. 查询用户当前房间

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **方法：** `userRooms()`
- **用途：** 获取各 shard 的已占领房间和 reservation。
- **关键字段：** `result.shards.shard0` 到 `result.shards.shardX`。
- **限制：** 空数组只说明该账号当前没有被该端点列出的房间，不代表某个地图房间没有其他玩家。

### 3. 查询 shard 的地图起始定位房间

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **方法：** `userWorldStartRoom(shard)`
- **示例：** `await api.userWorldStartRoom('shard2')` 返回 `E45N25`。
- **重要限制：** 该端点返回的是地图默认起始/定位房间，**不是 Respawn Area 资格判断**，不能据此判断房间是否可重生。

### 4. 判断房间是否处于 Respawn Area

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **方法：** `gameRoomStatus(room, shard)` 或 `gameMapStats(rooms, 'owner0', shard)`
- **关键字段：** `room.respawnArea` / `stats[room].respawnArea` 是 Unix 毫秒时间戳。
- **判断：** `respawnArea != null && respawnArea > Date.now()` 才表示当前 Respawn Area 仍有效。
- **注意：** `status: 'normal'` 不代表可重生；必须同时检查 `respawnArea`。

### 5. 判断房间是否已经被玩家占领

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **方法：** `gameRoomObjects(room, shard)`，必要时再用 `userFindById(userId)`。
- **检查：**
  - `type === 'spawn'` 且存在 `user`；
  - `type === 'controller'` 且 `user != null`；
  - `controller.level > 0`。
- **示例：** `E43N25` 的 controller 和 spawn 都属于用户 ID `5dc0453f9b78abbd4ca04b05`，再通过 `userFindById()` 核实为 `TedRoastBeef`。
- **重要限制：** 只看 `gameMapStats(..., 'owner0', ...)` 的 `users` 不可靠；它可能不展示房间内实际占领者。必须查 `room-objects`。

### 6. 评估房间资源和 Keeper

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **方法：** `gameRoomObjects(room, shard)`
- **统计：**
  - 能量源：`objects.filter(o => o.type === 'source').length`
  - Keeper：`objects.filter(o => o.type === 'keeperLair').length`
  - 矿物：`objects.find(o => o.type === 'mineral')?.mineralType`
- **决策建议：** 新人选房优先“空房 + 0 Keeper”，再考虑 2 源/3 源；三源 Keeper 房不应默认优于两源普通房。

## 已确认的历史结论

- `shard2 / E45N25`：是地图起始定位房间，但不是当前可用 Respawn Area，不能直接推荐重生。
- `shard2 / E43N25`：处于 Respawn Area，但已被 `TedRoastBeef` 占领。
- `shard2 / E42N24`：最近一次查询中为 Respawn Area、2 源、0 Keeper、无 Spawn、Controller 无归属；最终仍以客户端地图实时显示为准。
- `shard3`：以 `W15S5` 为中心的当前扫描范围未发现有效 Respawn Area；且近期用户数明显高于 shard2，不作为新人首选。

## 待验证/不要直接假设

- Respawn Area 的“所有者”是否有专门的 HTTP 端点；目前通过房间对象中的 controller/spawn 归属可以可靠识别实际占领。
- 重生界面中的颜色、预约状态和 HTTP API 的实时同步延迟。
- 不同 shard 的 CPU、tick 延迟和人口会动态变化，做选择前应重新查询。

## 2026-07-30 本次部署验证

- `screeps-bot` 在当前工作树执行 `npm run build` 成功，Rollup 产物可生成。
- `npm run lint` 当前不能执行：项目未安装/未声明 `tslint` CLI；这属于旧项目工具链问题，不等于构建失败。
- 使用 `SCREEPS_TOKEN` 环境变量覆盖旧的空 token，并执行 `DEST=main npm run push-main` 成功。
- 线上 `main` 分支 `activeWorld: true`，通过 `userCodeGet('main')` 拉取的 `main` 模块与本地 `dist/main.js` SHA-256 完全一致。
- `userRespawn()` 返回 `{"error":"invalid status"}`，因为账号当前已经是 `world-status: empty`，没有可放弃的现有房间；该调用未完成重生。房间选择仍需在游戏客户端执行。
- 本次没有提交或推送 GitHub；目标仓库 `dev` 分支存在大量未提交改动，应避免未经确认直接提交。

## 2026-07-30 重生坐标验证

- `shard2 / E42N24 / (27,24)` 成功出生。
- Spawn 名称为 `Spawn1`，坐标 `(27,24)`，账号归属正确。
- 初始 Controller 在 `(27,35)`，RCL 1。
- 部署脚本已开始运行，已看到账号自己的 creeps：`M_10`、`T_20`。
- `userRooms()` 在刚出生后仍返回空数组，存在状态同步延迟；用 `gameRoomObjects()` 检查 Spawn、Controller 和 creeps 更可靠。

## 2026-07-30 卡住问题修复

- 现象：重生后 `M_10`、`T_20` 长时间停在 Spawn 附近，能量为 0，RCL 1 进度不增长。
- 根因：`src/main.js` 的 `tlink()` 在新房间没有 Storage 时直接访问 `Game.rooms[roomName].storage.pos`，抛异常后中断整个 loop；同时主循环没有保护空 Spawn 列表。
- 修复：为 `tlink()` 增加 room/storage/controller/link 空值保护；主循环在没有 Spawn 时直接返回。
- 修复后：重新构建并直接部署到线上 `main`；约 12 秒后观察到 `M_10` 已移动到 Source 附近、`T_20` 有能量、并产生新 creep `T_110`，说明 loop 已恢复执行。

## 2026-07-30 GitHub CI 修复与验证

- 发现远程仓库没有 `main` 分支，原 workflow 只监听 `main`，因此不会响应当前 `dev` 开发分支。
- 发现远程仓库忽略 `package-lock.json`，原 workflow 使用 `npm ci` 会失败；已改为 `npm install`。
- workflow 已改为监听 `dev` 和 `main`，增加同分支并发取消，并明确部署 Screeps `main` 分支。
- 提交 `2fc8e1d` 已推送到 `origin/dev`；提交 `538b3cc` 已推送到 `origin/dev`。
- CI run `30526291353`：checkout/setup-node/npm install 成功，最后 `npm run push-main` 失败。由于匿名 API 无法下载 job logs，当前已知失败边界是 Screeps 部署步骤，不是依赖安装或构建步骤；需要核对 GitHub 仓库 Secret `SCREEPS_TOKEN` 是否存在且有效。

## 2026-07-30 GitHub CI 最终修复

- 使用 `gh` 检查并设置仓库 Secret `SCREEPS_TOKEN`。
- CI 第一次失败：远程不包含被 `.gitignore` 忽略的 `screeps.json`；workflow 增加临时生成部署配置步骤。
- CI 第二次失败：Linux 大小写敏感，`src/main.js` 的 `./role` 无法解析 `src/role/Index.ts`；已重命名为 `src/role/index.ts`。
- CI 第三次失败：旧 TS 配置禁止模块访问 Screeps 全局 lodash `_`；`tsconfig.json` 增加 `allowUmdGlobalAccess: true`。
- 最新提交 `cc125b5` 已推送到 `origin/dev`。
- GitHub Actions run `30527463580` 成功：依赖安装、部署配置生成、Rollup 构建和推送 Screeps main 全部成功。
- 当前本地仍有未提交的 `src/lib/Traveler.ts` 修改；它未包含在成功 CI 提交中，不能擅自提交。

## 2026-07-30 分支策略收敛为 main

- GitHub 默认分支已改为 `main`。
- 远程 `dev` 分支已删除，远程 `main` 从稳定开发历史创建并推送。
- CI workflow 现在只监听 `main`；只有推送/合并到 `main` 才会自动部署 Screeps `main`。
- 本地 `dev` 分支已删除，`origin/HEAD` 已更新为 `origin/main`。
- 最新 main 提交 `8343785` 的 GitHub Actions run `30528492116` 成功。

## 2026-07-30 Bootstrap + 轻量自动规划

- **状态：** `verified`
- **验证日期：** 2026-07-30
- **改动仓库：** `screeps-bot`
- **部署：** 直接 push 到 Screeps `main`，本地 `dist/main.js` 与线上 `userCodeGet('main')` SHA-256 一致。
- **问题：** 旧 bot 只有 builder 施工逻辑，没有 createConstructionSite；Overmind `roomPlanner` 未接入 main。RCL1 无 container/storage 时 upgrader 断粮，controller progress 长期为 0。
- **修复：**
  1. `role/upgrader.ts`：优先 pickup 掉落能量，再 withdraw container/storage/link，最后 harvest 兜底。
  2. `role/transporter.ts`：spawn/extension 已满时把能量运到 controller 附近 drop。
  3. `utils/room-plan.ts`：每 20 tick 规划 source 旁 container；RCL2+ 在 spawn 周围放 extension。
  4. `main.js` 接入 `planRoomStructures`；`util.checkCreeps` 改为全房间扫描 construction sites。
- **线上观察（shard2/E42N24）：**
  - controller progress 从 0 变为 12
  - 出现 2 个 container 工地（source 旁），其中一个 progress 80/5000
  - 已孵化 builder `Z_70`
- **限制：** 仍未接入完整 bunker roomPlanner；extension 要等 RCL2；container 建成前仍依赖掉落能量 bootstrap。

## 2026-07-30 仓库重命名

- 本地目录：E:\workspace\mine\games\ScreepsWorld\my-screeps-bot → E:\workspace\mine\games\ScreepsWorld\screeps-bot
- package.json name 已改为 screeps-bot
- GitHub 远程仍为 zkl2333/my-screeps-bot（未改远程仓库名）
- 旧目录可能仍被进程占用；优先使用新目录。旧目录可在解锁后删除。

## 2026-07-30 仓库重命名

- 本地：my-screeps-bot → screeps-bot
- GitHub：zkl2333/my-screeps-bot → zkl2333/screeps-bot
- 旧文件夹已删除
- README 和 AGENTS.md 已同步更新
- 旧 GitHub 远程已删除，新远程为 screeps-bot（需在 GitHub 上手动 rename repo，否则 push 会失败）

## 2026-07-30 制度：Bot 必须经 GitHub Actions 发布

- **状态：** policy
- **生效日期：** 2026-07-30
- **适用范围：** `screeps-bot` 正式线上代码（官方服 `main` 分支）
- **唯一合法路径：** 本地改代码 → Git commit → 推送 GitHub `main` → Actions `Deploy to Screeps` 成功
- **明确禁止：**
  - 本地 `npm run push-main` / `push-*` 直接推官方服正式分支
  - `screeps-assistant` 中 `deploy-github.js` / `screeps-api` / `POST /api/user/code` 直接部署 bot
  - 先改线上再补仓库，或只改线上不改仓库
- **允许例外：** simulator / 私服调试；只读查询、监控、拉代码
- **违规危害：** 线上与仓库漂移、发布不可审计、后续决策基于错误代码源
- **纠偏要求：** 以 GitHub `main` 为唯一真相源；缺失改动补回仓库后走 Actions 重新发布；违规事件写入本知识库
- **历史问题：** 此前存在图方便直接 API 部署的行为，已明确判定为无组织无纪律，后续禁止再犯
- **文档落点：** `screeps-assistant/AGENTS.md`、`screeps-bot/AGENTS.md`

## 2026-07-30 自动规划现状复核

- **状态：** `verified`
- **验证方式：** Screeps 只读 HTTP API（`gameRoomObjects`、`userMemoryGet`、`userCodeGet`）+ 本地 `npm run build`
- **线上样本：** `shard2 / E42N24`，tick `76169927`
- **房间状态：** Controller 已到 RCL2，progress 50；Spawn1 正常存在。
- **规划落地：**
  - source container 工地 2 个：`(28,23)` progress `1345/5000`、`(21,38)` progress `550/5000`
  - extension 工地 1 个：`(26,23)` progress `41/3000`
  - 当前没有已建成的 container / extension
- **人口状态：** 2 miner、3 transporter、2 builder、1 upgrader；Spawn1 队列中有 1 repairer；`Memory.j=false`。
- **代码接入确认：** 线上 `main` bundle 包含每 20 tick 执行的轻量规划、source container 和 extension 规划；不包含遗留 Overmind `RoomPlanner.buildMissingStructures` / bunker planner 运行代码。
- **成熟度结论：** 当前只实现 bootstrap 级自动规划（source container + spawn 周边 extension）和固定人数孵化；道路、controller container、tower/storage/link、完整 RCL 布局、扩张与远程采矿等尚未实现。
- **构建验证：** `screeps-bot` 当前工作树 `npm run build` 成功，仅有旧版 Rollup 插件弃用与 creep-tasks 循环依赖警告。
- **注意：** 线上 bundle 与当前本地重新构建产物字节哈希不一致；当前工作树存在未提交的构建/配置文件改动，不能仅凭该哈希判定线上业务代码漂移。规划功能标志和实际房间行为一致。
