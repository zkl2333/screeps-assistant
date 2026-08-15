# Screeps Assistant

**Screeps 外部读取、监控与分析工具**

基于 [`screeps-api`](https://github.com/screepers/node-screeps-api) 的外部工具集，用于读取房间和账号信息、监控运行状态、分析数据与备份线上代码。

## 快速开始

```bash
npm install
npm run demo:basic
```

官方 CLI 入口：

```bash
npx --no-install screeps-api call gameRoomOverview E42N24 8 shard2
npx --no-install screeps-api call gameRoomStatus E42N24 shard2
npx --no-install screeps-api call gameRoomObjects E42N24 shard2
npx --no-install screeps-api call userMemoryGet rooms.E42N24 shard2
npx --no-install screeps-api call gameMarketStats energy shard2
npx --no-install screeps-api call userRooms USER_ID
npx --no-install screeps-api --help
```

> ⚠️ **查房间/历史必须指定 `shard`**：zkl2333 的活跃房间在 **shard2**（`gameRoomObjects`、`gameRoomStatus`、`gameRoomOverview`、`history`、`userMemoryGet` 等调用都要带上 `shard2` 参数，否则会落到默认分片，返回空数据或别的分片内容）。示例：`npx --no-install screeps-api call gameRoomObjects E42N24 shard2`。
>
> `history` 的 `tick` 需使用**该 shard 自己的游戏时间**（先 `npx --no-install screeps-api call gameTime shard2` 查询），API 会自动对齐到 100 的倍数；历史只保留最近若干天，tick 太旧会 404。

项目直接使用上游 `screeps-api` CLI：HTTP 查询通过 `call` 调用官方客户端方法，Memory/Segment/代码等能力见 `screeps-api --help`。实时 WebSocket 示例仍由 `demo:ws` 提供。

`interval` 通常支持 `8`、`180`、`1440` 分钟；市场 `resource`、地图 `stat` 和排行榜 `mode` 必须使用官方允许值。官方房间统计输出 `stats`、`totals` 和 `statsMax`。

官方 CLI 本身也提供写 Memory、Segment、上传代码等能力。生产环境使用时必须遵守本仓库的 Agent/操作提示词，不要调用写入命令。

详细说明请查看 [AGENTS.md](./AGENTS.md)。文档入口位于 [`docs/README.md`](./docs/README.md)，API 读取注意事项位于 [`docs/api/screeps-api.md`](./docs/api/screeps-api.md)。框架无关的市场、Terminal 与资源核查流程见 [`skills/screeps-game-operations/SKILL.md`](./skills/screeps-game-operations/SKILL.md)。

## 相关项目

- [screeps-bot](https://github.com/zkl2333/screeps-bot) - 基于 TI 的游戏 AI 二开、架构笔记与验收记录仓库

## 发布纪律

`screeps-bot` **只能**通过 GitHub Actions 发布到正式环境。  
本仓库用于监控与只读分析，**禁止**作为 bot 的旁路直推通道。
