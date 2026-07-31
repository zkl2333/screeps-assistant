# 资源物流已验证记录

## 2026-07-31 R0 领域边界

- **状态：** `verified`
- **环境：** 官方服 `shard2 / E42N24`
- **代码提交：** `screeps-bot@24232c9`
- **发布：** GitHub Actions `Deploy to Screeps` run `30595709605` 成功，未使用本地 API 直推。
- **本地门禁：** 69 项测试、TypeScript 类型检查和构建通过。
- **代码一致性：** 本地与线上 `main` bundle 均为 `247251` bytes，SHA-256 均为 `cff583f98c32da235cb98b616e431777ce039c6242742cbe395a92ee0eab6bc1`。

### 线上只读验收

- WebSocket tick `76183595–76183600` 共 6 个房间样本和 6 个 CPU 样本；CPU 平均 `3.5`、峰值 `5`，Console 无消息。
- 核心 Spawn/Extension Energy 保持 `550/550`，Controller progress 从 `9129` 增至 `9139`；Controller Container Energy 保持 `1412`，未出现异常资源波动。
- tick `76183631` 通过 `userMemoryGet('rooms.E42N24', 'shard2')` 核对：房间 Memory 只有 `plannerV2`、`populationV2`、`trafficA1`，不存在 `resourceLogistics`。这证明当前 R0 发布没有启用新 Memory 写入；不能外推为后续 R1/R2 也不会写入。
- 同 tick 的 Creep Memory 与房间对象交叉核对：`T_115`、`T_475` 从远端 Source Container `(21,38)` 取能，`T_225` 向 Controller Container `(28,37)` 送能。原有 Transporter 优先级和核心经济链保持正常。

### R0 能力边界

- 已建立 `RoomResourceSnapshot`、`SupplyIntent`、`DemandIntent`、`LogisticsTask`、任务结果、固定统计格式和 Memory v1 迁移纯逻辑。
- 已把 Dropped Energy、Ruin、混合 Container 资格和 `drop → ruin → mixed-container → structure` 顺序提取为纯规则，但没有改变线上优先级。
- 尚未启用房间快照运行链、任务预订、Tombstone、市场、跨房物流或新的持久化状态；这些能力必须按后续里程碑分别实现和验收。
