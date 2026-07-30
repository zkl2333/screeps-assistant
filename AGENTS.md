# Screeps Auto — 外部 API 工具集

基于 [screepers/node-screeps-api](https://github.com/screepers/node-screeps-api)（社区维护的非官方封装）的 Screeps 外部 HTTP + WebSocket API 命令行工具集。

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
├── pull-code.js          # 从 Screeps 拉取代码到本地
├── deploy-github.js      # 从 GitHub 仓库部署代码到 Screeps
└── screeps-backup/       # 拉取的代码备份（已 gitignore）
```

## 常用命令

```bash
# 安装依赖
npm install

# 演示脚本
npm run demo:basic            # 账户信息 + Memory 读取
npm run demo:room             # 查询房间（默认 E1N8）
npm run demo:ws               # WebSocket 实时监控 60 秒

# 代码管理
npm run pull                  # 拉取 main 分支代码 → screeps-backup-main/
node pull-code.js sim ./dir   # 拉取指定分支到指定目录
node deploy-github.js main owner/repo default  # GitHub → Screeps
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
- **代码推送:** `POST /api/user/code`，`{ branch, modules: { "main.js": "...", ... } }`
- **Memory:** 返回 gzip+base64 格式，`screeps-api` 已自动解包

## 相关仓库

| 仓库 | 说明 |
|------|------|
| `E:\workspace\mine\games\my-screeps-bot` | 游戏 AI 代码（TypeScript + Rollup），推送目标 |
| `zkl2333/my-screeps-bot` | GitHub 远程，配置了 Actions 自动部署 |

## ⚠️ 注意事项

- 不要将 `.screeps.yml` 提交到 git（含 token）
- Screeps API 有速率限制（120 req/min 全局），`screeps-api` 内置了重试逻辑
- 密码认证已于 2018 年废弃，必须使用 Auth Token
- `my-screeps-bot/screeps.json` 中的旧密码已暴露在 git 历史中，建议更换
