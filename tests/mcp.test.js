'use strict';

const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {COMMAND_TABLE} = require('../src/commands');

/**
 * MCP 是 stdio 服务，工具清单只能起进程问。这里发 initialize + tools/list，
 * 确认每个命令都注册成了 screeps_<命令名>，并挑几个参数核对 schema 与命令表一致。
 */
(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'mcp', 'server.mjs')]);
  let buffer = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
    }
  });
  const rpc = (id, method, params) => new Promise(resolve => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`);
  });

  try {
    await rpc(1, 'initialize', {protocolVersion: '2024-11-05', capabilities: {}, clientInfo: {name: 'test', version: '0'}});
    child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized', params: {}})}\n`);
    const response = await rpc(2, 'tools/list', {});
    const tools = response.result.tools;
    const names = tools.map(tool => tool.name);

    // 命令表里每个命令一个工具，外加 console。
    assert.deepEqual(names, [...COMMAND_TABLE.map(command => `screeps_${command.name}`), 'screeps_console']);
    for (const tool of tools) {
      assert.ok(tool.description?.length > 0, `${tool.name} 缺少 description`);
      // 命令表里的都是只读查询；console 能改游戏状态，必须标成写入型。
      const readOnly = tool.name !== 'screeps_console';
      assert.equal(tool.annotations?.readOnlyHint, readOnly, `${tool.name} 的只读标记不对`);
      assert.equal(tool.annotations?.destructiveHint, !readOnly, `${tool.name} 的写入标记不对`);
    }

    const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
    // 输出选项是两边共用的，每个查询工具都带。
    for (const name of ['screeps_room', 'screeps_memory', 'screeps_overview']) {
      for (const key of ['pick', 'filter', 'fields']) assert.ok(byName[name].inputSchema.properties[key], `${name} 缺少 ${key}`);
    }

    // 命令表里的参数键原样成为 MCP 参数名（camelCase），一个都不能少。
    for (const command of COMMAND_TABLE) {
      const properties = Object.keys(byName[`screeps_${command.name}`].inputSchema.properties);
      for (const key of Object.keys(command.params || {})) {
        assert.ok(properties.includes(key), `${command.name} 缺少参数 ${key}`);
      }
    }

    // logs 在 MCP 里封顶 60 秒：阻塞式调用不能占太久。
    assert.equal(byName.screeps_logs.inputSchema.properties.duration.maximum, 60);
    // 必填参数在 MCP 里显式声明；房间名有格式约束。
    assert.deepEqual(byName.screeps_memory.inputSchema.required, ['path']);
    assert.deepEqual(byName.screeps_history.inputSchema.required, ['tick']);
    assert.match(byName.screeps_room.inputSchema.properties.room.pattern, /\^\[EW\]/);
  } finally {
    child.kill();
  }
  console.log('MCP 工具清单测试通过');
})();
