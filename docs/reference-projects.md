# Screeps 参考项目清单

> 用途：跨设备重新拉取参考代码的统一清单。本地统一存放于 `/opt/data/screeps/参考项目/`。
> 更新时间：2026-08-03。拉取/增删项目时同步更新本文件。

## 拉取命令

```bash
mkdir -p /opt/data/screeps/参考项目 && cd /opt/data/screeps/参考项目

git clone https://github.com/bencbartlett/Overmind.git overmind
git clone https://github.com/grgisme/OvermindForged.git overmind-forged
git clone https://github.com/stoleas/overmind.git overmind-stoleas
git clone https://github.com/Mirroar/hivemind.git hivemind
git clone https://github.com/The-International-Screeps-Bot/The-International-Open-Source.git the-international
git clone https://github.com/screepers/node-screeps-api.git node-screeps-api
git clone https://github.com/bencbartlett/creep-tasks.git creep-tasks
```

## 项目清单

| 目录名 | 仓库地址 | 最后更新 | 活跃度 | 用途 |
|---|---|---|---|---|
| `overmind` | https://github.com/bencbartlett/Overmind.git | 2019-06 | 停更 | 经典 Screeps AI 架构（Empire/Colony、Overlord/Directive），看远程采矿与防御思路 |
| `overmind-forged` | https://github.com/grgisme/OvermindForged.git | 2026-04 | 活跃 | Overmind 现代化社区复兴版（TS5.5/Rollup4），看现代 API 兼容补丁 |
| `overmind-stoleas` | https://github.com/stoleas/overmind.git | 2026-07 | 少量更新 | Overmind 个人 fork，新增联盟/IFF 识别（塔与战斗目标） |
| `hivemind` | https://github.com/Mirroar/hivemind.git | 2026-01 | 活跃 | 完全自动化 AI，可作私服对手；看外矿路径安全、敌人情报缓存与过期机制 |
| `the-international` | https://github.com/The-International-Screeps-Bot/The-International-Open-Source.git | 2024-08 | 停更 | 注释友好、结构清晰；看 remoteDefender、abandonRemote 放弃计时器 |
| `node-screeps-api` | https://github.com/screepers/node-screeps-api.git | 2026-07 | 活跃 | Screeps 外部 HTTP/WebSocket API 非官方封装（本 assistant 工具链的基础） |
| `creep-tasks` | https://github.com/bencbartlett/creep-tasks.git | 2019-02 | 停更 | bot 内置使用的任务库（src/lib/creep-tasks），看任务状态机实现 |

## 备注

- `overmind`、`creep-tasks` 已停更，但代码可用（Screeps 核心 API 稳定）；看思路别照抄。
- `node-screeps-api` 是工具链依赖（本仓库 CLI 的基础），不是游戏 AI 参考。
- 外矿敌情处理对比、对 X3.1 设计的定位见 `screeps-bot` 侧的框架调研（skill `gaming/screeps-bot` 的 `references/framework-landscape.md`）。
- 查询 Screeps 官方数据（房间归属/签名/历史）时注意：**zkl2333 在 shard2**，所有 map-stats / room-history 查询必须带 `shard2`，别查错分片。
