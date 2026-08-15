---
name: screeps-beginner-onboarding
description: 带领新手完成Screeps官方教程并核查真实游戏状态。
version: 0.1.0
author: zkl2333, Hermes Agent
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [Screeps, Beginner, Tutorial, Gameplay]
    related_skills: [screeps-game-operations, screeps-live-remote-diagnostics]
---

# Screeps 新手教程与实战入门

用于带新玩家完成官方教程，并把模拟房的概念转化为正式世界的可核查操作。以官方教程与官方文档为规则来源；不假设玩家已有特定 bot，也不执行市场、重生、放弃房间或代码发布等副作用操作，除非用户明确授权。

## 适用场景

- 用户第一次接触 Screeps，想从教程开始。
- 用户能运行代码，但不理解 creep、RCL、CPU、tick、外矿或 Safe Mode。
- 用户需要把模拟房学习结果迁移到官方 shard。

不用于：为已有复杂 bot 直接改战术或部署代码；那应使用对应 bot 仓库的工程 Skill。

## 核心心智模型

```text
每个 tick：读取开始时的世界快照
→ 代码提交 intent
→ 所有玩家脚本结束后，游戏统一结算
→ 下一 tick 才看到结果
```

因此：

- 不能在同 tick 假定 `move()` 后 `creep.pos` 已改变；
- 同一 action pipeline 的冲突以游戏规则决定，不是 JavaScript 调用顺序；
- 每个 action 的返回码必须被视为状态信号，而不是可忽略日志；
- 先构建可重复的反馈循环，再追求复杂角色或扩张。

## 推荐学习路线

### 1. 官方模拟教程

在游戏内打开：

```text
https://screeps.com/a/#!/sim/tutorial
```

按官方章节顺序完成，不跳到战斗或市场：

```text
Section 1：harvester 从 source 向 Spawn 送能量
Section 2：upgrader 为 controller 注入能量，理解 RCL
Section 3：builder 与 construction site
Section 4：Spawn extension 与 body 成本
Section 5：角色分工和循环自动化
```

官方示例代码仓库：

```text
https://github.com/screeps/tutorial-scripts
```

完成条件：玩家能解释每个角色的输入、输出、何时切换任务，以及 Spawn 为什么能持续产出替补。

### 2. 把教程改成可靠循环

从最小闭环开始：

```text
source → harvester → Spawn/extension
source → harvester → upgrader → controller
有 construction site 时 → builder
```

新手阶段优先做：

1. 每个 creep 有明确 role 和 target；
2. energy 满/空时切换状态；
3. Spawn 根据存活人数补充；
4. 每 tick 记录关键失败码；
5. 只在基本采集、补员、升级稳定后加入 builder。

不要一开始引入外矿、复杂塔防、市场、联盟或多房调度。

### 3. 理解 Spawn 与 body

- Spawn 创建 creep 时，全部 body cost 必须在 Spawn 与同房 extension 中已经可用。
- 无 extension 的 Spawn 上限是 300 energy；extension 提高同房一次可用能量。
- Creep 正常寿命为 1500 tick；生产替补应早于死亡和路程时间。
- Body 不追求“最大”，先匹配任务：采矿需要 WORK，运能需要 CARRY，移动需要 MOVE。

完成条件：新 creep 不再频繁因 `ERR_NOT_ENOUGH_ENERGY` 或 body 成本超过房间 capacity 而无法生成。

### 4. 理解 RCL 与建设顺序

```text
RCL1：Spawn、道路、container
RCL2：extension、rampart/wall
RCL3：tower
RCL4：storage
RCL6：terminal
```

优先级：

```text
稳定采集与补员
→ controller 升级
→ extension 扩容
→ 道路/container 降低搬运摩擦
→ RCL3 tower 防御
→ RCL4 storage
```

不要为了快速升级而让 Spawn、harvester 或防御断供。

### 5. 进入正式世界前的防御准备

- 起始房的 Safe Mode 是建设窗口，不是长期方案；只在真正危险时再启用。
- RCL3 后 tower、rampart/wall 与维修循环才构成常态防御。
- 先确认 controller owner、敌方 creep 和结构，再决定防守或撤退；不要把中立 Invader、Source Keeper、其他玩家混为一类。

