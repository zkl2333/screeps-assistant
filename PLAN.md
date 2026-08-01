# Screeps Assistant 执行计划

> 更新时间：2026-08-01。本文是 `screeps-assistant` 与 `screeps-bot` 的协作入口；领域细节和历史证据分别保留在两个仓库的计划文档中。

## 仓库分工

| 仓库 | 唯一职责 | 允许的线上操作 |
|---|---|---|
| `screeps-assistant` | 查询 API、WebSocket 监控、只读分析、验收记录和知识库 | 只读查询 |
| `screeps-bot` | 游戏逻辑、测试、构建、Git 提交和正式发布 | 只能经 GitHub Actions 发布 |

Bot 的总计划见 [`screeps-bot/docs/plan.md`](../screeps-bot/docs/plan.md)。本仓库不维护第二套 bot 实施细节。

## 当前状态

- 线上目标：`shard2/E42N24`，已在 RCL3 完成结构、稳定运行与自然换代验收；RCL4 就绪代码已发布，等待真实 `800 → 1300` 过渡样本。
- `screeps-bot` 已完成 Planner M0–M5、经济 E0–E5、Creep 动作 A0、交通 A1.0–A1.4、人口 P2b、资源物流 R0–R2，以及通用单房导航与物流 N0–N5。
- N0–N5 已通过 Actions、线上 bundle 逐字节核对和两个合计 303 tick 的物流/交通/CPU/Console 验收；R3 临时机会资源回收的路线、manifest 与供给隔离前置条件已满足。
- R2c 的 RCL4 Storage reserve 与施工供能已发布，仍需真实 RCL4 Storage 样本；当前优先级为 R3，远程采矿前再加固跨房 Traveler。
- `screeps-assistant` 的历史 API 事实和验收证据位于 [`agent-memory/readme.md`](./agent-memory/readme.md) 及其分拆文件。

## 当前执行队列

### 1. 搬运循环修复发布（已完成）

责任仓库：`screeps-bot`。

- bot 提交：`b5a20b7`。
- Actions：`30594872816` 成功。
- bundle：本地与线上 SHA-256 均为 `22f079f5bc7e568d026ecdd79adff2b64ca95cb94f8f93eba62525575b8a4f86`。
- 线上：两个窗口共 15 tick 未出现 Controller container 自取自送配对，核心能量链正常。

### 2. 稳定性回归（已完成）

责任仓库：两仓库协作。

- assistant：补充只读快照和 WebSocket 验收记录，区分 `api.gameTime()` 的 shard 参数，避免把默认 shard0 tick 当成 shard2 证据。
- bot：保留现有 78 项本地测试、类型检查和构建门禁；线上出现资源守恒、任务循环或 Console 异常时，暂停后续里程碑。

### 3. 资源物流 R0（已完成）

责任仓库：`screeps-bot` 实现和发布，`screeps-assistant` 只读验收。

- bot 提交 `24232c9`，Actions run `30595709605` 成功。
- 69 项测试、类型检查和构建通过；本地与线上 bundle 均为 `247251` bytes，SHA-256 均为 `cff583f98c32da235cb98b616e431777ce039c6242742cbe395a92ee0eab6bc1`。
- 6 tick 线上窗口 CPU 平均 `3.5`、峰值 `5`，Console 无消息，Controller progress 持续增长。
- `Memory.rooms.E42N24.resourceLogistics` 不存在，确认 R0 未启用新 Memory 写入；Transporter 原有远端取能和 Controller 供能路径正常。

### 4. 资源物流 R1（已完成）

- bot 提交 `a5ccb24`、`b7a242e`、`01b6dc4`；Actions run `30596913498`、`30598102239`、`30598468246` 均成功。
- 78 项测试、类型检查和构建通过；最终本地与线上 bundle 均为 `270088` bytes，SHA-256 均为 `d26d9337376f251662a14d3ad15edb09e19e6e2ba518eabf31ca2c2aad1389c5`。
- 初始验收发现 task/Traveler RoomPosition 异常并暂停；最终修复 Traveler 耗尽 path 后，30 tick 无 Console 错误，CPU 平均 `4.53`、峰值 `12`，Controller progress `10614 → 10670`。
- 连续 10 tick 均解析出 `可取` / `缺能` RoomVisual；`resourceLogistics` Memory 前后均不存在，任务与 Transporter 行为未被观察器修改。

### 5. 资源物流 R2（已完成）

- bot 提交 `dae2d0e`、`222bbf9`；Actions run `30615308971`、`30615984415` 成功。
- 86 项测试、类型检查和构建通过；本地与线上 bundle 均为 `287209` bytes，SHA-256 均为 `c77a9d043566cd3d57a4d0efd30428389920cdcf2e66d662cf22535bc09d5429`。
- tick `76188926` 捕获两项 Spawn carried delivery，预订 `100 + 58`、重复和失败为 0；tick `76189079` 任务、预订和 Creep 物流键均释放，核心 Energy 为 `550/550`。

### 6. 通用单房导航与物流 N0–N5（已完成）

- bot 功能提交 `9f86e81`，验收归档 `3371585`；Actions run `30696886561` 和 `30698182571` 成功。
- 任意可见自有单房的路线成本由地形、道路、阻挡结构与 Creep 载荷动态计算；Transporter 以一次 Pickup、多站 Delivery 的 manifest 运行。
- 最终 bundle 为 `364129` bytes，SHA-256 `e9e51c52f53a7de56801e4f39fac252626baa20159f36ad02fdb6651dc7fc0fc`；线上逐字节一致。
- 两段线上窗口合计 303 tick，物流守恒、重复与失败为 0；已捕获 `400/400 Energy`、7 站的满载任务。详细证据见 bot 的 [`generic-navigation-logistics-plan.md`](../screeps-bot/docs/generic-navigation-logistics-plan.md)。

### 7. 当前阶段：资源物流 R3

1. 为 Tombstone、Ruin 和 Dropped Resource 建立临时资源价值评分。
2. 评分复用 N 系列的真实路线成本、manifest、数量预订与 SharedSupplyGuard，考虑资源数量、距离、剩余时间、送货成本和稳定物流机会成本。
3. 临时对象消失或来不及回收时释放任务，不修改永久道路和长期 Transporter 人口。
4. 保持 R2 的 Spawn/Source 稳定链优先；人口 P1 继续等待 R5 容量接口。

## 发布门禁

- 任何正式 bot 代码必须经过：本地检查 → Git commit → GitHub `main` → Actions 成功 → 只读线上核对。
- 禁止从本仓库或本地脚本直接调用 Screeps `user/code` 发布正式 bot。
- 重生、放弃房间、写 Memory 等有副作用操作必须另行取得明确授权。
- 文档状态只有在证据齐全时才能从“待发布”改为“已完成”。

## 文档维护

- 总计划只记录排序、依赖、责任边界和当前状态。
- Planner、人口、物流、经济和 Creep/交通细节分别维护在 bot 的领域文档中。
- API 调用方式和真实线上事实维护在 `agent-memory/`，不把动态 tick 当成永久计划结论。
- 每次线上验收后同时更新 bot 总计划和 assistant 知识库，避免两个仓库出现相互矛盾的状态。
