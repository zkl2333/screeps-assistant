'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {Buffer} = require('node:buffer');
const {COMMAND_TABLE, flagName, tableFlags} = require('../commands');

// 查询命令及其参数来自命令表；这里只补 console、tools、inbox、help 和 CLI 独有的 flag。
const COMMANDS = [...COMMAND_TABLE.map(command => command.name), 'console', 'tools', 'inbox', 'help'];
const TABLE_FLAGS = tableFlags();
const BOOLEAN_FLAGS = new Set([
  ...TABLE_FLAGS.booleans,
  'compact', 'help', 'all-shards', // 通用
  'raw', 'relay', 'envelope', // console / segment
  'ascii', 'text', // map / logs 的纯文本输出
  'stream', // watch 流式输出
]);
const VALUE_FLAGS = new Set([
  ...TABLE_FLAGS.values,
  'target', 'shard', 'account', 'pick', 'filter', 'fields', 'limit', // 通用
  'expr', 'file', 'arg', 'timeout', 'retry', 'repeat', 'times', 'transport', // console / tools / inbox
  'id', // inbox
  'exec', // watch 事件回调命令
]);
/** 常见直觉别名，自动归一化到正式 flag，减少参数记错导致的无谓失败。 */
const FLAG_ALIASES = Object.freeze({
  server: 'target',
  eval: 'expr',
  expression: 'expr',
});
const REPEATABLE_FLAGS = new Set(['arg']);
const PROBES_DIR = path.join(__dirname, '..', '..', 'probes');
const KNOWN_FLAGS = new Set([...BOOLEAN_FLAGS, ...VALUE_FLAGS]);

function editDistance(a, b) {
  const dp = Array.from({length: a.length + 1}, (_, i) => i);
  for (let j = 1; j <= b.length; j += 1) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[a.length];
}

function suggestFlag(unknown) {
  let best = null;
  let bestDist = 3;
  for (const flag of KNOWN_FLAGS) {
    if (flag.startsWith(unknown) || unknown.startsWith(flag)) return flag;
    const dist = editDistance(unknown, flag);
    if (dist < bestDist) {
      bestDist = dist;
      best = flag;
    }
  }
  return best;
}

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
    const canonical = FLAG_ALIASES[key] || key;
    if (!KNOWN_FLAGS.has(canonical)) {
      const hint = suggestFlag(key);
      throw new Error(`未知参数：--${key}。收到的参数：${JSON.stringify(argv)}${hint ? `（你是不是想用 --${hint}？）` : ''}`);
    }
    key = canonical;
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
    if (REPEATABLE_FLAGS.has(key)) {
      if (!Array.isArray(args[key])) args[key] = [];
      args[key].push(value);
    } else {
      args[key] = value;
    }
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

const POSITIONAL_PLACEHOLDER = {
  room: '<房间>',
  path: '[路径]',
  username: '<用户名>',
  respondent: '[用户名|id]',
};

const COMMAND_EXTRA_HELP = {
  logs: '听 bot 的 console 日志（实时流，没有历史）：--duration <秒，默认 30，最多 600，支持 10s/2m>，--grep <关键词>，--errors 只看报错，--all-shards，--limit <行数，默认 200>，--text 一行一条',
};

function formatCommandLine(command) {
  const params = Object.entries(command.params || {});
  const pos = params.find(([, p]) => p.positional);
  const sig = pos
    ? `${command.name} ${POSITIONAL_PLACEHOLDER[pos[0]] || (pos[1].required ? `<${pos[0]}>` : `[${pos[0]}]`)}${command.name === 'segment' ? '' : ''}`
    : command.name;
  const label = sig.padEnd(24, ' ');
  if (COMMAND_EXTRA_HELP[command.name]) return `  ${label} ${COMMAND_EXTRA_HELP[command.name]}`;
  const flags = params
    .filter(([k, p]) => !p.positional || k === 'room')
    .filter(([, p]) => !p.positional)
    .map(([k]) => `--${flagName(k)}`);
  const flagSuffix = flags.length ? `（${flags.join(' ')}）` : '';
  return `  ${label} ${command.description}${flagSuffix}`;
}

