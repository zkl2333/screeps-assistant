# 一次性探针

这里放临时写的 console 表达式文件。除本说明外都不入库，用完可以留着备查，也可以随手删。

## 先看内置命令够不够

能用内置命令回答的问题，就不必写探针：

| 想看什么 | 命令 |
|---|---|
| 房间现场：creep 位置/血量/疲劳、建筑存量、工地、墓碑 | `room E43N28 --objects --filter type=creep --fields name,x,y,hits,fatigue` |
| 房间摘要：控制器、建筑计数、敌方 creep | `room E43N28` |
| Memory 子树 | `memory rooms.E43N28` / `memory creeps --filter role=scout --fields role,origin` |
| 某个 tick 房间里发生了什么（通知/报错只给了 tick） | `history E43N28 --tick <tick> [--to <tick>]`（`--to` 列出这段 tick 内每个对象的变化） |
| 官方房间统计：采集、孵化、creep 损失 | `overview E43N28 --interval 180`；拿到 tick 想看那一刻：`overview E43N28 --tick 77950310`（自动选能覆盖它的最细一档） |
| bot 现在在打什么 / 有没有新报错 | `logs --errors --duration 60`（只订阅 console 事件流，不发表达式；去掉 `--errors` 看全部，`--grep <关键词>` 看某个模块） |

`room --objects` 读的是官方房间对象接口：不需要视野，也不占 console 额度（360 次/小时）。

只有要读 bot 的运行时状态（`global` 上的对象、bot 自己的方法、本 tick 的缓存）时，才需要写探针。

## 运行

在任何目录下都可以只写探针名，工具先按原样找文件，找不到再到本目录找，`.js` 可以省略：

```bash
node bin/screeps-assistant.js console --file my-probe --target main --shard shard2
```

## 写探针的注意事项

- 包装后留给用户代码的长度约 680 字节，超了会在联网前报错；
- 最后一个表达式的值就是返回值，不要写顶层 `return`（eval 下是语法错误），需要多条语句时包成 `(() => { ...; return x; })()`；
- 写入类探针（改 Memory、调用会改状态的 bot 方法）加 `--retry 0`。
