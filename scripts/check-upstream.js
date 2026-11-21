'use strict';

const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(__dirname, '..', 'server', '.env'));

const endpoint = process.env.AGENT_ENDPOINT || '';
const apiKey = process.env.AGENT_API_KEY || '';
const model = process.env.AGENT_MODEL || 'codao-agent';

if (!endpoint) {
  console.log('未配置 AGENT_ENDPOINT。请先在 server/.env 中填写模型接口地址。');
  process.exitCode = 1;
} else {
  const started = Date.now();
  fetch(endpoint, {
    method: 'POST',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      apiKey ? { Authorization: 'Bearer ' + apiKey } : {}
    ),
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: '你是接口连通性测试助手。' },
        { role: 'user', content: '只回复两个字：正常' }
      ],
      stream: false
    }),
    signal: AbortSignal.timeout(30000)
  }).then(async (response) => {
    const text = await response.text();
    console.log('HTTP 状态:', response.status);
    console.log('耗时:', Date.now() - started, 'ms');
    console.log('响应前 200 字:', text.slice(0, 200));
    if (!response.ok) process.exitCode = 1;
  }).catch((error) => {
    console.error('模型接口连接失败:', error.message);
    process.exitCode = 1;
  });
}