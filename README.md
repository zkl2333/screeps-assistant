# Screeps Assistant

**Screeps 外部读取、监控与分析工具**

基于 [`screeps-api`](https://github.com/screepers/node-screeps-api) 的外部工具集，用于读取房间和账号信息、监控运行状态、分析数据与备份线上代码。

## 快速开始

```bash
npm install
npm run demo:basic
```

统一只读 CLI 入口：

```bash
npm --silent run api -- room-overview E42N24 8 shard2
npm --silent run api -- room-status E42N24 shard2
npm --silent run api -- room-objects E42N24 shard2
npm --silent run api -- memory-get rooms.E42N24 shard2
npm --silent run api -- map-stats E42N24,E42N25 owner0 shard2
npm --silent run api -- market-stats energy shard2
npm --silent run api -- user-rooms USER_ID
npm --silent run api -- --help
```

CLI 已覆盖 `screeps-api` HTTP 客户端中的完整只读查询面：基础/认证、地图/房间、市场、Shard、排行榜/赛季、用户、Memory/Segment、消息读取、实验战斗数据和代码读取。完整命令与参数见 [AGENTS.md](./AGENTS.md)，`--help` 输出命令摘要。

`interval` 通常支持 `8`、`180`、`1440` 分钟；市场 `resource`、地图 `stat` 和排行榜 `mode` 必须使用官方允许值。官方房间统计输出 `stats`、`totals` 和 `statsMax`。

CLI 只开放读取方法，不支持任意 `screeps-api` 方法反射，也不暴露代码提交、Memory 写入或 Console 写入接口。

详细说明请查看 [AGENTS.md](./AGENTS.md)。工具文档入口位于 [`docs/README.md`](./docs/README.md)，API 读取注意事项位于 [`docs/screeps-api.md`](./docs/screeps-api.md)。

## 相关项目

- [screeps-bot](https://github.com/zkl2333/screeps-bot) - 游戏 AI 代码、设计、计划与验收记录仓库

## 发布纪律

`screeps-bot` **只能**通过 GitHub Actions 发布到正式环境。  
本仓库用于监控与只读分析，**禁止**作为 bot 的旁路直推通道。
