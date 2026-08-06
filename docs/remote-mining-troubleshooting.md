# 外矿（Remote Mining）排查流程

> 本文档记录 `screeps-bot` 外矿系统出问题的标准排查步骤。所有查询通过本仓库的只读 CLI 完成，不修改游戏状态。

## 前置

- **默认 shard：** `shard2`
- **Memory 路径：** `Memory.remoteMining`
- **统一 CLI 入口：** `npm --silent run api -- <command> shard2`

## 排查步骤

### 1. 确认 remoteMining Memory 是否存在

```bash
npm --silent run api -- memory-get remoteMining shard2 --pretty
```

**判断：**

| 情况 | 含义 |
|------|------|
| 返回 `{ ok: 1 }` 无 data | Memory 被清空，外矿系统从未初始化或部署时覆盖 |
| 返回完整结构 | 正常，继续下一步 |

**修复：** Memory 清空无法通过 API 恢复，需等待 bot 下一 tick 自动初始化（`getRemoteMiningMemory()` 会重建空结构），然后从步骤 3 开始排查为何没有生成 operation。

### 2. 检查 operations 状态

从 Memory 中提取 `operations` 字段，每个 operation 的关键字段：

| 字段 | 含义 |
|------|------|
| `lifecycle` | 当前状态（见状态机） |
| `reason` | 进入当前状态的原因 |
| `resumeAt` | cooldown 结束 tick（仅 `cooldown` 状态） |
| `remoteRoom` | 目标房间名 |

**Lifecycle 状态机：**

```
创建时：reservationIsMine ? "operational" : "reserving"
                                              ↓
                               draining → cooldown → resurvey → operational
                                         ↓ (permanent reason)
                                      retired
```

**Lifecycle 含义：**

| lifecycle | 含义 | 预期行为 |
|-----------|------|----------|
| `reserving` | 正在预定 Controller | 派出 reserver |
| `operational` | 正常开采 | 派出 miner + hauler |
| `draining` | 召回中 | 所有 creep 返回 home |
| `cooldown` | 冷却中 | 等待 resumeAt 后 resurvey |
| `resurvey` | 重新侦察 | 派出 scout 确认房间状态 |
| `retired` | 永久退役 | 不再恢复，需人工干预或等名额释放 |

**常见 reason：**

| reason | 触发条件 | 后续 |
|--------|----------|------|
| `player-hostile` | 我方 creep 掉血或被 event log 攻击 | draining → cooldown → resurvey |
| `reserved-by-other-player` | Controller 被他人预定 | 直接 retired |
| `owned-by-other-player` | Controller 被他人占领 | 直接 retired |
| `source-keeper-risk` | 检测到 Source Keeper 且策略不允许 | draining → cooldown → resurvey |
| `controller-missing` | Controller 不存在 | retired |
| `source-missing` | Source 不存在 | retired |

### 3. 判断是「被攻击召回」还是「系统故障」

**被攻击召回的特征：**

```
lifecycle: "cooldown"
reason: "player-hostile"
resumeAt: <具体 tick>
```

→ 系统正常工作，等待 `Game.time >= resumeAt` 后自动 resurvey → operational。

**查询当前游戏 tick 判断恢复时间：**

```bash
npm --silent run api -- game-time shard2
```

如果 `resumeAt - gameTime` 差值在 500 tick 以内（约 2-3 分钟），无需干预。

### 4. 检查目标房间当前状态

```bash
npm --silent run api -- room-objects <remoteRoom> shard2 --pretty
```

确认：
- Controller 是否仍无主 / 无他人预定
- 是否有敌方 creep
- Source 是否仍存在

如果房间已被他人占领或预定，operation 会永久 retired，需要接受损失。

### 5. 检查 system 不自举的场景

如果 `operations` 为空或所有 operation 都是 `retired`，且满足以下条件：
- 主房有 storage
- storage 能量 >= `storageReserveEnergy + startupEnergyPerOperation`（默认 12500）
- RCL >= 4
- 无紧急模式

则系统应该会自动选房开矿。如果没有，检查：

**a) 是否有 scout 需求但没被满足：**

查看 `Memory.remoteMining.scouting.<homeRoom>.pending`

**b) 邻房是否全不符合条件：**

```bash
npm --silent run api -- room-objects <adjacentRoom> shard2 --pretty
```

相邻房间被占/被预定/有 Keeper → 无法开矿。

### 6. 手动恢复（紧急情况）

如果系统长时间未自举，可在 Screeps Console 手动创建 operation：

```js
const mem = Memory.remoteMining ||= {
  version: 1, policy: {}, rooms: {}, operations: {},
  remoteOwners: {}, routes: {}, scouting: {}, hostility: {}
};
const sourceId = "<target_source_id>";
mem.operations["E42N24>E42N23"] = {
  id: "E42N24>E42N23",
  homeRoom: "E42N24",
  remoteRoom: "E42N23",
  lifecycle: "reserving",
  selectedAt: Game.time,
  lastProgressAt: Game.time,
  reservation: {
    ticks: 0,
    controllerRouteKey: "E42N24>E42N23:controller:controller"
  },
  sources: {
    [sourceId]: {
      id: sourceId,
      mode: "active",
      routeKey: `E42N24>E42N23:source:${sourceId}`,
      enabledAt: Game.time
    }
  },
  activeSourceIds: [sourceId]
};
mem.remoteOwners["E42N23"] = "E42N24>E42N23";
```

> 注意：手动创建的 operation 仍需有已知 route（`Memory.remoteMining.routes` 中对应 key），否则 worker 无法移动。route 会在下次有房间视野时自动计算。

## 快速决策树

```
外矿没动静
├── Memory.remoteMining 为空？
│   └── 是 → 等待 bot 自动初始化，然后查步骤 5
│   └── 否 ↓
├── 有 operation 且 lifecycle = operational？
│   └── 是 → 检查 creep 是否在路上/死亡，查房间视野
│   └── 否 ↓
├── lifecycle = draining？
│   └── reason = player-hostile → 正常召回，等 creep 全部返回
│   └── 其他原因 → 查步骤 4
├── lifecycle = cooldown？
│   └── 等 resumeAt 到期，系统自动 resurvey
├── lifecycle = resurvey？
│   └── 确认 scout 已派出并在途中
├── lifecycle = retired？
│   └── reason = reserved-by-other-player → 永久损失
│   └── 其他 → 检查为何没有新 operation 替代（步骤 5）
└── 无 operation → 步骤 5（不自举）
```
