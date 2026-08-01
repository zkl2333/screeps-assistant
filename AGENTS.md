# Screeps Assistant — 外部读取与监控工具

基于 [screepers/node-screeps-api](https://github.com/screepers/node-screeps-api)（社区维护的非官方封装）的 Screeps 外部 HTTP + WebSocket API 命令行工具集。

这是 Screeps 的外部工具仓库，提供房间与账号信息读取、实时监控、数据分析和代码只读备份能力。bot 的设计与实现不在本仓库维护。

## 技术栈

- **Runtime:** Node.js v24
- **包管理:** npm
- **核心依赖:** `screeps-api` (v2.x, CommonJS)
- **认证方式:** Auth Token（Screeps 账户设置 → Auth Tokens）

## 项目结构

```
├── .screeps.yml          # API 配置（含 token，已 gitignore）
├── package.json
├── demo-basic.js         # 基础示例：账户信息、Memory、Shard 列表
├── demo-room.js          # 房间查询：统计数据、状态、地形
├── demo-websocket.js     # WebSocket 实时监控：CPU、Console
├── pull-code.js          # 从 Screeps 拉取代码到本地（只读）
├── deploy-github.js      # 历史脚本，禁止用于正式 bot 部署
├── docs/                 # 工具和 Screeps API 读取说明
└── screeps-backup/       # 拉取的代码备份（已 gitignore）
```

## 常用命令

```bash
# 安装依赖
npm install

# 演示脚本（只读）
npm run demo:basic            # 账户信息 + Memory 读取
npm run demo:room             # 查询房间（默认 E1N8）
npm run demo:ws               # WebSocket 实时监控 60 秒

# 代码管理（只读拉取）
npm run pull                  # 拉取 main 分支代码 → screeps-backup-main/
node pull-code.js sim ./dir   # 拉取指定分支到指定目录
```

## 配置说明

`.screeps.yml` 使用 [SS3 Unified Credentials File](https://github.com/screepers/screepers-standards/blob/master/SS3-Unified_Credentials_File.md) 格式：

```yaml
servers:
  main:
    host: screeps.com
    protocol: https
    token: "你的auth-token"
  ptr:
    host: screeps.com
    path: /ptr

configs:
  default:
    defaultShard: "shard0"    # 默认 shard
```

Token 获取：https://screeps.com → 账户设置 → Auth Tokens → 生成。

## Screeps API 要点

- **所有 HTTP 端点基址:** `https://screeps.com/api/`
- **认证:** `X-Token` + `X-Username` header（值为 token）
- **Shard 必须指定:** 官方服务器 5 个 shard（shard0~shard3 + shardX），大部分接口需要传 shard 参数
- **WebSocket:** 连接后 subscribe 频道即可接收实时推送（cpu/console/code/room:XXX/memory/XXX）
- **代码推送:** `POST /api/user/code` —— **正式 bot 禁止直接调用，必须走 GitHub Actions**
- **Memory:** 返回 gzip+base64 格式，`screeps-api` 已自动解包

## 相关仓库

| 仓库 | 说明 |
|------|------|
| `D:\workspace\个人\screeps\screeps-bot` | 游戏 AI 代码、领域设计与实现计划（TypeScript + esbuild） |
| `https://github.com/zkl2333/screeps-bot` | bot 的 GitHub 仓库，**唯一正式部署入口** |

## ⚠️ 注意事项

- 不要将 `.screeps.yml` 提交到 git（含 token）
- Screeps API 有速率限制（120 req/min 全局），`screeps-api` 内置了重试逻辑
- 密码认证已于 2018 年废弃，必须使用 Auth Token
- `screeps-bot/screeps.json` 中的旧密码已暴露在 git 历史中，建议更换

---

## 🚨 铁律：Bot 发布流程（必须遵守）

**`screeps-bot` 的正式线上代码，只能通过 GitHub Actions 发布。**

### 唯一合法发布路径

1. 在 `screeps-bot` 本地修改代码
2. 提交到 Git
3. 推送到 GitHub `main` 分支
4. 等待 GitHub Actions workflow `Deploy to Screeps` 成功
5. 用 Actions 日志 / 只读 API 核对线上是否与仓库一致

### 明确禁止

- ❌ 本地执行 `npm run push-main` / `push-*` 直接把代码推到 Screeps 正式 `main`
- ❌ 使用 `screeps-api` / `deploy-github.js` / `POST /api/user/code` 直接部署 bot
- ❌ 图方便“先线上再补仓库”或“只改线上不改仓库”
- ❌ 绕过 CI 制造仓库代码与线上代码漂移

### 允许的例外（仅限非生产）

- 本地 simulator / 私服调试：可用 `push-sim` / `push-pserver` 等，**不得**用于官方服正式 `main`
- 只读查询、监控、拉代码、分析 Memory：允许直接用 API

### 违规后果与纠偏

直接 API 部署会造成：

- 线上代码与 GitHub 仓库漂移
- CI 历史无法审计
- 后续 Agent / 协作者基于错误代码源做决策

一旦发现漂移：

1. 立刻停止继续直接部署
2. 以 GitHub `main` 为唯一真相源
3. 把缺失改动补回仓库并走 Actions 重新发布
4. 在 `screeps-bot/docs/verification/` 记录漂移事件与纠正结果

**不要抱侥幸心理。规章制度必须落实到每次改 bot 的工作中。**

---

## 项目定位与协作职责

**screeps-assistant** 只维护 Screeps 外部工具。后续工作围绕以下职责展开：

- **读取状态：** 查询账号、Shard、房间、资源、敌情、Memory、Console 和运行状态。
- **监控分析：** 提供 HTTP / WebSocket 采集、结构化输出和通用分析能力。
- **代码备份：** 从 Screeps 只读拉取代码，辅助核对线上版本。
- **工具开发：** 修改本项目的 API 客户端、查询命令和分析脚本。
- **仓库边界：** bot 设计、实现计划、源码改动、发布结果和验收记录全部进入 `screeps-bot`。
- **检查 CI：** 使用本仓库工具核对 bot 线上状态时，仍必须以 GitHub Actions 发布结果为准，不得改用本地 API 直推作为“补救”。
- **操作边界：**
  - 普通查询和只读分析可直接执行
  - 重生、放弃房间等不可逆游戏操作，执行前必须明确告知影响
  - **bot 正式部署只能走 GitHub Actions，禁止直接 API 提交代码**

每次处理任务时，优先读取本目录及相关子目录的 `AGENTS.md`，再根据需要查询 Screeps API 和游戏状态。不要把本仓库当成 bot 设计仓库或旁路发布通道。

### 工具知识维护

- 已验证的 API 调用、字段含义和读取限制记录在 `docs/screeps-api.md`。
- 这里只记录工具如何读取数据，不记录 bot 应如何设计或下一步实现什么。
- 不把凭证、Auth Token、密码或完整私有 Memory 写入文档。
- 任何绕过 GitHub Actions 的 bot 部署尝试都视为流程违规，纠偏记录写入 `screeps-bot/docs/verification/`。

### 文档归属

- 修改文档前先读 [`docs/README.md`](./docs/README.md)。
- 本仓库只维护读取工具、API / WebSocket 用法和字段限制。
- bot 的领域模型、算法设计、代码计划、发布结果和线上验收全部写入 `screeps-bot/docs/`。
- 查询结果默认是临时输出；需要长期保留时写入 bot 的对应领域或 `docs/verification/`。
- 不创建 `.agent`、`.agents`、`agent-memory` 或新的项目计划文件；根目录 `AGENTS.md` 是唯一 Agent 规则入口。
