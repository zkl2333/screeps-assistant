---
name: screeps-live-remote-diagnostics
description: 核查 Screeps 外矿、战斗、Memory 与扩张的实时状态。
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

> **Memory 结构因 Bot 而异。** 下文的 `strategy.*`、`operations.*`、`squads.*` 只是示例路径；换成你自己的 Bot 时，先确认它把外矿、扩张和小队状态存在哪里，再套用同样的核查思路。房间现场（`room --objects`）不依赖任何 Bot，对所有 Bot 通用。

## 适用场景

- 外矿不采、运输工空转、Spawn 没有补远矿单位。
- 用户报告败仗、他人 reservation、外矿防御送死或攻击建筑。
- 自动扩张行为与预期不符，或出现残留的扩张小队。
- 清理旧 Memory 键之前，确认它是否仍被当前代码读取。

不用于：通过 API 发布 Bot 代码；正式发布应走 Bot 自己的发布流程（如 CI）。

## 核查原则

1. **先实时、后推断。** `room <room> --objects`（官方 `gameRoomObjects`）是房间现场，不需要视野；Memory 只表示 Bot 的记录，可能遗留过期 creep 或旧敌情。
2. **区分四种状态。** 分别记录 controller owner/reservation、source/container 能量、己方 creep、敌方 creep/墓碑/ruin。不能因 creep 通行就认定正在采矿。
3. **时间点不能混用。** 当前无 reservation 不代表战斗发生时没有 reservation；当前无尸体不代表刚才没有败仗。
4. **CPU 用官方 WebSocket。** `user/cpu` 是实时 CPU 来源；Bot 自己写的 `Memory.stats` 只可用于热点参考。
5. **同名房间必须带 shard。** 查询命令显式写 `--shard`（下例用 `shard2`）。

## 操作流程

### 1. 读取策略和 operation

在 screeps-assistant 仓库目录用终端按路径读取，不要整份读 Memory。下面是示例路径，请换成你的 Bot 实际使用的结构：

```bash
node bin/screeps-assistant.js memory strategy.remoteHarvesting --target main --shard shard2
node bin/screeps-assistant.js memory operations.mine:<room> --target main --shard shard2
node bin/screeps-assistant.js memory strategy.expand --target main --shard shard2
node bin/screeps-assistant.js memory squads.expand --target main --shard shard2
node bin/screeps-assistant.js memory squads.expandGuard --target main --shard shard2
```

关注（示例）：

```text
strategy.remoteHarvesting.currentCount   全局外矿名额
strategy.remoteHarvesting.rooms          被选中的外矿房
operations["mine:<room>"]                该房的外矿 operation
strategy.expand.currentTarget            当前扩张目标
squads.expand / expandGuard              扩张小队
```

完成条件：明确该房是否被选中、operation 是否存在、是否有当前扩张目标。

### 2. 检查房间现场

```bash
node bin/screeps-assistant.js room <room> --target main --shard shard2            # 摘要
node bin/screeps-assistant.js room <room> --objects --target main --shard shard2  # 全部对象
node bin/screeps-assistant.js room <room> --objects --filter type=creep --fields name,username,x,y,body,store --target main --shard shard2
```

带 `user` 的对象会补上 `username`，可用 `--filter username=<玩家>` 只看某个玩家。至少检查：

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
房间在 Bot 的外矿选择列表里（示例：remoteHarvesting.rooms）
外矿 operation 存在且有路径
存在存活的外矿采集者，且 source 能量下降或 container 有新能量
存在运输单位，且能量向出生房移动
```

仅有 creep Memory 里的分配记录不足以证明 creep 存活；必须用房间对象复核。

### 4. 战斗与 reservation 复盘

对用户报告的战斗房先查现场，再读 Bot 自己记录的证据（示例）：

```text
Memory.rooms[room].enemies               敌情记录
房间情报里的 reservation / 最后扫描时间
operation 的防御账本与已退役历史
```

报告时明确区分：

```text
实时事实
发生时可见的遗留证据
代码路径推测
无法从当前快照恢复的历史
```

### 5. 清理遗留 Memory

只有满足以下全部条件才能建议删除：

1. 用 `node tools/backup/pull-code.js main <临时目录> --target main` 拉取当前线上代码；
2. 在线上 bundle 和 Bot 源码中搜索对该键的所有读取方式（例如 `room.memory[键]`、`Memory.rooms[room][键]`）；
3. 确认没有任何读取；
4. 用户明确同意写入。

删除时只删除已确认无人读取的键，保留具名的当前字段。写入后立刻读取 Memory，确认目标键已消失；随后用 `logs --errors --duration 60` 观察一个短周期，确认没有新报错。

## 常见陷阱

以下以示例结构说明，具体字段名因 Bot 而异：

- 外矿名额（如 `currentCount`）是全局值，不是某个主房保证拥有的外矿数；它可能被 CPU/bucket 策略收缩。临时改 Memory 时只改该字段并读回，不覆盖整个 `remoteHarvesting`。
- `Game.market.deal() === -6` 可能是 Credits、卖出资源或交易 energy 不足；同 tick 连续失败且 Terminal energy 不变，优先检查 Credits。
- 已在 Spawn 中的 creep 不要取消：取消孵化不返还能量。
- 扩张小队的 Memory 残留而当前目标已不存在时，Bot 可能继续补员；经授权后只清残留的小队记录，不清整个策略 Memory。

## 验证

- 每项实时结论都有 `room --objects`（`gameRoomObjects`）或官方 WebSocket 证据。
- 每次 Memory 写入都完成读回验证。
- 每次清理后 Console 无 `Error`、`TypeError`、`ReferenceError` 或 `SyntaxError`。
- Bot 改动的发布结果以它的发布流程（如 GitHub Actions）为准。
