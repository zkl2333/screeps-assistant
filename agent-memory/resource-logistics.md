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

## 2026-07-31 R1 房间资源快照与只读可视化

- **状态：** `verified`
- **环境：** 官方服 `shard2 / E42N24`
- **代码提交：** `a5ccb24`（R1）、`b7a242e`（损坏 task proto 防护）、`01b6dc4`（Traveler 根因修复）
- **Actions：** `30596913498`、`30598102239`、`30598468246` 全部成功；正式发布均经 GitHub `main`。
- **本地门禁：** 78 项测试、TypeScript 类型检查和构建通过。
- **代码一致性：** 最终本地与线上 `main` bundle 均为 `270088` bytes，SHA-256 均为 `d26d9337376f251662a14d3ad15edb09e19e6e2ba518eabf31ca2c2aad1389c5`。

### 快照与视觉证据

- tick `76184132` 的只读状态包含 4 个供给节点、3 个施工需求和 3 个 Transporter；Energy 可取 `4050`、需求 `69`，物流任务、预订、重复和失效均为 `0`。节点数量随资源和工地变化是动态事实，不作为固定房间配置。
- tick `76184628–76184637` 连续 10 tick 解析 RoomVisual 命令，每 tick 都有 7–8 条绿色 `可取` 与黄色 `缺能` 标签；视觉默认开启，Console 开关只改变当前 global heap，不写 Memory。
- R1 验收前后 `Memory.rooms.E42N24` 都只有 `plannerV2`、`populationV2`、`trafficA1`，不存在 `resourceLogistics`。因此当前 R1 运行链没有持久化快照、统计或任务；R2 是否写 Memory 必须单独验收。

### 线上异常与纠偏

- 初始验收先后捕获 `T_475`、`T_650` 的 `Invalid arguments in RoomPosition constructor`，后续阶段当时暂停，没有用短窗口掩盖异常。
- `b7a242e` 增加序列化 task 坐标校验，但第二窗口仍复现，证明损坏 task 不是完整根因。
- 最终根因：Traveler 检查缓存 path 非空后消费最后一个方向，空串仍被解析为方向并产生 `NaN` 坐标。`01b6dc4` 只接受 `1–8`，耗尽/损坏 path 会删除并在下一 tick 重算。
- 最终 tick `76184542–76184571` 共 30 tick：无 Console 错误，CPU 平均 `4.53`、峰值 `12`，Controller progress `10614 → 10670`；核心 Energy 在 Builder 孵化期间为 `251–550`，经济链持续工作。

### R1 能力边界

- 已运行房间级供给、需求、Transporter、现有任务/预订和失效状态观察，并提供只读视觉及 Console 状态。
- 尚未创建或分配 `LogisticsTask`，也未改变 Transporter 取送优先级；当前 active/reserved 为 `0` 是因为 R2 尚未启用，不代表任务框架失效。
- Tombstone 回收、非 Energy 策略、运输容量、市场和跨房物流仍属于 R3–R6。
