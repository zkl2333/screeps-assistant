# Screeps Assistant 基础查询

基础查询层支持两个服务器配置：

- `main`：正式服，默认 `shard2`，代码分支 `main`
- `season`：赛季服，默认 `shardSeason`，代码分支 `default`

## 配置要求

凭据放在本地 `.screeps.yml`，不要提交。当前客户端读取方式：

```yaml
servers:
  main:
    host: screeps.com
    protocol: https
    token: "正式服令牌"
  season:
    host: screeps.com
    protocol: https
    path: /season
    token: "赛季服令牌"

configs:
  default:
    defaultShard: shard2
  season11:
    defaultShard: shardSeason
```

## 查询摘要

```bash
npm run query -- summary --target main --shard shard2
npm run query -- summary --target main --shard shardX
npm run query -- summary --target season
```

输出只包含摘要：账号、游戏时间、房间列表、分片信息和代码模块名，不输出令牌、完整 Memory 或完整代码。

## 设计边界

- 服务器和分片必须显式经过白名单校验，避免把请求发错环境。
- `main` 和 `season` 使用独立的客户端配置与代码分支。
- 这是只读查询层；不提供 Memory、Console、市场、消息或代码写入入口。
- 现有监控、简报和 cron 暂不迁移到这个入口。
