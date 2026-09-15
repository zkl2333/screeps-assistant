// pull-code.js — 从 Screeps 拉取代码保存到本地（只读）
//
// 用法: node tools/backup/pull-code.js [branch] [outputDir] [--target main] [--account name]
// 示例: node tools/backup/pull-code.js main ./dist --target main --account yachiyo

'use strict';

const fs = require('fs');
const path = require('path');
const {openClient, resolveTarget} = require('../../src/api/client');

function parseArgs(argv) {
  const args = {target: 'main', _: []};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--target' || item === '--account' || item === '--branch' || item === '--out') {
      const key = item.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${item}`);
      args[key] = value;
      i += 1;
      continue;
    }
    if (item.startsWith('--')) throw new Error(`未知参数：${item}`);
    args._.push(item);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {config} = resolveTarget({target: args.target});
  const branch = args.branch || args._[0] || config.codeBranch;
  const outDir = args.out || args._[1] || `./screeps-backup-${branch}`;

  console.log(`📥 拉取 Screeps 分支 "${branch}" → ${outDir} (target=${args.target}${args.account ? `, account=${args.account}` : ''})\n`);

  const api = await openClient(args.target, args.account);
  const code = await api.userCodeGet(branch);

  console.log(`模块数: ${Object.keys(code.modules).length}`);
  console.log(`分支名: ${code.branch}\n`);

  fs.mkdirSync(outDir, {recursive: true});

  for (const [name, content] of Object.entries(code.modules)) {
    const filePath = path.join(outDir, name);
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ✅ ${name} (${content.length} 字符)`);
  }

  console.log(`\n✅ 完成！文件保存在 ${outDir}/`);
}

main().catch(err => {
  console.error('❌ 拉取失败:', err.message);
  process.exit(1);
});
