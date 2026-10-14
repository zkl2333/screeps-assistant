'use strict';

const fs = require('node:fs');

const COMMANDS = ['summary', 'account', 'rooms', 'room', 'memory', 'segment', 'console', 'code', 'market', 'messages', 'history', 'shards', 'world', 'map', 'help'];
const BOOLEAN_FLAGS = new Set(['all', 'ascii', 'no-cache', 'summary-only', 'compact', 'raw', 'envelope', 'help']);
const VALUE_FLAGS = new Set([
  'target', 'shard', 'account', 'room', 'path', 'id', 'expr', 'file', 'timeout', 'branch',
  'stat', 'interval', 'resource', 'rooms', 'around', 'radius', 'concurrency', 'cache-ttl',
  'retry', 'repeat', 'times', 'filter', 'fields',
]);
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

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** 读取 console 表达式；三种来源互斥，文件去 BOM 和首尾空白。 */
async function readConsoleExpression(args, deps = {}) {
  const sources = expressionSourceNames(args);
  if (sources.length > 1) throw new Error(`console 表达式来源只能给一种，实际收到：${sources.join(', ')}`);
  if (!sources.length) throw new Error('console 命令需要游戏内表达式；可用位置参数、--expr、--file 或 --file -');
  let expression;
  if (sources[0] === '位置参数') {
    expression = args._.join(' ');
  } else if (sources[0] === '--expr') {
    expression = args.expr;
  } else if (args.file === '-') {
    expression = await (deps.readStdin || readStdin)();
  } else {
    const readFile = deps.readFile || (file => fs.promises.readFile(file, 'utf8'));
    try {
      expression = await readFile(args.file);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`表达式文件不存在：${args.file}`);
      throw new Error(`无法读取表达式文件 ${args.file}：${error?.message || error}`);
    }
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

Windows 注意：不要通过 npm run query -- 传 console 表达式。cmd.exe 会把 >、|、&、^、% 当特殊字符；
请使用 node bin/screeps-assistant.js console --file probe.js，或用 echo ... | node ... console --file -。
Git Bash 会改写以 / 开头的参数，表达式同样建议来自文件或 stdin。

用法：screeps-assistant <command> [flags] [positional...]

命令：
  summary, account, rooms, room, memory, segment, console, code, market,
  messages, history, shards, world, map, help

通用参数：
  --target <main|season|pserver>   --account <name>      --shard <name>
  --compact                        --filter <path=value,...>
  --fields <path,...>

console 常用：
  node bin/screeps-assistant.js console --file probe.js --target main --shard shard2
  node bin/screeps-assistant.js console --expr "Game.time" --retry 2 --timeout 15000
  node bin/screeps-assistant.js console --file - --envelope
  node bin/screeps-assistant.js console --file probe.js --repeat 10 --times 10
  node bin/screeps-assistant.js console --file probe.js --raw --retry 0

包装模式用请求 ID 匹配回包并按同一 ID 重试；raw 模式关闭包装和重试。写入类表达式建议 --retry 0。`;
}

module.exports = {
  BOOLEAN_FLAGS,
  COMMANDS,
  KNOWN_FLAGS,
  VALUE_FLAGS,
  commandArgs,
  expressionSourceNames,
  helpText,
  parseArgs,
  parseInteger,
  readConsoleExpression,
};