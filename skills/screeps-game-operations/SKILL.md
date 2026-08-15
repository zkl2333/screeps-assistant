---
name: screeps-game-operations
description: Use when核查Screeps市场、Terminal和资源可达性。
---

# Screeps 游戏规则与外部核查

本 Skill 用于不依赖具体 Bot 框架的市场、Terminal、资源与经济状态核查。官方规则以 [Screeps 文档](https://docs.screeps.com/) 为准；外部 API 只用于读取事实，不替代游戏规则。

## 一、先分清三类资源口径

1. **帝国总库存**：所有自有房 Storage、Terminal、Lab、Factory 等结构中的资源总和。
2. **Terminal 可达库存**：拥有可用 Terminal 的房间内，可搬进 Terminal 并参与跨房调拨或市场交易的资源。
3. **需求方可用库存**：具体 Lab、Factory、Power Spawn 等当前能实际拿到的资源。

关键判断：**账上有资源，不等于需求方拿得到。**

- 无 Terminal 房里的资源属于帝国资产，但不能立即调到其他房。
- 多个有 Terminal 的房间构成可互相发送资源的网络。
- Lab 缺料时，要看它所在 Terminal 网络的库存；不能只看帝国总库存。
- 出售时只能把当前可达、可搬入 Terminal 的库存视为可出售库存。

## 二、市场费用与成交规则

### 创建订单

买单和卖单创建时都立即收取：

```text
创建费 = price × totalAmount × 5%
```

- 创建费不是利润保证。
- 订单未成交，仍占用已支付费用；订单过期时按官方规则退还剩余部分。
- 提高订单价格会按价差和剩余数量补收 5% 费用。
- 扩充订单数量会按新增数量补收 5% 费用。

### 直接成交

`Game.market.deal` 不再向主动成交方收创建费，但会消耗执行方 Terminal 的交易能量，并占用其冷却。

- 吃别人买单卖资源：我方支付交易能量，立即获得 Credits。
- 吃别人卖单买资源：我方支付 Credits 和交易能量。
- 订单拥有者不承担这次主动成交的能量费用。

比较挂单与直接成交时，用净值而不是名义单价：

```text
挂卖单净单价 ≈ 挂单价 × 95%
直接卖出净单价 ≈ 买单价 − 交易能量 × 能量估值 / 数量
```

分批挂单只降低首次所需现金，不改变 5% 费率，也不保证成交。

## 三、硬保底资金的正确口径

如果要求账户始终保留固定 Credits，预算必须同时考虑：

```text
可用预算 = 当前余额
         − 硬保底
         − 已有未成交买单的剩余本金
         − 本 Tick 已成功操作占用的预算
```

新订单需要占用：

- 新卖单：创建费；
- 新买单：全部本金 + 创建费。

原因：买单创建时只扣 5% 费用，本金会在未来成交时扣除。只检查创建时余额，不能保证未来成交后仍高于保底。

## 四、核查顺序

目标环境必须显式使用 `shard2`；不要依赖 CLI 默认 shard。

### 1. 当前 Tick 与账户

```bash
npx --no-install screeps-api call gameTime shard2
npx --no-install screeps-api call authMe
```

账户市场余额读取 `authMe.money`。`authMe.credits` 不是当前市场余额口径，不能混用。

### 2. 自有订单与资金流水

```bash
npx --no-install screeps-api call gameMarketMyOrders shard2
npx --no-install screeps-api call userMoneyHistory
```

流水中的常见类型：

- `market.fee`：创建或调整订单费用；
- `market.buy`：购买资源、余额减少；
- `market.sell`：出售资源、余额增加。

先按 Tick 排顺序，再解释“为什么余额突然变化”。同一 Tick 可能先卖出、再挂单、再买入。

### 3. 房间实时结构与库存

```bash
npx --no-install screeps-api call gameRoomObjects E42N24 shard2
```

至少提取：

- Storage、Terminal 的 `store`；
- Lab 的 `store`、`cooldown`、`actionLog.runReaction`；
- Terminal 的冷却；
- 正在搬运资源的 Creep store。

一次快照只能说明当前状态。判断“正在搬运”应同时核对：

- 房间 Memory 中的准备字段；
- 搬运单位携带物；
- Terminal 数量变化；
- 后续市场流水。

Terminal 某资源上涨，不能单独证明它正在为市场交易备货。

### 4. 市场行情

```bash
npx --no-install screeps-api call gameMarketOrders O shard2
npx --no-install screeps-api call gameMarketStats O shard2
```

- 订单是实时挂单；历史统计是过去成交数据。
- 选择订单时同时考虑价格、剩余数量、距离和交易能量。
- 不把少量异常高价单当成稳定市场价格。

## 五、Lab 断供判据

以 `O + H → OH` 为例：

1. 反应配置是否仍是 O/H；
2. 两座原料 Lab 是否分别有 O、H；
3. 产物 Lab 是否有空位；
4. Terminal 网络是否有原料；
5. 若帝国有原料但 Terminal 网络没有，视为不可达库存；
6. `busy` 增长说明反应运行过，`waiting` 增长说明当前条件不满足。

不能仅凭“帝国库存有 H”判断 Lab 不该等待。

## 六、安全边界

- 默认只使用查询接口。
- 市场成交、创建/取消订单、Console、Memory 写入都属于副作用操作，必须获得明确授权。
- Bot 正式代码发布只能走 GitHub Actions，不通过外部 API 直推。
- 不保存 Token、完整 Memory、订单 ID 或动态余额到 Skill。

## 相关资料

- [市场官方规则](https://docs.screeps.com/market.html)
- [`docs/api/screeps-api.md`](../../docs/api/screeps-api.md)
- [`AGENTS.md`](../../AGENTS.md)
- Bot 侧经济设计 Skill：`screeps-bot/skills/screeps-bot-economy/SKILL.md`
