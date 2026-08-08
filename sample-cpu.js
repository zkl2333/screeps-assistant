#!/usr/bin/env node
const { ScreepsHttpClient } = require('screeps-api')

const sampleCount = Number(process.argv[2] || 3)
const timeoutMs = Number(process.argv[3] || 20000)

async function main() {
  const api = await ScreepsHttpClient.fromConfig('main', { app: 'default' })
  const samples = []

  await api.socket.connect()
  await api.socket.subscribe('cpu', event => {
    const { cpu, memory } = event.data
    samples.push({ cpu, memory })
    if (samples.length >= sampleCount) finish(0)
  })

  const timer = setTimeout(() => finish(samples.length ? 0 : 2), timeoutMs)

  function finish(code) {
    clearTimeout(timer)
    console.log(JSON.stringify(samples))
    process.exit(code)
  }
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
