# RCL2 基础经济与施工效率已验证记录

> 验证日期：2026-07-30。只记录真实 Screeps API、GitHub Actions、线上 bundle 和连续 tick 窗口验证过的事实；不记录凭证。

## 范围与环境

- **状态：** `verified`
- **环境：** `shard2 / E42N24`
- **现实等级：** RCL2
- **Bot 仓库：** `E:\workspace\mine\games\ScreepsWorld\screeps-bot`
- **权威计划：** `screeps-bot/docs/economy-efficiency-plan.md`
- **范围边界：** 只优化当前 RCL2 的 Miner、Builder、Source Container、Extension、Controller bootstrap Energy 与房内 Transporter；没有提前实现 Tower、Storage、Link、RCL3+、跨房或市场策略。
- **部署纪律：** 所有代码均 commit → push GitHub `main` → Actions `Deploy to Screeps`；只读 API 仅用于验收，没有本地直推或写 Memory。

## E0 基线

连续窗口 tick `76173706–76173786`：

- Source Container 工地 `(21,38)`：`2156 → 2356`，`2.50 progress/tick`。
- 两 Builder 只有 40/160 Builder-tick 有 build action，即 25%。
- 两个旧 Miner 均为 1 WORK，动作产出约 `3.45 Energy/tick`。
- 两 Source 在再生后仍接近满 Energy，证明根因不是 Source 枯竭。
- 结论：第一瓶颈是 Miner WORK 吞吐；第二瓶颈是 Builder 取能与旅行，不能靠盲目增加 Builder 解决。

## E1 RCL2 身体吞吐

- **代码：** `3a5d21f`
- **Actions：** `30552021996`
- **最终线上 bundle（该里程碑）：** `215289` bytes，SHA-256 `05666fe952e614d01ca5a8e4de7cb0e570109b9615d8fed2f9e54624d3136db7`
- RCL2 300 Energy 正常身体：
  - Miner：`[WORK,WORK,CARRY,MOVE]`
  - Builder：`[WORK,CARRY,CARRY,MOVE,MOVE]`
- emergency 仍降级为 `[WORK,CARRY,MOVE]`，不足 200 Energy 时等待。
- 新 Miner `M_140` 相近活跃 tick 下采集约为旧 1-WORK Miner 的 1.95 倍；两 Miner 理论动作产出由 E0 约 `3.45` 提高到约 `5.75 Energy/tick`。
- 新 Builder `Z_310`、`Z_420` 后续均通过自然换代上线，没有自动销毁旧 Creep。
- 限制：该身体切片只覆盖 RCL2 Miner/Builder；完整 P2 和更高 Energy 容量身体仍未实现。

## E2 Source Container 就近供能

- **代码：** `ea5ffcc`、`6c05738`
- **Actions：** `30555149017`、`30556034945`
- **最终线上 bundle（该里程碑）：** `220544` bytes，SHA-256 `f80a5edd64e375af1c0680427e41d0a15a2a4b70d8a573dee1dde07111c1c98e`
- Builder 对当前最高优先级 Source Container 工地：本地掉落 → 相邻 Source → 原有全房回退。
- Transporter 与 Upgrader 不再抢占该工地附近施工保留 Energy。
- 首轮只排除 Transporter 时，Upgrader 仍有 49 tick 去 pickup 施工 Energy，工地仅 `1.88 progress/tick`；修复后保留这段失败证据。
- 最终窗口 tick `76174682–76174764`：工地 `3705 → 4038`，约 `4.06 progress/tick`，较 E0 提升约 63%；两个 Builder 157/160 tick 在本地 harvest/build。
- Source Container `(21,38)` 于 tick `76175031` 完工。

## E3 Controller 缓冲防回搬

- **代码：** `f086830`
- **Actions：** `30557053280`
- **最终线上 bundle（该里程碑）：** `221727` bytes，SHA-256 `fb7205781eef9bb135c33ae0bd8f9fb4416a51e9babece8ded6f7271ff69f028`
- Spawn / Extension 全满时，Transporter 不再拾取 Controller 两格内 bootstrap 缓冲；出现核心缺能时自动允许回收。
- 修复前同一 Transporter 在单一位置 80 tick 内有 19 次 pickup / 20 次 drop；修复后三个 Transporter 合计 3 次 drop、0 次 pickup，各自投放后离开。
- Upgrader 正常消费 Controller 缓冲，Controller 和 Spawn 没有停摆。

## E4 RCL2 Extension staged delivery

