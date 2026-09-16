'use strict';

const {context} = require('./client');

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 在指定分片执行一条游戏内表达式并取回输出。
 * console 是双向通道：HTTP POST 发表达式不返回结果，输出只能从 socket 的
 * console 频道收；订阅后发送，收到第一条带 results/errors 的消息即视为本次
 * 表达式的回包。表达式执行出错时把 errors 原样抛出。
 */
async function runConsole(options, expression, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const {api, shard} = await context(options);
  await api.socket.connect();
  return new Promise((resolve, reject) => {
    const listener = event => {
      // 服务器把执行错误放在顶层 data.error（含堆栈），正常输出放在 data.messages；
      // 每次发送都会先回一条空 messages，据此跳过直到出现非空内容。
      if (event?.data?.error) {
        cleanup();
        reject(new Error(`表达式执行出错：${event.data.error}`));
        return;
      }
      const messages = event?.data?.messages;
      if (!messages || (!messages.results?.length && !messages.log?.length)) return;
      cleanup();
      resolve({shard, results: messages.results, log: messages.log});
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`console 执行超时（${timeoutMs}ms），表达式没有返回输出`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      api.socket.unsubscribe('console', listener).catch(() => {});
      // CLI 单命令生命周期：收到结果即断开，避免 websocket 挂住进程。
      api.socket.disconnect();
    }
    api.socket.subscribe('console', listener)
      .then(() => api.userConsole(expression, shard))
      .catch(error => {
        cleanup();
        reject(error);
      });
  });
}

module.exports = {runConsole};
