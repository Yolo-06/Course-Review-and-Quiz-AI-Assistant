'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..'));
const AGENT_ENDPOINT = process.env.AGENT_ENDPOINT || '';
const AGENT_API_KEY = process.env.AGENT_API_KEY || '';
const AGENT_MODEL = process.env.AGENT_MODEL || '';
const AGENT_TEMPERATURE = Number(process.env.AGENT_TEMPERATURE || 0.6);
const CLIENT_TOKEN = process.env.CLIENT_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 30);
const UPSTREAM_TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT || 60000);
const MAX_BODY_BYTES = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no'
};

const buckets = new Map();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of buckets) {
    if (now - record.start > 60000) buckets.delete(key);
  }
}, 300000);
cleanupTimer.unref();

function json(res, status, payload) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkText(text, size) {
  const chunks = [];
  let current = '';
  for (const char of String(text)) {
    current += char;
    if (current.length >= size || /[。！？；\n]/.test(char)) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const record = buckets.get(ip);
  if (!record || now - record.start > 60000) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  record.count += 1;
  return record.count > RATE_LIMIT;
}

function resolveCors(req) {
  const origin = req.headers.origin || '';
  if (!origin) return '';
  if (ALLOWED_ORIGIN) {
    const allowed = ALLOWED_ORIGIN.split(',').map((item) => item.trim());
    return allowed.includes(origin) ? origin : null;
  }
  try {
    const parsed = new URL(origin);
    return parsed.host === (req.headers.host || '') ? origin : null;
  } catch (error) {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('payload too large');
        error.status = 413;
        req.destroy();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        const failure = new Error('invalid json');
        failure.status = 400;
        reject(failure);
      }
    });
    req.on('error', reject);
  });
}