- **代码：** `0130d7a`、`fc2c1b1`
- **Actions：** `30559558427`、`30560572094`
- **最终线上 bundle：** `225598` bytes，SHA-256 `df29474df1b943fd4a7904aa49a9765580ce84aafd540bf3a549a561857df2f7`
- 原始 Extension 基线 tick `76175123–76175206`：`1.87 progress/tick`，31/160 Builder-tick 有 build action，48 个 pickup task tick 往返 Controller 缓冲。
- Transporter 在 Spawn / 已建 Extension 全满后优先向当前 Planner Extension 两格内投放 Energy；缓冲目标为 Builder 总 carry capacity，并计入在途 Energy，避免同 tick 重复派送。
- Extension 缓冲对 Transporter / Upgrader 保留，Builder 优先消费。
- 玩家反馈并已修复：Builder 只有 0 Energy 才开启新取能行程；pickup/withdraw 后已有 Energy 就立即施工，不为了“吃满半仓”再跑远路。
- RCL2 Builder 聚焦 progress 最高的 Extension，优先完成一座，不在同优先级工地间分散施工。
- 最终窗口 tick `76175526–76175606`：第一座 Extension `1122 → 1550`，`5.35 progress/tick`；第二座保持 `93`，较 Extension 基线提升约 186%。
- 直接行为样本：`Z_310` tick `76175592` pickup 后持有 89 Energy，tick `76175593` 立即 build；`Z_420` tick `76175543` 获得 100 Energy，tick `76175544` 开始连续 build。
- Spawn 起止均为 300 Energy，Controller 增长 50，population emergency=false；30 秒 WebSocket 无 Console 异常，CPU 样本平均约 3.43。

## E5 Miner 稳定 Source 绑定

- **canonical code commit：** `3564f39`
- **Actions：** `30562602407`
- **最终线上 bundle：** `228716` bytes，SHA-256 `ce5bfaeebd0ad1845919e8e958ebb0579663d14d11490ad90070a3fc3520af6c`
- 为 Miner Memory 增加稳定 `sourceId`；房间级匹配保留合法唯一绑定，再按距离和稳定 ID 匹配空缺 Source。
- 旧逻辑依赖瞬时 `targetedBy`，新 Miner 会在旧 Miner transfer/drop 时抢占 Source，导致两个 Miner 横穿房间互换矿点；该行为已移除。
- 定点窗口 tick `76175936–76175960`：`M_245` 与 `M_660` 的 Source ID 和 harvest 目标保持唯一稳定，各有 23 次 harvest action；tick `76175967` 再次核对仍未变化。
- 同窗第一座 Extension `2266 → 2386`（约 5.00 progress/tick），Spawn 起止 300 Energy，emergency=false。
- 按玩家要求，小修复采用 25 样本定点验收，不再重复完整 80-tick 基准。

## 本轮最终状态

- tick `76175967`：两座 Source Container 均已建成。
- Planner 工地：Controller Container `(28,37) 41/5000`；Extension `(40,38) 2459/3000`、`(40,39) 93/3000`。
- 人口：2 Miner、3 Transporter、2 Builder、1 Upgrader、0 Repairer；Spawn 300 Energy，队列空，emergency=false。
- Bot 最终代码 commit `3564f39`，最终验收文档 commit `76dcec9`；43 项测试、类型检查和构建通过。

## 复用结论

1. 施工慢先分解为 Energy 输入、Builder 有效 build tick、取能任务和旅行，不先增加 Builder 数量。
2. `actionLog.build` 次数 × 每个 Builder WORK 对应的单 tick消耗，可用来交叉核对 Construction Site progress 增量。
3. 对远端工地，运输到工地附近比 Builder 往返仓储更有效；缓冲必须同时考虑库存与在途 Energy。
4. 临时掉落保留必须覆盖所有竞争消费者，不能只排除 Transporter；本次 Upgrader 抢占就是首轮失败原因。
5. 只要 Builder 已有 Energy，应优先完成施工；“半仓阈值”会把小额 pickup 变成长途补仓。
6. 多个同优先级经济建筑应优先完成 progress 最高者，以尽早获得实际容量收益。
7. 固定岗位 Miner 必须持久绑定 Source；不能用瞬时 `targetedBy` 作为长期岗位分配。

## 已知后续限制

- RCL2 能量容量随 Extension 建成会从 300 逐步上升；当前身体规划仍使用已验证的 300 Energy 切片，没有为 350–550 Energy 单独优化。
- 完整物流 R2 数量级预订、长期 Memory 任务、道路建成后的身体比例和 RCL3+ 策略仍未实现。
- 当前结论不能直接外推到 Tower、Storage、多房间或远程采矿。

## 2026-07-31 Controller Container 自取自送纠偏

- **状态：** `verified`
- **环境：** `shard2 / E42N24`，RCL2
- **问题：** Controller Container 建成后，Transporter 的通用取货和送货选择可能同时返回同一 Container，导致从该目标取能后再送回原处。
- **修复：** Transporter 取货筛选排除当前送货目标；没有其他建筑需求而只剩 Controller 兜底时，也排除 Controller 缓冲本身，同时保留远端 Source Container 到 Controller 的合法路线。
- **代码：** `screeps-bot` 提交 `b5a20b7`；Actions run `30594872816` 成功。
- **bundle：** 本地与线上均为 `245817` bytes，SHA-256 `22f079f5bc7e568d026ecdd79adff2b64ca95cb94f8f93eba62525575b8a4f86`。
- **线上证据：** WebSocket 在 tick `76183323–76183330`、`76183340–76183346` 共采样 15 tick，没有发现同一 Transporter 从 Controller Container 取货后又送回的配对；tick `76183352` 的任务快照显示一只 Transporter 从远端向 Controller Container 送货、一只前往 Source Container 取货、Controller 附近空载 Transporter 保持 idle。
- **限制：** HTTP `room-objects` 快照可能与 `gameTime` 非原子对应；逐 tick 行为判断优先使用 WebSocket，并用带 `shard2` 参数的 `gameTime` 或事件内 `gameTime` 记录 tick。
