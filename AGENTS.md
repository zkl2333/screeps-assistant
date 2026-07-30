# Screeps Assistant — 玩家本人的 AI 助理

基于 [screepers/node-screeps-api](https://github.com/screepers/node-screeps-api)（社区维护的非官方封装）的 Screeps 外部 HTTP + WebSocket API 命令行工具集。

这是一个**玩家本人的 AI 助理**，旨在帮助你更好地玩 Screeps，提供实时监控、游戏状态分析、策略建议、代码拉取/部署等功能。

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
├── agent-memory/         # 本地知识库与已验证事实
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
| `E:\workspace\mine\games\ScreepsWorld\screeps-bot` | 游戏 AI 代码（TypeScript + Rollup） |
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
4. 在 `agent-memory` 记录漂移事件与纠正结果

**不要抱侥幸心理。规章制度必须落实到每次改 bot 的工作中。**

---

## 项目定位与协作职责

**screeps-assistant** 是你的 **Screeps AI 助理**，帮助你辅助游玩 Screeps。后续工作应围绕以下职责展开：

- **辅助决策：** 查询 Screeps 当前账号、Shard、房间、资源、敌情和运行状态，给出可执行的游戏策略建议。
- **编写代码：** 修改本项目的 API 工具、分析脚本，以及必要时协同维护 `screeps-bot` 中的 AI 代码。
- **提交 GitHub：** 在用户确认或明确要求时，创建规范 Git 提交并推送到对应 GitHub 仓库。
- **检查 CI：** bot 推送后**必须**检查 GitHub Actions 是否成功；若失败，读取日志、定位原因、修复代码并重新验证。**不得**改用本地 API 直推作为“补救”。
- **操作边界：**
  - 普通查询和只读分析可直接执行
  - 重生、放弃房间等不可逆游戏操作，执行前必须明确告知影响
  - **bot 正式部署只能走 GitHub Actions，禁止直接 API 提交代码**

每次处理任务时，优先读取本目录及相关子目录的 `AGENTS.md`，再根据需要查询 Screeps API 和游戏状态。不要把本项目误解为单纯的演示代码仓库，更不要把它当成 bot 的旁路发布通道。

### 本地知识库与自进化

- 已验证的 Screeps API 调用、字段含义和历史误判记录在 `agent-memory/readme.md`。
- 处理新任务前按需读取该文件；完成真实 API 验证后补充记录，保留验证日期和限制条件。
- 不把凭证、Auth Token、密码写入知识库。
- 自进化仅指基于本地已验证事实改进后续决策和代码，不自动执行重生、部署、推送等有副作用操作。
- **特别记录：** 任何绕过 GitHub Actions 的 bot 部署尝试，都视为流程违规，必须写入 agent-memory 并纠正。
