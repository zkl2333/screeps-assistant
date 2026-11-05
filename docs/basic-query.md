# Screeps Assistant 基础查询

> 完整命令与多账号示例以根目录 [`README.md`](../README.md) 为准；本页只保留基础查询层的配置与边界摘要。

基础查询层内置四个服务器目标：

- `main`：正式服，默认 `shard2`，代码分支 `main`
- `ptr`：PTR，默认 `shard2`（只有 shard0～shard3），代码分支 `main`；经常 502，连得上时可用
- `season`：赛季服，默认 `shardSeason`，代码分支 `default`
- `pserver`：私服，默认 `shard0`，代码分支 `default`

服务器块里可选的 `shards` / `defaultShard` / `codeBranch` 会覆盖内置默认值；`.screeps.yml` 里其他服务器块也能直接当 `--target` 用。

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
  ptr:
    url: https://screeps.com/ptr/
    token: "默认账号token"        # PTR 与正式服共用 token
  season:
    url: https://screeps.com/season/
    token: "赛季服令牌"
```

也兼容 `host` / `protocol` / `path` 写法（由 `screeps-api` 归一化为 `url`）。

## 常用命令

```bash
# 摘要 / 账号 / 房间
node bin/screeps-assistant.js summary --target main --shard shard2
node bin/screeps-assistant.js account --target main --account yachiyo
node bin/screeps-assistant.js rooms --target season

# 房间：摘要；--objects 输出全部对象（不需要视野）
node bin/screeps-assistant.js room E43N28 --target main --shard shard2
node bin/screeps-assistant.js room E43N28 --objects --filter type=tower --fields _id,store.energy --target main --shard shard2

# 官方房间统计
node bin/screeps-assistant.js overview E43N28 --interval 180 --target main --shard shard2

# Memory：路径可用位置参数或 --path；省略即查根
node bin/screeps-assistant.js memory rooms.E43N28 --target main --shard shard2
node bin/screeps-assistant.js memory --target main --shard shard2 --path rooms.E43N28

# 游戏内 Console：表达式的最后一个值就是返回值
node bin/screeps-assistant.js console --expr "Game.gcl" --target main
node bin/screeps-assistant.js console --file my-probe --target main --shard shard2   # probes/ 下的探针

# 环境概况与地图分析
node bin/screeps-assistant.js world --target season
node bin/screeps-assistant.js map --target season --around E5S5 --radius 2
node bin/screeps-assistant.js map --target main --shard shard2 --room E41N23 --ascii
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

- **环境隔离**：只连 `.screeps.yml` 里配置的服务器，分片按目标的分片列表校验，避免把请求发错环境；各目标使用独立的服务器块与代码分支。
- **查询只读**：所有查询命令只调用读取 API，不产生游戏副作用。
- **console 透传**：`console` 执行用户显式给出的表达式并返回输出，能力等同官方游戏内控制台；写入与否由表达式决定，工具不代写、不审查。默认按同一请求 ID 重试 2 次，游戏内按 ID 去重；写入类表达式建议 `--retry 0`。
- **无工具级写入**：不提供代码上传、市场交易、消息发送、建筑/旗帜/Intent 创建、重生或放弃房间的命令；bot 代码发布只走 `screeps-bot` 的 GitHub Actions。
