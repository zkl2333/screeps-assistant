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

## 2026-07-31 R2 稳定 Energy 预订

- **状态：** `verified`
- **环境：** 官方服 `shard2 / E42N24`
- **代码提交：** `screeps-bot@dae2d0e`、`screeps-bot@222bbf9`
- **Actions：** `30615308971`、`30615984415` 均成功，正式发布只经过 GitHub `main`。
- **本地门禁：** 86 项测试、TypeScript 类型检查和构建通过。
- **代码一致性：** 本地与线上 `main` bundle 均为 `287209` bytes，SHA-256 均为 `c77a9d043566cd3d57a4d0efd30428389920cdcf2e66d662cf22535bc09d5429`。

### 线上任务与释放证据

- tick `76188926` 的只读 Memory 捕获两项指向 Spawn1 的 carried delivery：`T_255` 预订 `100`、`T_330` 预订 `58`；active `2`、reserved `158`、duplicate `0`，失败计数全部为 `0`。
- 该窗口由 Miner 自然孵化产生 Spawn 缺口，没有通过 Console、Memory 写入或其他人工游戏操作制造需求。
- 后续 tick `76188981–76189049` 共 69 tick：核心 Spawn/Extension Energy 为 `550/550`，Controller progress `18421 -> 18555`，CPU 平均 `8.79`、峰值 `17`；Console 只有周期交通摘要，没有异常。
- tick `76189079` 再查 `Memory.rooms.E42N24.resourceLogistics`：tasks `[]`、active/reserved/duplicate 均为 `0`、失败计数均为 `0`；三只 Transporter 的 `logisticsTaskKey` / `logisticsTaskSignature` 均不存在，证明预订已释放。

### R2 能力边界

- 当前运行链持久化 Memory v1 任务与单 tick 统计；稳定 Energy 任务覆盖 Source Container、Storage、允许取能 Link、Spawn/Extension、Tower 和 Controller Buffer。
- 已携带 Energy 的旧任务 Transporter 会直接生成 delivery 预订；已取货任务不会被紧急需求抢占，未取货低优先级任务可以被抢占。
- 本次线上自然窗口验证了 carried delivery、Spawn 恢复和预订释放，没有出现新的稳定 Source pickup 样本。供给库存上限、多 Transporter 去重和 pickup 转换目前由 86 项本地测试中的 R2 fixture 覆盖。
- Tombstone、Ruin、Dropped Resource 评分仍属于 R3；非 Energy、运输容量和跨房物流仍属于 R4–R6。

## 2026-08-01 通用单房导航与物流 N0–N5

- **状态：** `verified`
- **环境：** 官方服 `shard2 / E42N24`；房间只作为线上样本，生产算法不读取该房间名或固定坐标。
- **最终代码提交：** `screeps-bot@9f86e81`
- **验收文档归档提交：** `screeps-bot@3371585`
- **发布：** 功能提交由 GitHub Actions `Deploy to Screeps` run `30696886561`、job `91361168638` 发布成功；归档提交因 workflow 忽略 `docs/**`，通过同一 workflow 的 `workflow_dispatch` run `30698182571`、job `91364496095` 发布成功。正式发布只经过 GitHub `main` 与 GitHub Actions，未使用 Screeps 写入 API。
- **本地门禁：** 154 项测试、TypeScript、esbuild 与 `git diff --check` 通过。
- **代码一致性：** 最终归档发布后重新只读拉取；本地与线上 `main` bundle 均为 `364129` bytes，SHA-256 均为 `e9e51c52f53a7de56801e4f39fac252626baa20159f36ad02fdb6651dc7fc0fc`，逐字节一致。

### 已验证能力

- 任意可见自有单房的导航快照从 Terrain、Road 和阻挡结构动态派生；空载、部分载荷、满载以及 MOVE/CARRY boost 使用真实 fatigue 成本，路线缓存按拓扑与 Movement Profile 失效。
- 物流按“空车到 Pickup + 载货多站 Delivery”真实路线成本分配；一次 Pickup 可以生成有序 manifest，并保持供给、需求、车辆容量和逐站预订守恒。
- Transporter 剩余寿命不足以覆盖路线成本、动作数和 5 tick 余量时，任务以 `released/retiring` 交接，不计完成或失败。
- SharedSupplyGuard 将 `reserved/pickup` 状态的 Pickup 数量作为全房稳定供给边界。Repairer、Upgrader、Builder、Harvester、Transporter fallback、Cleaner `withdrawAll` 和 Link 直传只能使用未预订 Energy；普通 intent 的同 tick 认领在任务 Memory 提前推进后仍保留到结算。
- 线上竞态证据曾显示物流对 Source Container `(21,38)` 预订 `122` 时，Repairer `X_530` 同时持有无限量 `withdraw`。该证据确认绕过入口存在，但不能事后精确证明更早 tick `76210429` 的单次 `source-empty` 就来自同一目标；最终修复没有更改或掩盖失败定义。

### 最终线上验收

- 稳定性窗口 tick `76211166–76211328`，跨度 162 tick：逐 tick 失败/重复标量和 128 个完整 Memory 快照全部为 0；CPU 平均 `5.259`、峰值 `15`，Controller progress `+1525`，核心 Energy 始终 `800/800`，Console 无异常。
- 自然换代窗口 tick `76211351–76211492`，跨度 141 tick：114 个完整 Memory 快照保持 manifest/预订守恒、duplicate、failed 和全部失败分类为 0；捕获 `T_115` 的 `400/400 Energy`、7 站、路线成本 `39`、装载率 `1.0` 的稳定 Pickup，没有三车各跑 `50 Energy`。
- 延迟观察 tick `76211500–76211535` 无失败；tick `76211536` active/reserved/demand 全部归零，证明该多站任务完成并释放干净。
- 三个完整 100-tick 交通窗合计 moves `1174`、conflicts `18`（`1.53%`）、stuck `102`（`8.69%`）、replans `163`、path CPU `48.539`，Miner stuck 为 0。单窗 stuck 曾短暂到 `14.39%`，后续 83 tick 回落到 `5.02%`、再后 27 tick 为 `3.67%`，未形成持续回归。
- Creep Memory 无 `pathCosts` 泄漏，7/7 Creep 有 Traveler profile/topology key；最终两个 Source Container 为 `1400/2000`、`1250/2000`，Controller Container 为 `1500/2000`，没有 Source 近满而 Controller Buffer 持续为空。

### 后续边界

- 当前不重铺 Road，也不实现 convoy pushing；现有交通不是持续主瓶颈。
- 下一阶段优先资源物流 R3（Tombstone、Ruin、Dropped Resource 统一回收）。跨房 Traveler 必须在远程采矿或多房物流前完成加固。
