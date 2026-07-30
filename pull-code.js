// pull-code.js — 从 Screeps 拉取代码保存到本地
//
// 用法: node pull-code.js [screepsBranch] [outputDir]
// 示例: node pull-code.js main ./dist

const { ScreepsHttpClient } = require('screeps-api');
const fs = require('fs');
const path = require('path');

async function main() {
  const branch = process.argv[2] || 'main';
  const outDir = process.argv[3] || `./screeps-backup-${branch}`;

  console.log(`📥 拉取 Screeps 分支 "${branch}" → ${outDir}\n`);

  const api = await ScreepsHttpClient.fromConfig('main', { app: 'default' });
  const code = await api.userCodeGet(branch);

  console.log(`模块数: ${Object.keys(code.modules).length}`);
  console.log(`分支名: ${code.branch}\n`);

  fs.mkdirSync(outDir, { recursive: true });

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
