# Screeps Assistant 文档

`screeps-assistant` 维护外部读取工具，以及与具体 Bot 框架无关的 Screeps API 和游戏知识。某个具体 Bot 的设计与分析写在该 Bot 自己的仓库里。

## 文档目录

| 位置 | 内容 |
|---|---|
| [`../README.md`](../README.md) | 工具用途、安装与命令入口 |
| [`../AGENTS.md`](../AGENTS.md) | 凭证安全、能力边界和操作规则 |
| [`roadmap.md`](./roadmap.md) | 本工具之后可能做的功能（建议顺序，未承诺排期） |
| [`api/`](./api/) | 房间、Memory、Shard、WebSocket 等读取接口的用法和字段注意事项 |
| [`game/`](./game/) | 不依赖具体 Bot 实现的游戏机制、策略和实验结论 |
| 源码与脚本 | 房间信息读取、实时监控和代码备份工具 |

## 不放在本仓库

- 某个 Bot 的设计思路、领域模型、实现计划和任务排期；
- Bot 的提交记录、发布结果、线上验收和故障复盘；
- 依赖某个 Bot 的类型、目录、调用链或 Memory 结构的实现细节；
- 长期保存的房间状态快照或动态进度；
- 与工具本身无关的学习资料（视频清单、开源项目索引等）。

查询以本仓库的 CLI（`node bin/screeps-assistant.js`）和 MCP 为主入口；本仓库没封装的只读端点，再用上游 [`screeps-api` CLI](https://github.com/screepers/node-screeps-api) 兜底，对照表见 [`../AGENTS.md`](../AGENTS.md) 的「入口优先级」。

判断归属时使用一个问题：换成另一个 Bot 后，结论是否仍然成立？成立则放本仓库；依赖某个 Bot 的实现或 Memory 结构，则放该 Bot 自己的仓库。

Agent 规则只放在根目录的 `AGENTS.md`，不要另建 `.agent`、`.agents` 或 `agent-memory` 目录。