function helpText() {
  const commandLines = [
    ...COMMAND_TABLE.map(formatCommandLine),
    '  console                  执行游戏内表达式（支持 --arg 名=值、超长自动分片/中转，见下）',
    '  tools                    临时工具空间：inject | status | clear',
    '  inbox                    临时收件箱：push | list | flush',
  ].join('\n');

  return `Screeps Assistant

用法：node bin/screeps-assistant.js <命令> [位置参数] [--参数]

命令（与 MCP 工具 screeps_<命令> 自动同源）：
${commandLines}

通用参数：
  --target <main|ptr|season|pserver，或 .screeps.yml 里的其他服务器>（别名 --server）
  --shard <分片，支持逗号多选如 shard2,shard3,shardX 或 all>   --all-shards   --account <账号>   --compact
  --pick <路径,...>        先取结果子路径（支持逗号多路径，例如 summary.controller,summary.spawns）
  --filter <条件,...>      过滤数组或对象集合：=、!=（支持 | 多值 OR）、^= 前缀、*= 包含、< <= > >= 数值比较
  --fields <路径,...>      保留指定字段（支持数组、对象集合和普通对象）   --limit <N> 截断集合前 N 项

房间回放（官方 room-history：任意房间都能查，不需要视野；约 19 天内、每 100 tick 一块，正在进行的这一块要等写完）：
  node bin/screeps-assistant.js history W1N1 --tick 77949750 --filter type=creep --fields name,username,x,y,hits
  node bin/screeps-assistant.js history W1N1 --tick 77949750 --to 77949780 --filter type=creep --fields tick,op,name,x,y,changes
  node bin/screeps-assistant.js history W1N1 --tick 77949750 --to 77949950 --changed hits,store --best-effort
tick N 是处理完第 N 个 tick 后的现场（bot 在 Game.time=N+1 看到的状态）；本 tick 新生成的对象晚一帧出现。

日志（logs：订阅 console 事件流，不发送任何表达式，不占 console 发送额度；查不到过去的日志）：
  node bin/screeps-assistant.js logs --errors --duration 120 --target main --shard shard2
  node bin/screeps-assistant.js logs --duration 30s --grep spawn --text --target main --shard shard2
tick 是按到达时间估算的（误差约 ±1～2 tick），只有目标分片的行才有；拿到 tick 可以接 history 看那一刻的房间。

实时订阅与事件唤醒（watch：全走 WebSocket，0 轮询、0 console 额度；默认命中即退出，可直接唤醒后台 AI 指挥官）：
  node bin/screeps-assistant.js watch --room E49N36 --on creep-enter,structure-destroyed,creep-die --match "name^=Assault_|type=spawn" --timeout 15m --shard shardX
  node bin/screeps-assistant.js watch --memory "missions.loot:E49N34" --check-initial --timeout 20m --shard shardX
  node bin/screeps-assistant.js watch --room E48N32,E45N33 --on hostile-enter,nuke --console --errors --stream --cooldown 30s --shard shardX

console 表达式三选一：位置参数、--expr（别名 --eval）、--file <路径或 probes/ 下的探针名>；--file - 读 stdin
  node bin/screeps-assistant.js console --file my-probe --arg room=W1N1 --arg limit=5 --target main --shard shard2
  node bin/screeps-assistant.js console --expr "Game.time" --retry 2 --timeout 15000 --shard shard2,shard3,shardX
  node bin/screeps-assistant.js console --file - --target main <<'EOF'
  Object.values(Game.creeps).length
EOF
  node bin/screeps-assistant.js console --file probe.js --envelope              # 带请求 ID、tick 和尝试次数
  node bin/screeps-assistant.js console --file probe.js --repeat 10 --times 10
  node bin/screeps-assistant.js console --file probe.js --raw --retry 0
  node bin/screeps-assistant.js console --file large.js [--transport auto|chunk|memory] # 超长自动分片/中转

临时工具空间与收件箱：
  node bin/screeps-assistant.js tools inject [--file custom.js] [--transport auto|chunk|memory]
  node bin/screeps-assistant.js tools status | clear
  node bin/screeps-assistant.js inbox push --expr '{"cmd":"ping"}' [--id msg1]
  node bin/screeps-assistant.js inbox list | flush [--expr "items => items.length"]

包装模式用请求 ID 匹配回包并按同一 ID 重试；raw 模式关闭包装和重试。写入类表达式建议 --retry 0。

Windows 注意：不要经 npm 脚本或任何经过 cmd.exe 的方式传 console 表达式（cmd 会在 node 启动前把 >、|、&、^、% 当特殊字符）；
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