# Screeps Assistant

**玩家本人的 Screeps AI 助理**

基于 [`screeps-api`](https://github.com/screepers/node-screeps-api) 的外部 API 工具集，帮助你实时监控、分析游戏状态、辅助决策。

## 快速开始

```bash
npm install
npm run demo:basic
```

详细说明请查看 [AGENTS.md](./AGENTS.md)。跨仓库执行顺序位于 [`PLAN.md`](./PLAN.md)，已验证的游戏事实与历史纠偏位于 [`agent-memory/`](./agent-memory/readme.md)。

## 相关项目

- [screeps-bot](https://github.com/zkl2333/screeps-bot) - 游戏 AI 代码仓库

## 发布纪律

`screeps-bot` **只能**通过 GitHub Actions 发布到正式环境。  
本仓库用于监控与只读分析，**禁止**作为 bot 的旁路直推通道。
