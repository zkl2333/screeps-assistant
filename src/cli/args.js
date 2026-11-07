'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {Buffer} = require('node:buffer');
const {COMMAND_TABLE, tableFlags} = require('../commands');

// 查询命令及其参数来自命令表；这里只补 console、help 和 CLI 独有的 flag。
const COMMANDS = [...COMMAND_TABLE.map(command => command.name), 'console', 'help'];
const TABLE_FLAGS = tableFlags();
const BOOLEAN_FLAGS = new Set([
  ...TABLE_FLAGS.booleans,
  'compact', 'help', // 通用
  'raw', 'envelope', // console
  'ascii', 'text', // map / logs 的纯文本输出
]);
const VALUE_FLAGS = new Set([
  ...TABLE_FLAGS.values,
  'target', 'shard', 'account', 'pick', 'filter', 'fields', // 通用
  'expr', 'file', 'timeout', 'retry', 'repeat', 'times', // console
]);
const PROBES_DIR = path.join(__dirname, '..', '..', 'probes');
const KNOWN_FLAGS = new Set([...BOOLEAN_FLAGS, ...VALUE_FLAGS]);

/** flag 可出现在任意位置；第一个位置参数是子命令，其余位置参数留给子命令。 */
function parseArgs(argv = []) {
  const args = {_: []};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }
    const rawKey = item.slice(2);
    let key = rawKey;
    let value;
    if (rawKey.includes('=')) {
      const at = rawKey.indexOf('=');
      key = rawKey.slice(0, at);
      value = rawKey.slice(at + 1);
    }
    if (!KNOWN_FLAGS.has(key)) throw new Error(`未知参数：--${key}。收到的参数：${JSON.stringify(argv)}`);
    if (BOOLEAN_FLAGS.has(key)) {
      if (rawKey.includes('=')) {
        if (value !== 'true' && value !== 'false') throw new Error(`布尔参数只支持 true/false：--${key}=${value}`);
        if (value === 'false') continue;
      }
      args[key] = true;
      continue;
    }
    if (!rawKey.includes('=')) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`参数缺少值：--${key}`);
      i += 1;
    }
    args[key] = value;
  }
  const [command = 'summary', ...rest] = args._;
  return {...args, command, _: rest};
}

function commandArgs(argv = []) {
  const parsed = parseArgs(argv);
  if (parsed.help) return {...parsed, command: 'help'};
  if (!COMMANDS.includes(parsed.command)) {
    throw new Error(`暂不支持命令："${parsed.command}"。收到的参数：${JSON.stringify(argv)}。可用命令：${COMMANDS.join(', ')}`);
  }
  return parsed;
}

function expressionSourceNames(args) {
  const sources = [];
  if (args._?.length) sources.push('位置参数');
  if (args.expr !== undefined) sources.push('--expr');
  if (args.file !== undefined) sources.push('--file');
  return sources;
}

/** 最后统一解码，避免多字节 UTF-8 字符被 Buffer 边界拆坏。 */
function decodeStdinChunks(chunks) {
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk, 'utf8'))).toString('utf8');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return decodeStdinChunks(chunks);
}

/** --file 的候选路径：先按原样（相对当前目录）；不带目录的裸名再去 probes/ 找，可省略 .js。 */
function probeCandidates(file, probesDir = PROBES_DIR) {
  const candidates = [file];
  if (!/[\\/]/.test(file)) {
    candidates.push(path.join(probesDir, file));
    if (!file.endsWith('.js')) candidates.push(path.join(probesDir, `${file}.js`));
  }
  return candidates;
}

async function readExpressionFile(file, deps = {}) {
  const readFile = deps.readFile || (target => fs.promises.readFile(target, 'utf8'));
  const candidates = probeCandidates(file, deps.probesDir);
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error(`无法读取表达式文件 ${candidate}：${error?.message || error}`);
    }
  }
  throw new Error(`表达式文件不存在：${candidates.join('、')}`);
}

/** 读取 console 表达式；三种来源互斥，文件去 BOM 和首尾空白。 */
async function readConsoleExpression(args, deps = {}) {
  const sources = expressionSourceNames(args);
  if (sources.length > 1) throw new Error(`console 表达式来源只能给一种，实际收到：${sources.join(', ')}`);
  if (!sources.length) throw new Error('console 命令需要游戏内表达式；可用位置参数、--expr、--file（文件路径或 probes/ 下的探针名）或 --file -');
  let expression;
  if (sources[0] === '位置参数') {
    expression = args._.join(' ');
  } else if (sources[0] === '--expr') {
    expression = args.expr;
  } else if (args.file === '-') {
    expression = await (deps.readStdin || readStdin)();
  } else {
    expression = await readExpressionFile(args.file, deps);
  }
  if (typeof expression !== 'string' || !expression.trim()) throw new Error('console 表达式不能为空');
  return expression.replace(/^\uFEFF/, '').trim();
}

