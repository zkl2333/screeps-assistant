# Planner V2 已验证记录

> 只记录真实 Screeps API、GitHub Actions 和仓库状态验证过的事实；不记录凭证。

## 2026-07-30 shard tick 查询修正

- **状态：** `verified`
- `api.gameTime()` 未传 shard 时返回默认 shard（当前为 shard0）的 tick。
- 验收 `shard2/E42N24` 必须调用 `api.gameTime('shard2')`。
- 早期记录的 `76683168–76683303` 属于 shard0，不能作为 E42N24 的 tick 区间；Planner V2 M1 起均已改用 shard2 tick。

## 2026-07-30 Planner V2 M0–M5

- **状态：** `verified`
- **仓库：** `E:\workspace\mine\games\ScreepsWorld\screeps-bot`
- **正式部署：** 所有代码均通过 GitHub `main` 和 Actions `Deploy to Screeps` 发布，没有使用本地 API 直推。
- **进度文档：** `screeps-bot/docs/planner-v2-plan.md`

### 已完成能力

- M0：TypeScript 5 + esbuild + CI 基线，docs-only 规则。
- M1：版本化 `Memory.rooms[room].plannerV2`、确定性锚点、RoomVisual、Console 接口和纯预览。
- M2：build 模式安全施工、每房间最多 3 个 Planner 工地、Builder 只施工受管目标。
- M3：缓存 69 个道路位（20 core + 49 economic），连接 Spawn、Source Container、核心和 Controller Container。
- M4：房间级人口目标、homeRoom/home Spawn 隔离、房间级 emergency 和有限 Spawn 队列。
- M5：RCL2 5 Extension、RCL3 10 Extension + Tower、RCL4 20 Extension + Tower + Storage 的门控施工；高级结构只预留。

### 最终线上样本

- **环境：** `shard2 / E42N24`
- **tick：** `76173495`
- Controller：RCL2，progress `1265`。
- Planner：version 2、mode `build`、anchor `(37,40)`、rotation `1`、69 个道路位、无 conflict、无 lastError。
- 人口目标和实际均为：2 Miner、3 Transporter、2 Builder、1 Upgrader、0 Repairer；队列为空，emergency=false。
- 已建 Source Container：`(28,23)`。
- Planner 工地：Source Container `(21,38)`、Controller Container `(28,37)`、RCL2 Extension `(40,38)`。
- 线上与本地 bundle SHA-256：`360dad2c03d98a4660723ff930e1d397accaa266d218490b424bbb1758b3236e`，字节数 `214351`。

### 发布证据

| 里程碑 | 代码提交 | Actions run |
|---|---|---|
| M0 | `5cb1a74`、`bba9ecf` | `30538193279`、`30538717768` |
| M1 | `3858c1c`、`fa75b3c` | `30540105037`、`30540402382` |
| M2 | `3b1c8f4` | `30542122036` |
| M3 | `b79df01`、`f465bb6` | `30543803437`、`30544100222` |
| M4 | `a92da3f` | `30545773176` |
| M5 | `730da82` | `30547218310` |

## 已知限制与下一步

- RCL3/RCL4 的 Tower、Storage 和更高 Extension 数量已由脱敏 fixture 测试验证，但当前房间仍为 RCL2，不能声称已经线上实建。
- 当前房间没有已建 Road；道路计划与施工门控已上线，但真实 Road 复用要等待更高优先级经济工地释放槽位并建成。
- 基础经济施工速度仍偏慢。真实观察中 Source Container `(28,23)` 从 `4798/5000` 到建成约用了 212 tick；这证明存在施工吞吐瓶颈，但尚不能单凭该样本断定是 Builder 数量、取能、运输、路程还是任务调度中的哪一项。
- 后续优化应先采集 Builder 取能等待、有效建造 tick、运输供给、行走距离和 Source Container 溢出，再根据证据修改资源物流或人口策略。
