# Screeps Assistant 文档

`screeps-assistant` 同时维护外部读取工具和与具体 Bot 框架无关的 Screeps 知识。TI 或当前二开实现的设计与分析统一放在 `screeps-bot/handbook/`。

## 文档目录

| 位置 | 内容 |
|---|---|
| [`../README.md`](../README.md) | 工具用途、安装与命令入口 |
| [`../AGENTS.md`](../AGENTS.md) | 凭证安全、只读边界和操作规则 |
| [`api/`](./api/) | 房间、Memory、Shard、WebSocket 等读取接口的用法和字段注意事项 |
| [`game/`](./game/) | 不依赖 TI 或其他 Bot 实现的游戏机制、策略和实验结论 |
| [`resources/`](./resources/) | 视频、文章和其他学习资料 |
| [`references/`](./references/) | 开源 Bot 与工具项目索引 |
| 源码与脚本 | 房间信息读取、监控、分析和代码备份工具 |

## 不放在本仓库

- bot 的设计思路、领域模型、实现计划和任务排期；
- bot 的提交记录、发布结果、线上验收和故障复盘；
- TI 的 Planner、人口、交通、经济或物流实现细节；
- 长期保存的房间状态快照或动态进度。

查询命令直接使用上游 [`screeps-api` CLI](https://github.com/screepers/node-screeps-api)。本仓库不再维护重复的 HTTP CLI。Bot 设计、TI 架构和验收内容统一放在 `screeps-bot/handbook/`；`screeps-bot/docs/` 只存放 Compodoc 生成结果。

判断归属时使用一个问题：换成另一个 Bot 后，结论是否仍然成立？成立则放本仓库；依赖 TI 类型、目录、调用链或 Memory 结构则放 `screeps-bot/handbook/`。

仓库中只保留根目录的标准 `AGENTS.md`。不要再创建 `.agent`、`.agents` 或 `agent-memory` 目录。
