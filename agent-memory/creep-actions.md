# Creep 同 Tick 动作与任务切换效率

> 验证日期：2026-07-30。规则来源为 Screeps 官方文档，代码行为通过本地测试、GitHub Actions 和 shard2/E42N24 定点样本验证。

## 官方 intent 规则

- 官方说明：同一 Creep 在同一 tick 可以提交多个 intent；存在依赖关系的动作按固定流水线处理，右侧动作覆盖左侧动作。
- 游戏状态在整个 tick 内不可变。因此本 tick harvest / pickup / withdraw 到的资源，不能作为本 tick 另一个动作的新输入；不能用“先取能再 build”规避状态边界。
- `move` 自 2026-05-29 起不再属于动作依赖流水线，可以与经济工作动作在同 tick 提交。
- `say` 不受流水线限制。
- 官方参考：
  - https://docs.screeps.com/simultaneous-actions.html
  - https://docs.screeps.com/api/#Creep

## 本地框架结论

- `creep-tasks` 的 `Task.run()`：在工作范围内执行 `work()`，范围外只发送 move。这是正确行为，因为同 tick 移动后的新位置不能用于本 tick 的工作范围判定。
- `workOffRoad` 任务会在范围内先发送 park move intent，再发送 build/repair/upgrade 等 work intent，已经正确利用 move + work 并行。
- `Task.finish()` 支持 `options.nextPos`，完成 one-shot action 后会调用 `moveToNextPos()`，适合 pickup/withdraw/transfer/drop 与下一段移动同 tick 提交。

## A0 已验证改动

- **提交：** `7784f5a`、`113acc7`
- **Actions：** `30564673023`、`30565432750`
- **最终 bundle：** `229878` bytes
- **SHA-256：** `0c94c2821004525a7bcc7e4b5a7716c6b6fea1c319b9081bf1b3cf2c9cf3cc92`
- 所有 creep-tasks 角色统一使用 `runAssignedTask`：idle 分配后当前 tick 立即执行，不再由 Transporter/Cleaner 固定等待一 tick。
- Builder、Upgrader、Transporter、Miner 的经济任务写入 `nextPos`，one-shot 成功后同 tick 开始下一段移动。
- Transporter 空载下游优先级：已建供能需求 → Extension 施工配送 → Controller 缓冲。
- emergency Harvester 已迁移到 creep-tasks，删除旧 `memory.work` 隔 tick状态机和 `if (target || ...)` 错误清理条件。
- 49 项测试、类型检查和构建通过。

## 定点线上证据

- tick `76176552–76176576`：Spawn `300 → 300`，Extension `1511 → 1586`，emergency=false；未出现 goTo 完成后持能量停留在未执行 drop task 的固定空档。
- tick `76176606`：空载 Transporter 的 withdraw task Memory 已包含真实 `nextPos`，分别指向 Extension 或 Controller。
- 截止 tick `76176636`：三只 Transporter 均已取到 100 Energy 并执行下游 goTo，没有停在“只分配、不执行”的中间状态。
- 10 秒 WebSocket：3 个 CPU 样本，平均约 2.67，无 Console log/result 异常。

## 使用边界

1. `nextPos` 是预移动提示，不是物流预订；下一 tick 仍应根据最新供需选择正式 task。
2. 不要盲目把所有动作都重复调用。官方流水线中存在覆盖关系，且资源/容量检查使用 tick 开始状态。
3. 当前只优化经济角色的 move + action 和任务切换；攻击、治疗、拆除等战斗组合需要单独设计和测试。
4. 小修复默认采用 15–30 tick 定点验收；只有大改、异常或争议时才使用长窗口。

## 2026-07-31 任务与 Traveler 坐标纠偏

- R1 线上验收捕获 Transporter 的 `Invalid arguments in RoomPosition constructor`。统一 `runAssignedTask` 现在会在 creep-tasks 反序列化前校验 task target、`nextPos` 和 parent 链；损坏 proto 会被清空并重新分配。
- 首轮 task 防护上线后另一只 Transporter 仍复现，证明不能把“未再看到一次”当作根因证据。最终定位为 Traveler 消费最后一个 path 字符后仍解析空串。
- Traveler 现在只接受 `1–8` 方向；耗尽或损坏 path 会删除并返回 `ERR_NO_PATH`，下一 tick 重算，不再构造 `NaN` 坐标。
- 最终提交 `01b6dc4`、Actions run `30598468246`；tick `76184542–76184571` 的 30 tick 窗口未再出现 RoomPosition 或其他 Console 错误。
