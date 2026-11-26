# 一次性探针

这里放临时写的 console 表达式文件。除本说明外都不入库，用完可以留着备查，也可以随手删。

## 先看内置命令够不够

能用内置命令回答的问题，就不必写探针：

| 想看什么 | 命令 |
|---|---|
| 房间现场：creep 位置/血量/疲劳、建筑存量、工地、墓碑 | `room W1N1 --objects --filter type=creep --fields name,x,y,hits,fatigue` |
| 房间摘要：控制器、storage/terminal/lab/factory/nuker 详情、建筑计数、敌方 creep | `room W1N1,W2N2` |
| 帝国/分片资源与 Boost 库存盘点 | `stock --shard shard2,shard3,shardX [--boosts]` |
| Memory 子树 / 体积排行 | `memory rooms.W1N1` / `memory --stats` |
| Segment（如 Grafana 段 99，自动 JSON 解码） | `segment --id 99 --stats --shard shard2,shard3,shardX` |
| 某个 tick 房间里发生了什么（通知/报错只给了 tick） | `history W1N1 --tick <tick> [--to <tick>] [--changed hits,store] [--best-effort]` / `incident W1N1 --tick <tick>` |
| 官方房间统计：采集、孵化、creep 损失 | `overview W1N1 --interval 180`；拿到 tick 想看那一刻：`overview W1N1 --tick 77950310`（自动选能覆盖它的最细一档） |
| bot 现在在打什么 / 有没有新报错 | `logs --errors --duration 60`（只订阅 console 事件流，不发表达式；去掉 `--errors` 看全部，`--grep <关键词>` 看某个模块） |

表中的 `role`、`home` 只是示例字段名，实际取决于你的 Bot 往 Memory 里写了什么。

`room --objects` 读的是官方房间对象接口：不需要视野，也不占 console 额度（360 次/小时）。

只有要读 bot 的运行时状态（`global` 上的对象、bot 自己的方法、本 tick 的缓存）时，才需要写探针。

## 运行

在任何目录下都可以只写探针名，工具先按原样找文件，找不到再到本目录找，`.js` 可以省略：

```bash
node bin/screeps-assistant.js console --file my-probe --arg room=W1N1 --arg limit=5 --target main --shard shard2
```

## 写探针的注意事项

- 单次 `console` 超过约 680 字节时自动走安全分片（`transport=auto` 中长脚本优先纯 `global` 分片，不消耗 `POST /api/user/memory` 额度；超长脚本自动降级）；仅 `--raw` / `--repeat` 受单条 1024 字符限制；
- 支持 `--arg 名=值`（可重复，值优先按 JSON 解析）向探针注入变量，避免复制多份探针文件；
- 最后一个表达式的值就是返回值，不要写顶层 `return`（eval 下是语法错误），需要多条语句时包成 `(() => { ...; return x; })()`；
- 写入类探针（改 Memory、调用会改状态的 bot 方法）加 `--retry 0`。