### 6. 社区教程的阶段门槛

社区新手系列通常按：

```text
采集 → 升级 → Spawn/body → 建造 → 修路/extension
→ tower/wall → 远矿 → 多房 → container → storage → 重构
```

顺序可借鉴，但不要按视频或示例代码的进度机械跳级。每阶段先满足：

| 阶段 | 进入条件 | 尚未满足时不要做 |
| --- | --- | --- |
| 本房采集 | 每个 source 都有稳定采集和交付 | 外矿 |
| Spawn/extension | 补员不长期失败，body 不超 capacity | 复杂/大 body 编制 |
| 建造/维修 | builder 不会令 Spawn 或采集断供 | 大量非必要 site |
| tower/wall | RCL3 且 tower 有稳定能量 | 把 Safe Mode 当常规防线 |
| 远矿 | 已侦察 owner、reservation、敌情、路径、运输成本 | 看到 source 就派矿工 |
| 多房/扩张 | 本房经济、防御和 CPU 有余量 | 在本房断供时开新房 |
| storage/重构 | 物流已稳定且问题已经重复出现 | 为一次性问题引入复杂框架 |

角色文件和 prototype 适合用来识别可复用行为；不要把 Spawn 调度、跨房状态或策略判断塞进 prototype。

## CPU 与调试

### CPU

- `Game.cpu.limit` 是每 tick 正常执行上限；超限时脚本会被停止。
- `Game.cpu.bucket` 是未用 CPU 的储备，可处理短时 burst；它不是持续可用的常规预算。
- 新手 bot 先避免大范围每 tick 全图扫描、深层 PathFinder 重算和大量 console 输出。

### 调试顺序

遇到“没做事”时，按以下顺序查：

```text
1. creep 是否存活、role 与 target 是否正确
2. creep 是否有必要 body part 与 energy
3. API action 返回什么错误码
4. Spawn 是否有足够 energy / extension capacity
5. 当前 tick 还是下一 tick 才会看到 intent 结果
6. CPU 是否使部分逻辑未执行
```

正式世界的只读状态使用 `screeps-api` CLI，并明确 shard：

```bash
npx --no-install screeps-api call gameTime shard2
npx --no-install screeps-api call gameRoomObjects <room> shard2
```

## 何时进入下一阶段

只有满足全部条件才进入外矿或第二房：

```text
本房 source 长期无人断采
Spawn 能自动补 harvester / upgrader / builder
RCL 与 extension 容量稳定增长
基础防御已建立
CPU 不持续消耗 bucket
```

外矿是经济与外交问题，不是“地图上看到 source 就去挖”。先侦察 owner、reservation、敌情、路径与运输成本。

## 官方资料

- [Screeps Nooby Guide 视频与对应代码](https://github.com/Tim-Pohlmann/Screeps-Nooby-Guide)：社区新手路线，覆盖采集到 storage/重构；借鉴阶段顺序，不照搬旧式单文件架构。
- [官方模拟教程](https://screeps.com/a/#!/sim/tutorial)
- [官方教程脚本](https://github.com/screeps/tutorial-scripts)
- [Introduction](https://docs.screeps.com/introduction.html)
- [Scripting Basics](https://docs.screeps.com/scripting-basics.html)
- [Game Loop and Ticks](https://docs.screeps.com/game-loop.html)
- [Creeps and Body Parts](https://docs.screeps.com/creeps.html)
- [Control and RCL](https://docs.screeps.com/control.html)
- [CPU Limit and Bucket](https://docs.screeps.com/cpu-limit.html)
- [Defense](https://docs.screeps.com/defense.html)
- [Simultaneous Actions](https://docs.screeps.com/simultaneous-actions.html)

## 验证

- 教程五节可以在不手动逐个控制单位的情况下反复运行。
- 正式房的 Spawn 不因低能量长期空闲，且核心角色可自动续代。
- 每次异常都能定位到：状态、body/能量、返回码、tick 时序或 CPU 之一。
