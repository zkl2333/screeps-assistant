# Screeps Assistant 文档

`screeps-assistant` 是外部读取工具仓库，不是 bot 的设计或项目管理仓库。

## 本仓库只放

| 位置 | 内容 |
|---|---|
| [`../README.md`](../README.md) | 工具用途、安装与命令入口 |
| [`../AGENTS.md`](../AGENTS.md) | 凭证安全、只读边界和操作规则 |
| [`screeps-api.md`](./screeps-api.md) | 房间、Memory、Shard、WebSocket 等读取接口的用法和字段注意事项 |
| 源码与脚本 | 房间信息读取、监控、分析和代码备份工具 |

## 不放在本仓库

- bot 的设计思路、领域模型、实现计划和任务排期；
- bot 的提交记录、发布结果、线上验收和故障复盘；
- Planner、人口、交通、经济或物流的领域知识库；
- 长期保存的房间状态快照或动态进度。

以上内容统一放在 [`screeps-bot/docs/`](https://github.com/zkl2333/screeps-bot/tree/main/docs)。本仓库工具采集到的数据如果用于验证 bot，应把结论写入 bot 的 `docs/verification/`；临时查询结果不提交。

仓库中只保留根目录的标准 `AGENTS.md`。不要再创建 `.agent`、`.agents` 或 `agent-memory` 目录。
