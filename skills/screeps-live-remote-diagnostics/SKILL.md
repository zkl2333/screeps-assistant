---
name: screeps-live-remote-diagnostics
description: 核查Screeps外矿、战斗、Memory与扩张实时状态。
version: 0.1.0
author: zkl2333, Hermes Agent
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Screeps, Remote-Mining, Diagnostics, Memory]
    related_skills: [screeps-game-operations]
---

# Screeps 外矿与扩张实时核查

用于通过官方 API 核查外矿、战斗、扩张和 RawMemory 状态。只读诊断默认不改游戏状态；写 Memory、Console 或市场操作必须先获得明确授权。

## 适用场景

- 外矿不采、运输工空转、Spawn 没有补远矿单位。
- 用户报告败仗、他人 reservation、外矿防御送死或攻击建筑。
- 自动扩张行为与预期不符，或出现残留扩张小队。
- 清理旧 Bot 的压缩 RoomMemory 前确认是否仍被当前代码使用。

不用于：通过 API 发布正式 bot 代码；正式发布只能走游戏仓库的 GitHub Actions。

## 核查原则

1. **先实时、后推断。** `gameRoomObjects <room> shard2` 是房间现场；Memory 只表示 bot 的记录，可能遗留过期 creep 或旧敌情。
2. **区分四种状态。** 分别记录 controller owner/reservation、source/container 能量、我方 creep、敌方 creep/墓碑/ruin。不能因 creep 通行就认定正在采矿。
3. **时间点不能混用。** 当前无 reservation 不代表战斗发生时没有 reservation；当前无尸体不代表刚才没有败仗。
4. **CPU 用官方 WebSocket。** `user/cpu` 是实时 CPU 来源；bot 的 `Memory.stats` 只可用于热点参考。
5. **同名房间必须带 shard。** 查询命令显式写 `shard2`。

## 操作流程

### 1. 读取策略和 operation

用 `terminal` 调用：

```bash
npx --no-install screeps-api call userMemoryGet "" shard2
```

提取：

```text
strategy.remoteHarvesting.currentCount
strategy.remoteHarvesting.rooms
operations["mine:<room>"]
strategy.expand.currentTarget
squads.expand / expandGuard
```

完成条件：明确该房是否被选中、operation 是否存在、是否有当前扩张目标。

### 2. 检查房间现场

```bash
npx --no-install screeps-api call gameRoomObjects <room> shard2
```

至少检查：

```text
controller：owner、reservation、剩余时间
source：energy
container：store.energy
spawn：spawning
creep：name、user、位置、body/store
墓碑与 ruin：死亡/破坏痕迹
```

完成条件：将“没有采”“没有运输”“正在战斗”拆成可核验对象。

### 3. 远矿恢复判断

远矿恢复至少需要同时成立：

```text
房间在 remoteHarvesting.rooms
mine operation 存在且有路径
存在 live harvester.remote，且 source 能量下降或 container 有新能量
存在 relay hauler，且能量向出生房移动
```

仅有 creep Memory assignment 不足以证明 creep 存活；必须用房间对象复核。

### 4. 战斗与 reservation 复盘

对用户报告的战斗房先查现场，再读：

```text
Memory.rooms[room].enemies
RoomIntel reservation / lastScan
operation defense ledger / retired history
```

报告时明确区分：

```text
实时事实
发生时可见的遗留证据
代码路径推测
无法从当前快照恢复的历史
```

### 5. 清理遗留数字 RoomMemory

只有满足以下全部条件才能建议删除：

1. 通过 `userCodeGet main` 拉取当前线上代码；
2. 在线上 bundle 和游戏仓库源码中搜索 `room.memory[数字]`、`Memory.rooms[room][数字]`；
3. 确认没有读取；
4. 用户明确同意写入。

删除时只删除纯数字键，保留具名当前字段：

```js
for (const roomName in Memory.rooms) {
  for (const key in Memory.rooms[roomName]) {
    if (/^\d+$/.test(key)) delete Memory.rooms[roomName][key];
  }
}
```

写入后立刻读取 Memory，确认没有数字键；随后订阅 Console 至少一个短周期检查异常。

## 常见陷阱

- `currentCount` 是全局远矿名额，不是某个主房保证拥有的外矿数。
- `currentCount` 可由 CPU/bucket 策略收缩；临时改 Memory 时只改该字段并读回，不覆盖整个 `remoteHarvesting`。
- `Game.market.deal() === -6` 可能是 Credits、卖出资源或交易 energy 不足；同 tick 连续失败且 Terminal energy 不变，优先检查 Credits。
- 已在 Spawn 中的 creep 不要取消：取消孵化不返还能量。
- `Memory.squads.expand` 残留而 `currentTarget` 不存在会继续补 EX；经授权后只清残留 squad，不清整个 `Memory.strategy`。

## 验证

- 每项实时结论都有 `gameRoomObjects` 或官方 WebSocket 证据。
- 每次 Memory 写入都完成读回验证。
- 每次清理后 Console 无 `Error`、`TypeError`、`ReferenceError` 或 `SyntaxError`。
- 正式 bot 改动的发布结果以 GitHub Actions 成功为准。
