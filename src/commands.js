'use strict';

/**
 * 命令表：查询命令只在这里登记一次，CLI（bin/screeps-assistant.js）和 MCP（src/mcp/server.mjs）都从这里生成。
 *
 * - 命令名就是 CLI 子命令名，MCP 工具名统一为 `screeps_<命令名>`。
 * - 参数键用 camelCase，即 MCP 的参数名；CLI flag 是它的 kebab-case 形式（allShards → --all-shards）。
 * - run 收到的 options 已经带上 target / shard / account；CLI 传进来的数值是字符串，MCP 是数字，处理函数两种都接受。
 * - console 带请求 ID、重试和连拍，两边各自有专用实现，不在本表。
 *
 * 参数字段：type（room / string / integer / boolean）、description、
 * positional（CLI 可写成第一个位置参数）、required（必填；CLI 只强制位置参数，其余交给处理函数报错）、
 * mcpRequired（只在 MCP 里必填）、min / max（整数范围）、mcpMax（MCP 里更低的上限，阻塞类调用用）。
 */

const queries = require('./api/queries');
const logs = require('./api/logs');
const {readWorld, scanRooms} = require('./map/query');

const ROOM = {type: 'room', required: true, positional: true, description: '房间名，例如 W1N1'};

const COMMAND_TABLE = [
  {
    name: 'summary',
    description: '账号、游戏时间、己方房间、分片和代码模块一屏摘要。',
    params: {
      branch: {type: 'string', description: '代码分支覆盖，省略时用目标配置的分支'},
    },
    run: options => queries.readSummary(options),
  },
  {
    name: 'account',
    description: '账号概况，含 GCL 阶梯解析。',
    run: options => queries.getAccount(options),
  },
  {
    name: 'rooms',
    description: '当前分片的己方房间列表。',
    run: options => queries.listRooms(options),
  },
  {
    name: 'room',
    description: '房间现场摘要（控制器、建筑、己方和敌方 creep）；objects 为 true 时返回全部原样对象（带 username，不需要视野，不占 console 额度）。',
    params: {
      room: ROOM,
      objects: {type: 'boolean', description: '返回全部原样对象，而不是摘要'},
    },
    run: options => (options.objects ? queries.getRoomObjects(options) : queries.getRoom(options)),
  },
  {
    name: 'overview',
    description: '官方房间统计（采集、建造维修、孵化、升级、creep 产出与损失等），每格带估算的 tick 范围。',
    params: {
      room: ROOM,
      interval: {type: 'integer', description: '每格分钟数：8、180 或 1440，默认 8'},
      stat: {type: 'string', description: '只看这一项统计，例如 energyHarvested'},
      tick: {type: 'integer', min: 0, description: '只留覆盖该 tick 的那一格；不给 interval 时自动选能覆盖它的最细一档'},
    },
    run: options => queries.getRoomStats(options),
  },
  {
    name: 'history',
    description: '官方房间回放（任意房间可查，不需要视野，约 19 天内）：只给 tick 还原那一刻的房间现场；再给 to 列出 (tick, to] 内每个对象的变化（最多 1000 tick）。',
    params: {
      room: ROOM,
      tick: {type: 'integer', min: 0, mcpRequired: true, description: '要还原的 tick（处理完该 tick 后的现场）'},
      to: {type: 'integer', min: 0, description: '变化记录的结束 tick，必须大于 tick'},
    },
    run: options => queries.getRoomHistory(options),
  },
  {
    name: 'logs',
    description: '订阅 console 事件流，听 bot 自己打印的日志：只听不发表达式，不占 console 额度，没有历史；调用会阻塞到 duration 结束或收满 limit。',
    params: {
      duration: {type: 'integer', min: 1, max: 600, mcpMax: 60, description: '监听秒数，默认 30'},
      grep: {type: 'string', description: '只留包含该关键词的行（不区分大小写）'},
      errors: {type: 'boolean', description: '只看报错'},
      allShards: {type: 'boolean', description: '收所有分片的日志，而不只是目标分片'},
      limit: {type: 'integer', min: 1, max: 5000, description: '最多收集多少行，默认 200'},
    },
    run: (options, deps) => logs.collectLogs(options, deps),
  },
  {
    name: 'memory',
    description: '按路径读 Memory，返回解码后的值；省略路径读整个 Memory。',
    params: {
      path: {type: 'string', positional: true, mcpRequired: true, description: 'Memory 路径，例如 rooms.W1N1'},
    },
    run: options => queries.getMemory(options),
  },
  {
    name: 'segment',
    description: '读 Memory Segment。',
    params: {
      id: {type: 'string', required: true, description: 'Segment ID，多个用逗号分隔，例如 0,1'},
    },
    run: options => queries.getSegment(options),
  },
  {
    name: 'code',
    description: '线上代码模块列表。',
    params: {
      branch: {type: 'string', description: '代码分支，省略时用目标配置的分支'},
    },
    run: options => queries.getCode(options),
  },
  {
    name: 'market',
    description: '己方市场挂单。',
    run: options => queries.getMarketOrders(options),
  },
  {
    name: 'messages',
    description: '不带参数：游戏内消息未读数与消息索引；带对方用户名（或用户 id）：读该对话的完整往来。纯读，不会把消息标记为已读。',
    params: {
      respondent: {type: 'string', positional: true, description: '对话对方：用户名，或用户 id'},
    },
    run: options => (options.respondent ? queries.getMessageThread(options) : queries.getMessages(options)),
  },
  {
    name: 'shards',
    description: '目标服务器的分片信息。',
    run: options => queries.listShards(options),
  },
  {
    name: 'world',
    description: '环境概况：赛季能力、反应堆支持、分片、世界尺寸和游戏时间。',
    run: options => readWorld(options),
  },
  {
    name: 'map',
    description: '地图分析：地形、出口、房间状态与对象分类；扫描范围用 room、rooms、around（配合 radius）或 all 之一指定。',
    params: {
      room: {type: 'room', description: '扫描单个房间'},
      rooms: {type: 'string', description: '扫描多个房间，逗号分隔'},
      around: {type: 'room', description: '扫描该房间周围的房间'},
      radius: {type: 'integer', min: 1, description: 'around 的半径，默认 1'},
      all: {type: 'boolean', description: '扫描整个世界（房间多时很慢）'},
      concurrency: {type: 'integer', min: 1, description: '并发数，默认 4'},
      cacheTtl: {type: 'integer', min: 1, description: '地形缓存有效期（毫秒），省略为永久缓存'},
      noCache: {type: 'boolean', description: '不用地形缓存'},
      summaryOnly: {type: 'boolean', description: '只返回范围汇总，不返回逐房间结果'},
    },
    run: async options => {
      const scan = await scanRooms(options);
      return options.summaryOnly ? {target: scan.target, shard: scan.shard, summary: scan.summary} : scan;
    },
  },
  {
    name: 'status',
    description: '检查目标和本地凭证配置是否可用；不联网，不返回凭证内容。',
    run: options => queries.getStatus(options),
  },
];

const COMMAND_BY_NAME = Object.fromEntries(COMMAND_TABLE.map(command => [command.name, command]));

/** camelCase 参数键 → CLI flag 名：allShards → all-shards。 */
function flagName(key) {
  return key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

/** 命令表里所有参数的 CLI flag，按布尔 / 带值分开。 */
function tableFlags() {
  const booleans = new Set();
  const values = new Set();
  for (const command of COMMAND_TABLE) {
    for (const [key, param] of Object.entries(command.params || {})) {
      (param.type === 'boolean' ? booleans : values).add(flagName(key));
    }
  }
  return {booleans, values};
}

module.exports = {COMMAND_BY_NAME, COMMAND_TABLE, flagName, tableFlags};
