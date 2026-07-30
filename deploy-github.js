// deploy-github.js — 从 GitHub 仓库拉取代码并部署到 Screeps 分支
//
// 用法: node deploy-github.js <branch> <githubOwner/repo> [screepsBranch]
// 示例: node deploy-github.js main zkl2333/screeps-auto default
const { ScreepsHttpClient } = require('screeps-api');
const https = require('https');
const path = require('path');

/**
 * 从 GitHub API 获取仓库文件列表
 */
function githubApi(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path,
      headers: { 'User-Agent': 'screeps-deploy' }
    };
    https.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`GitHub API 解析失败: ${data.substring(0,200)}`)); }
      });
    }).on('error', reject);
  });
}

/**
 * 递归获取目录下所有 .js/.ts/.wasm 文件内容
 */
async function fetchRepoFiles(owner, repo, branch = 'main', prefix = '') {
  const url = `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  console.log(`📡 获取仓库文件列表: ${owner}/${repo} (${branch})`);
  const tree = await githubApi(url);

  if (tree.message) throw new Error(`GitHub: ${tree.message}`);

  const codeFiles = tree.tree.filter(f =>
    f.type === 'blob' && /\.(js|ts|wasm|mjs|cjs)$/.test(f.path) && !f.path.includes('node_modules')
  );

  console.log(`📄 找到 ${codeFiles.length} 个代码文件`);
  const modules = {};

  for (const file of codeFiles) {
    const contentUrl = `/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`;
    const content = await githubApi(contentUrl);
    if (content.content) {
      const key = file.path.replace(/\.(ts|mjs|cjs)$/, '.js'); // 统一 .js 后缀
      modules[key] = Buffer.from(content.content, 'base64').toString('utf-8');
      console.log(`  ✅ ${file.path} → ${key} (${modules[key].length} 字符)`);
    }
  }
  return modules;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法: node deploy-github.js <githubBranch> <owner/repo> [screepsBranch]');
    console.log('示例: node deploy-github.js main zkl2333/my-screeps default');
    process.exit(1);
  }

  const [githubBranch, repoFull, screepsBranch = 'default'] = args;
  const [owner, repo] = repoFull.split('/');
  if (!owner || !repo) {
    console.error('❌ 仓库格式错误，应为 owner/repo');
    process.exit(1);
  }

  console.log(`\n🚀 开始部署: ${owner}/${repo}@${githubBranch} → Screeps "${screepsBranch}"\n`);

  // 连接 Screeps
  const api = await ScreepsHttpClient.fromConfig('main', { app: 'default' });
  const me = await api.authMe();
  console.log(`✅ 已认证: ${me.username}\n`);

  // 从 GitHub 拉取文件
  const modules = await fetchRepoFiles(owner, repo, githubBranch);

  // 推送到 Screeps
  console.log(`\n📤 推送到 Screeps 分支 "${screepsBranch}"...`);
  await api.userCodeSet({ branch: screepsBranch, modules });
  console.log(`✅ 部署完成！共 ${Object.keys(modules).length} 个文件\n`);

  // 询问是否激活此分支
  console.log(`💡 如需激活此分支，运行:`);
  console.log(`   node -e "const {ScreepsHttpClient}=require('screeps-api');(async()=>{const a=await ScreepsHttpClient.fromConfig('main');await a.userSetActiveBranch('${screepsBranch}','activeWorld');console.log('已激活')})()"`);
}

main().catch(err => {
  console.error('❌ 部署失败:', err.message);
  process.exit(1);
});
