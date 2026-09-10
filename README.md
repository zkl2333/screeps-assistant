# Screeps Assistant

Screeps 外部读取、实时连接、代码备份和数据分析工具。正式服与赛季服使用同一套只读命令，但通过不同目标配置隔离。

## 安装

```bash
npm ci
```

本地 `.screeps.yml` 只保存令牌，已被 Git 忽略。目标配置：

- `main`：正式服，默认 `shard2`，代码分支 `main`
- `season`：赛季服，默认 `shardSeason`，代码分支 `default`

## 多账号

工具支持多个 Screeps 账号，账号嵌套在所属服务器之下。在 `.screeps.yml` 的 `servers` 下，每个服务器块用自身 `token` 作默认账号，其它账号挂在 `accounts` 子表里：

```yaml
servers:
  main:
    url: https://screeps.com/
    token: "默认账号token"        # 不带 --account 时使用
    accounts:
      yachiyo:                  # 用 --account yachiyo 选择
        token: "yachiyo的token"
```

所有命令加 `--account <账号名>` 即切换到该账号；省略则用该服务器的默认账号（行为与多账号之前一致）：

```bash
npm run query -- account --target main                        # 默认账号
npm run query -- account --target main --account yachiyo      # Yachiyo
npm run query -- rooms --target main --shard shard2 --account yachiyo
```

## 只读命令

```bash
# 账号
npm run query -- account --target main --shard shard2

# 分片和房间
npm run query -- shards --target main --shard shard2
npm run query -- rooms --target main --shard shardX

# 房间现场摘要
npm run query -- room --target main --shard shard2 --room E41N23

# Memory
npm run query -- memory --target main --shard shard2 --path rooms.E41N23

# 代码模块摘要
npm run query -- code --target main --branch main

# 市场挂单
npm run query -- market --target main --shard shard2

# 消息索引
npm run query -- messages --target main

# 历史统计
npm run query -- history --target main --shard shard2 --room E41N23 --stat creepsLost --interval 8

# 环境概况（赛季能力、反应堆支持、世界尺寸）
npm run query -- world --target season

# 地图分析：单房间、范围扫描、ASCII 地形图、范围汇总
npm run query -- map --target season --room W2N39
npm run query -- map --target season --around E5S5 --radius 2
npm run query -- map --target main --shard shard2 --room E41N23 --ascii
npm run query -- map --target season --around E5S5 --radius 3 --summary-only

# 赛季服
npm run query -- summary --target season
npm run query -- rooms --target season
```

`map` 命令说明：

- 范围四选一：`--room` 单房间、`--rooms` 逗号分隔列表、`--around` 中心房间加 `--radius`（默认 1）、`--all` 整个分片（请求很多，慎用）；
- `--concurrency` 控制并发请求数（默认 4）；地形永不变化，永久缓存在系统临时目录（`--no-cache` 可关闭），房间状态和对象每次实时查询；
- 默认输出逐房间 JSON（地形统计、能源矿、矿物、赛季资源、反应堆、守护者巢穴、入侵核心）；`--summary-only` 只输出范围汇总；`--ascii` 打印 50×50 文字地形图。

也可以安装为本地命令：

```bash
npm link
screeps-assistant rooms --target main --shard shard2
```

## 工具目录

```text
bin/                       正式命令入口
src/api/                   目标配置、只读 API 和摘要函数
src/map/                   跨环境地图分析（纯函数）和联网扫描
tools/backup/              线上代码只读备份
tools/live/                WebSocket 和 CPU 采样
tools/analysis/            房间、历史数据分析
tools/briefs/              旧简报工具，重新适配前不运行
tests/                     本地测试
docs/                      API 和使用文档
skills/                    Screeps 专用知识
```

## 安全边界

本项目默认只做读取：

- 不写线上 Memory 或 Segment；
- 不执行线上 Console；
- 不上传代码；
- 不买卖市场资源；
- 不发送消息或标记已读；
- 不创建建筑、旗帜或 Intent；
- 不执行重生、放弃房间等游戏操作。

正式 Bot 代码只能通过 GitHub Actions 发布，不能从本项目旁路上传。

## 验证

```bash
npm test
git diff --check
```

计划任务暂时全部暂停。新的监控和简报应在基础查询入口稳定后重新设计，不继续兼容旧脚本。
