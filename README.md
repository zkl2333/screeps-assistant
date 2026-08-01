# Screeps Assistant

**Screeps 外部读取、监控与分析工具**

基于 [`screeps-api`](https://github.com/screepers/node-screeps-api) 的外部工具集，用于读取房间和账号信息、监控运行状态、分析数据与备份线上代码。

## 快速开始

```bash
npm install
npm run demo:basic
```

详细说明请查看 [AGENTS.md](./AGENTS.md)。工具文档入口位于 [`docs/README.md`](./docs/README.md)，API 读取注意事项位于 [`docs/screeps-api.md`](./docs/screeps-api.md)。

## 相关项目

- [screeps-bot](https://github.com/zkl2333/screeps-bot) - 游戏 AI 代码、设计、计划与验收记录仓库

## 发布纪律

`screeps-bot` **只能**通过 GitHub Actions 发布到正式环境。  
本仓库用于监控与只读分析，**禁止**作为 bot 的旁路直推通道。