function parseInteger(value, name, {min, max, fallback} = {}) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    const range = max === undefined ? `>= ${min}` : `${min}~${max}`;
    throw new Error(`${name} 必须是${range === '>= 1' ? '正整数' : `${range} 的整数`}`);
  }
  return parsed;
}

function helpText() {
  return `Screeps Assistant

用法：node bin/screeps-assistant.js <命令> [位置参数] [--参数]

命令：
  summary                  账号、游戏时间、房间、分片和代码模块摘要
  account                  账号概况（含 GCL 阶梯）
  rooms                    当前分片的己方房间
  room <房间>              房间现场摘要；--objects 输出全部对象（不需要视野、不占 console 额度）
  overview <房间>          官方房间统计；--interval 8|180|1440（每格分钟数），--stat 只看一项，--tick 只看覆盖该 tick 的那一格
  history <房间>           房间回放：--tick <tick> 还原那个 tick 的房间现场；再加 --to <tick> 列出这段 tick 内每个对象的变化（最多 1000 tick）
  logs                     听 bot 的 console 日志（实时流，没有历史）：--duration <秒，默认 30，最多 600>，--grep <关键词>，--errors 只看报错，--all-shards，--limit <行数，默认 200>，--text 一行一条
  memory [路径]            按路径读 Memory；省略路径读整个 Memory
  segment --id <id,...>    读 Memory Segment
  console                  执行游戏内表达式（见下）
  code [--branch <分支>]   线上代码模块列表
  market / messages        己方市场挂单 / 消息索引
  shards / world           分片信息 / 环境概况
  map                      地图分析：--room、--rooms、--around --radius 或 --all
  status                   检查目标和本地凭证配置（不联网）

通用参数：
  --target <main|ptr|season|pserver，或 .screeps.yml 里的其他服务器>
  --shard <分片>   --account <账号>   --compact
  --pick <路径>            先取结果的子路径，例如 overview 的 --pick stats
  --filter <路径=值,...>   --fields <路径,...>   作用于数组或对象集合（有 --pick 时作用于取出的部分）

房间回放（官方 room-history：任意房间都能查，不需要视野；约 19 天内、每 100 tick 一块，正在进行的这一块要等写完）：
  node bin/screeps-assistant.js history W1N1 --tick 77949750 --filter type=creep --fields name,username,x,y,hits
  node bin/screeps-assistant.js history W1N1 --tick 77949750 --to 77949780 --filter type=creep --fields tick,op,name,x,y,changes
tick N 是处理完第 N 个 tick 后的现场（bot 在 Game.time=N+1 看到的状态）；本 tick 新生成的对象晚一帧出现。

日志（logs：订阅 console 事件流，不发送任何表达式，不占 console 发送额度；查不到过去的日志）：
  node bin/screeps-assistant.js logs --errors --duration 120 --target main --shard shard2
  node bin/screeps-assistant.js logs --duration 30 --grep spawn --text --target main --shard shard2
tick 是按到达时间估算的（误差约 ±1～2 tick），只有目标分片的行才有；拿到 tick 可以接 history 看那一刻的房间。

console 表达式三选一：位置参数、--expr、--file <路径或 probes/ 下的探针名>；--file - 读 stdin
  node bin/screeps-assistant.js console --file my-probe --target main --shard shard2
  node bin/screeps-assistant.js console --expr "Game.time" --retry 2 --timeout 15000
  node bin/screeps-assistant.js console --file - --target main <<'EOF'
  Object.values(Game.creeps).length
EOF
  node bin/screeps-assistant.js console --file probe.js --envelope              # 带请求 ID、tick 和尝试次数
  node bin/screeps-assistant.js console --file probe.js --repeat 10 --times 10
  node bin/screeps-assistant.js console --file probe.js --raw --retry 0

包装模式用请求 ID 匹配回包并按同一 ID 重试；raw 模式关闭包装和重试。写入类表达式建议 --retry 0。

Windows 注意：不要通过 npm run query -- 传 console 表达式，cmd.exe 会把 >、|、&、^、% 当特殊字符；
Git Bash 会改写以 / 开头的参数。表达式尽量来自文件或 stdin。`;
}

module.exports = {
  BOOLEAN_FLAGS,
  decodeStdinChunks,
  COMMANDS,
  KNOWN_FLAGS,
  PROBES_DIR,
  VALUE_FLAGS,
  commandArgs,
  expressionSourceNames,
  helpText,
  parseArgs,
  parseInteger,
  probeCandidates,
  readConsoleExpression,
};