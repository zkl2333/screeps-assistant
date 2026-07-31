# Screeps Assistant 执行计划

> 更新时间：2026-07-31。本文是 `screeps-assistant` 与 `screeps-bot` 的协作入口；领域细节和历史证据分别保留在两个仓库的计划文档中。

## 仓库分工

| 仓库 | 唯一职责 | 允许的线上操作 |
|---|---|---|
| `screeps-assistant` | 查询 API、WebSocket 监控、只读分析、验收记录和知识库 | 只读查询 |
| `screeps-bot` | 游戏逻辑、测试、构建、Git 提交和正式发布 | 只能经 GitHub Actions 发布 |

Bot 的总计划见 [`screeps-bot/docs/plan.md`](../screeps-bot/docs/plan.md)。本仓库不维护第二套 bot 实施细节。

## 当前状态

- 线上目标：`shard2/E42N24`，当前仍按 RCL2 经济链验收。
- `screeps-bot` 已完成 Planner M0–M5、经济 E0–E5、Creep 动作 A0、交通 A1.0–A1.4、人口 P0。
- 当前发现的搬运循环已在 bot 工作树修复并通过本地 `npm run check`；尚未提交、推送或线上验收，不能视为已发布。
- `screeps-assistant` 的历史 API 事实和验收证据位于 [`agent-memory/readme.md`](./agent-memory/readme.md) 及其分拆文件。

## 当前执行队列

### 1. 搬运循环修复发布

责任仓库：`screeps-bot`。

1. 检查并提交本地 Transporter 取货目标修复。
2. 推送 GitHub `main`，等待 `Deploy to Screeps` 成功。
3. 用 `userCodeGet` 或 Actions 产物核对线上 bundle。
4. 在 `shard2/E42N24` 做 15–30 tick WebSocket 验收：两只以上 Transporter 不得从同一 Controller container 取货后又送回同一目标；Spawn、Extension、Controller 和 Source Container 不得停摆。
5. 将提交 SHA、Actions run、tick 窗口和结果写回 bot 总计划及本仓库知识库。

### 2. 稳定性回归

责任仓库：两仓库协作。

- assistant：补充只读快照和 WebSocket 验收记录，区分 `api.gameTime()` 的 shard 参数，避免把默认 shard0 tick 当成 shard2 证据。
- bot：保留现有 62 项本地测试、类型检查和构建门禁；线上出现资源守恒、任务循环或 Console 异常时，暂停后续里程碑。

### 3. 下一阶段候选

只有第 1、2 项完成后才进入下一项：

1. 资源物流 R0：建立房间资源快照、供需意图和脱敏 fixture，不改变现有 Transporter 优先级。
2. 人口 P1：等待物流输出稳定的 `TransportCapacityDemand` 后再接入 Transporter 数量规划。
3. Planner M6：可视化规划编辑和玩家覆盖层，优先级低于稳定经济链。
4. 物流 R1–R6、人口 P2–P4：按 bot 总计划的依赖顺序推进，不并行扩展跨房、市场或高级建筑。

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