function extractContent(data) {
  if (typeof data === 'string') return data;
  if (!data || typeof data !== 'object') return '';
  return (
    data.content ||
    data.reply ||
    (data.message && data.message.content) ||
    (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
    (data.data && data.data.content) ||
    ''
  );
}

function parseUpstreamEvent(event) {
  const dataLines = String(event || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  const payload = dataLines.join('\n').trim();
  if (!payload) return '';
  if (payload === '[DONE]') return '[DONE]';
  try {
    const data = JSON.parse(payload);
    if (typeof data.delta === 'string') return data.delta;
    if (typeof data.content === 'string') return data.content;
    if (data.choices && data.choices[0]) {
      const choice = data.choices[0];
      if (choice.delta && typeof choice.delta.content === 'string') return choice.delta.content;
      if (typeof choice.text === 'string') return choice.text;
    }
    return '';
  } catch (error) {
    return '';
  }
}

async function handleChat(req, res) {
  const cors = resolveCors(req);
  if (cors === null) return json(res, 403, { error: 'origin_not_allowed' });
  if (cors) {
    res.setHeader('Access-Control-Allow-Origin', cors);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Token');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'method_not_allowed' });
  }

  if (CLIENT_TOKEN && !safeEqual(req.headers['x-client-token'] || '', CLIENT_TOKEN)) {
    return json(res, 401, { error: 'unauthorized' });
  }

  if (isRateLimited(clientIp(req))) {
    return json(res, 429, { error: 'rate_limited', message: '请求过于频繁，请稍后再试。' });
  }

  if (!AGENT_ENDPOINT) {
    return json(res, 503, {
      error: 'upstream_not_configured',
      message: '未配置模型服务，前端将使用离线内容。'
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return json(res, error.status || 400, { error: 'bad_request' });
  }

  const message = String(body.message || '').slice(0, 8000);
  if (!message) return json(res, 400, { error: 'message_required' });

  const history = Array.isArray(body.history)
    ? body.history
        .slice(-12)
        .filter((item) => item && item.content)
        .map((item) => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: String(item.content).slice(0, 4000)
        }))
    : [];

  let system = String(body.system || '').slice(0, 12000);
  if (body.hideAnswers) {
    system += '\n\n本次只出题：只输出题目与选项，不要输出答案、解析或「参考答案」小节。';
  }
  const stream = body.stream !== false;

  const upstreamBody = {
    model: (AGENT_MODEL || String(body.model || 'codao-agent')).slice(0, 64),
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...history,
      { role: 'user', content: message }
    ],
    stream
  };

  if (Number.isFinite(AGENT_TEMPERATURE)) {
    upstreamBody.temperature = AGENT_TEMPERATURE;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT);
  const abortOnClientClose = () => controller.abort();
  res.on('close', abortOnClientClose);

  const finish = () => {
    clearTimeout(timer);
    res.removeListener('close', abortOnClientClose);
  };

  let upstream;
  try {
    upstream = await fetch(AGENT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream, application/json' : 'application/json',
        ...(AGENT_API_KEY ? { Authorization: 'Bearer ' + AGENT_API_KEY } : {})
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal
    });
  } catch (error) {
    finish();
    if (error.name === 'AbortError') {
      return json(res, 504, { error: 'upstream_timeout', message: '模型响应超时，请重试。' });
    }
    return json(res, 502, { error: 'upstream_unreachable', message: '模型服务暂时不可用。' });
  }

  if (!upstream.ok) {
    finish();
    const status = upstream.status === 401 || upstream.status === 403
      ? 401
      : upstream.status === 429
        ? 429
        : 502;
    return json(res, status, { error: 'upstream_error', upstreamStatus: upstream.status });
  }

  const contentType = String(upstream.headers.get('content-type') || '');

  if (!stream) {
    try {
      const data = await upstream.json();
      const content = extractContent(data);
      if (!content) return json(res, 502, { error: 'empty_content' });
      return json(res, 200, { content });
    } catch (error) {
      return json(res, 502, { error: 'upstream_invalid_response' });
    } finally {
      finish();
    }
  }

  if (contentType.includes('text/event-stream') && upstream.body) {
    res.writeHead(200, SSE_HEADERS);
    let pending = '';
    let flushTimer = null;
    const flush = () => {
      if (pending && !res.destroyed) {
        res.write('data: ' + JSON.stringify({ delta: pending }) + '\n\n');
      }
      pending = '';
      flushTimer = null;
    };
    const append = (delta) => {
      pending += delta;
      if (!flushTimer) flushTimer = setTimeout(flush, 40);
    };
    const flushNow = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flush();
    };
    try {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let ended = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (res.destroyed) break;
        buffer += decoder.decode(value, { stream: true });

        let index = buffer.search(/\r?\n\r?\n/);
        while (index !== -1) {
          const event = buffer.slice(0, index);
          buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, '');
          const delta = parseUpstreamEvent(event);
          if (delta === '[DONE]') {
            flushNow();
            res.write('data: [DONE]\n\n');
            ended = true;
          } else if (delta) {
            append(delta);
          }
          index = buffer.search(/\r?\n\r?\n/);
        }
      }

      buffer += decoder.decode();
      const tail = parseUpstreamEvent(buffer);
      if (tail === '[DONE]') {
        ended = true;
      } else if (tail) {
        append(tail);
      }
      flushNow();

      if (!res.destroyed) {
        if (!ended) res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch (error) {
      flushNow();
      if (!res.destroyed) {
        res.write('data: ' + JSON.stringify({ error: 'upstream_stream_failed' }) + '\n\n');
        res.end();
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      finish();
    }
    return;
  }

  try {
    const data = await upstream.json();
    const content = extractContent(data);
    if (!content) {
      finish();
      return json(res, 502, { error: 'empty_content' });
    }
    res.writeHead(200, SSE_HEADERS);
    for (const chunk of chunkText(content, 8)) {
      if (res.destroyed || req.destroyed) return;
      res.write('data: ' + JSON.stringify({ delta: chunk }) + '\n\n');
      await sleep(14);
    }
    if (!res.destroyed) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (error) {
    if (!res.headersSent) {
      json(res, 502, { error: 'upstream_invalid_response' });
    } else if (!res.destroyed) {
      res.end();
    }
  } finally {
    finish();
  }
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'method_not_allowed' });
  }

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (error) {
    return json(res, 400, { error: 'bad_path' });
  }

  const relative = decoded === '/' ? '/index.html' : decoded;
  const target = path.resolve(ROOT, '.' + relative);

  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return json(res, 403, { error: 'forbidden' });
  }

  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) {
      return json(res, 404, { error: 'not_found' });
    }

    const extension = path.extname(target).toLowerCase();
    const headers = {
      'Content-Type': MIME[extension] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Last-Modified': stat.mtime.toUTCString(),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    };

    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(target);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  let pathname = '/';

  res.on('finish', () => {
    const elapsed = Date.now() - startedAt;
    console.log(req.method + ' ' + pathname + ' ' + res.statusCode + ' ' + elapsed + 'ms');
  });

  let parsed;
  try {
    parsed = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  } catch (error) {
    return json(res, 400, { error: 'bad_url' });
  }
  pathname = parsed.pathname;

  if (pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      upstream: Boolean(AGENT_ENDPOINT),
      stream: true,
      rateLimit: RATE_LIMIT
    });
  }

  if (pathname === '/api/chat') {
    return handleChat(req, res);
  }

  if (pathname.startsWith('/api/')) {
    return json(res, 404, { error: 'not_found' });
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('Course Review Assistant: http://localhost:' + PORT);
  console.log('Static root: ' + ROOT);
  console.log('Upstream: ' + (AGENT_ENDPOINT ? 'configured' : 'not configured (local demo only)'));
});