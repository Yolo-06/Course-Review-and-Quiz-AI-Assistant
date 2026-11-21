'use strict';

const fs = require('fs');
const path = require('path');

const MIN_NODE_MAJOR = 18;
const root = path.resolve(__dirname, '..');
const envExample = path.join(root, 'server', '.env.example');
const envFile = path.join(root, 'server', '.env');

function fail(message) {
  console.error('[setup] ' + message);
  process.exit(1);
}

function main() {
  const major = Number(String(process.versions.node).split('.')[0]);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    fail('需要 Node.js ' + MIN_NODE_MAJOR + ' 或更高版本，当前为 ' + process.versions.node + '。');
  }
  console.log('[setup] Node.js ' + process.versions.node + '，满足 >= ' + MIN_NODE_MAJOR + ' 的要求。');

  if (!fs.existsSync(envExample)) {
    fail('找不到 server/.env.example，请确认在项目根目录执行。');
  }

  if (fs.existsSync(envFile)) {
    console.log('[setup] server/.env 已存在，保留现有配置。');
  } else {
    fs.copyFileSync(envExample, envFile);
    console.log('[setup] 已根据 server/.env.example 生成 server/.env。');
  }

  const content = fs.readFileSync(envFile, 'utf8');
  const match = /^AGENT_API_KEY=(.*)$/m.exec(content);
  if (!match || !match[1].trim()) {
    console.log('[setup] 下一步：打开 server/.env，填写 AGENT_API_KEY；如需更换模型，调整 AGENT_ENDPOINT 与 AGENT_MODEL。');
  } else {
    console.log('[setup] 已检测到 AGENT_API_KEY。');
  }

  console.log('[setup] 启动命令：npm start');
  console.log('[setup] 访问地址：http://localhost:8080');
  console.log('[setup] 健康检查：http://localhost:8080/api/health');
}

main();