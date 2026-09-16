# Screeps Assistant 基础查询

> 完整命令与多账号示例以根目录 [`README.md`](../README.md) 为准；本页只保留基础查询层的配置与边界摘要。

基础查询层支持两个服务器目标：

- `main`：正式服，默认 `shard2`，代码分支 `main`
- `season`：赛季服，默认 `shardSeason`，代码分支 `default`

## 配置要求

凭据放在本地 `.screeps.yml`，不要提交。服务器块自身的 `token` 是默认账号；其它账号挂在 `accounts` 下，用 `--account` 选择：

```yaml
servers:
  main:
    url: https://screeps.com/
    token: "默认账号token"        # 不带 --account 时使用
    accounts:
      yachiyo:                  # --account yachiyo
        token: "yachiyo的token"
  season:
    url: https://screeps.com/season/
    token: "赛季服令牌"
```

也兼容 `host` / `protocol` / `path` 写法（由 `screeps-api` 归一化为 `url`）。

## 常用命令

```bash
# 摘要 / 账号 / 房间
npm run query -- summary --target main --shard shard2
npm run query -- account --target main --account yachiyo
npm run query -- rooms --target season

# Memory：路径可用位置参数或 --path；省略即查根
npm run query -- memory rooms.E41N23 --target main --shard shard2
npm run query -- memory --target main --shard shard2 --path rooms.E41N23

# 游戏内 Console：执行表达式并取回输出（表达式需产生返回值或 console.log）
npm run query -- console "JSON.stringify(Game.gcl)" --target main
npm run query -- console Game.time --target season --timeout 20000

# 环境概况与地图分析
npm run query -- world --target season
npm run query -- map --target season --around E5S5 --radius 2
npm run query -- map --target main --shard shard2 --room E41N23 --ascii
```

`summary` 输出只包含摘要：账号、游戏时间、房间列表、分片信息和代码模块名，不输出令牌、完整 Memory 或完整代码。

代码只读备份与实时采样也支持同一套目标/账号参数：

```bash
node tools/backup/pull-code.js main ./dist --target main --account yachiyo
node tools/live/sample-cpu.js 3 20000 --target main --account yachiyo
node tools/live/websocket.js --target main --account yachiyo
```

## 设计边界

完整分层定义见根目录 README 的"安全边界"；本页摘要：

- **环境隔离**：服务器与分片必须经过白名单校验，避免把请求发错环境；`main` 和 `season` 使用独立的客户端配置与代码分支。
- **查询只读**：所有查询命令只调用读取 API，不产生游戏副作用。
- **console 透传**：`console` 执行用户显式给出的表达式并原样返回输出，能力等同官方游戏内控制台；写入与否由表达式决定，工具不代写、不审查、不自动重试。
- **无工具级写入**：不提供代码上传、市场交易、消息发送、建筑/旗帜/Intent 创建、重生或放弃房间的命令；bot 代码发布只走 `screeps-bot` 的 GitHub Actions。
- 现有监控、简报和 cron 暂不迁移到这个入口；`tools/briefs/` 重新适配前不要运行。
