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

## 常用只读命令

```bash
# 摘要 / 账号 / 房间
npm run query -- summary --target main --shard shard2
npm run query -- account --target main --account yachiyo
npm run query -- rooms --target season

# Memory：路径可用位置参数或 --path；省略即查根
npm run query -- memory rooms.E41N23 --target main --shard shard2
npm run query -- memory --target main --shard shard2 --path rooms.E41N23

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

- 服务器和分片必须显式经过白名单校验，避免把请求发错环境。
- `main` 和 `season` 使用独立的客户端配置与代码分支。
- 这是只读查询层；不提供 Memory、Console、市场、消息或代码写入入口。
- 现有监控、简报和 cron 暂不迁移到这个入口；`tools/briefs/` 重新适配前不要运行。
