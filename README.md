# Screeps Assistant

Screeps 外部读取、实时连接、代码备份和数据分析工具。正式服与赛季服使用同一套只读命令，但通过不同目标配置隔离。

## 安装

```bash
npm ci
```

本地 `.screeps.yml` 只保存令牌，已被 Git 忽略。目标配置：

- `main`：正式服，默认 `shard2`，代码分支 `main`
- `season`：赛季服，默认 `shardSeason`，代码分支 `default`

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

# 赛季服
npm run query -- summary --target season
npm run query -- rooms --target season
```

也可以安装为本地命令：

```bash
npm link
screeps-assistant rooms --target main --shard shard2
```

## 工具目录

```text
bin/                       正式命令入口
src/api/                   目标配置、只读 API 和摘要函数
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
