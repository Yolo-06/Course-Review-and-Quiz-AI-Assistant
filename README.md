# 课程复习刷题 AI 助教

面向课程复习场景的对话式刷题助教。用户用自然语言提问，页面自动判断任务类型，流式输出结构化 Markdown 复习资料，支持一键复制到笔记或 Word。

前端纯静态、零依赖、零构建；可选 Node BFF 负责模型代理、鉴权、限流与 SSE。项目已按本文档的 Render 流程部署，也可直接本地运行或容器运行。

## 功能一览

| 能力 | 输出内容 | 示例问法 |
| --- | --- | --- |
| 考点梳理 | 从知识库选择课程/知识点，生成分级大纲；支持自定义知识点 | 点「选择知识点」，或直接说「整理数据库第 4 章考点」 |
| 自测卷生成 | 选择知识点后由模型出题；快捷出题默认隐藏答案，用「给出答案」补；模型不可用时回退本地题库 | 出 5 道栈和队列的自测题，不要答案 |
| 错题解析 | 支持粘贴题干匹配题库，也支持说「第 3 题为什么选 C」直接解析上一套题 | 第 3 题为什么选 C |
| 知识点对比 | Markdown 对比表格 + 选型建议 | 对比进程和线程 |
| 错题本 | 题目下方一键加入，页头面板汇总全部对话的错题，可逐条删除 | 点题目下方「加入错题本」，再到页头「错题本」查看 |
| 知识库出题 | 自定义知识点优先由模型按定义/要点/易错点生成；模型不可用时回退本地模板 | 直接说「出 XX 自测题」或点条目「出题」 |

界面与交互：

- 左右气泡、多行输入、自动增高，Enter 发送 / Shift+Enter 换行。
- 流式增量渲染，发送按钮在生成时切换为「停止」，保留已输出内容。
- 每条 AI 回复可复制、删除；「再出一套」仅对自测卷显示，普通出题结果不显示；失败时提示「重新生成失败，请稍后再试」。
- 页头可导出整段会话为 Markdown；清空需二次确认。
- 历史对话自动保存在本机浏览器，可从侧栏查看、打开或删除；「清空对话」只清空当前会话。
- 轻量的意图标注，复合指令会拆成多个步骤依次执行。
- 每道题下方有「加入错题本」快捷按钮，可随时加入/移出；页头「错题本」汇总全部对话的错题。
- 远程失败会区分超时、网络、鉴权等原因；首 token 90 秒无响应会取消，总超时同为 90 秒；提示「暂时加载失败，稍后再试」并可重试，其他失败可回退本地兜底。
- 自然语言出题会先匹配知识库课程/章节/知识点；题库未覆盖时明确提示，不再用通用卷代替。
- 说「不要答案 / 只出题」会隐藏答案与解析，需要时再说「给出答案」。
- 说「给出答案 / 需要答案 / 答案呢」会按上一套题的原题号补答案，不重新出题。
- 说「第 3 题为什么选 C」会直接读取上一套题的第 3 题解析；题号越界或当前没有题集时明确提示。
- 自定义知识点还没生成题目时，直接出题会自动按定义/要点生成并保存；只填名称会提示补充定义或要点。
- 输入框快捷按钮在空状态保留原始功能；选中知识点时显示「生成自测题 / 看考点 / 给出答案（或知识点对比）/ 解析错题 / 换知识点」，并显示当前知识点或当前上下文。
- 快捷「生成自测题」默认只出题、默认 3 道，答案通过「给出答案」补；有知识点或当前上下文时直接按范围出题，没有范围时打开知识库；自然语言出题默认带答案，明确说「不要答案」才隐藏。
- 桌面与移动端自适应，移动端侧栏为抽屉。

## 目录结构

```
course-review-quiz-assistant/
├── index.html                    页面结构
├── README.md                     使用与部署说明
├── favicon.svg                   站点图标
├── package.json                  npm setup / start / test 入口
├── Dockerfile                    容器构建
├── nginx.conf                    Nginx 部署示例
├── scripts/
│   ├── setup.js                  一键安装：检查 Node、生成 server/.env
│   └── check-upstream.js         模型接口连通性自检
├── tests/logic.test.js           核心逻辑测试（node --test）
├── assets/
│   ├── data/questions.js         题库（window.QUESTION_BANK，四套各 16 题）
│   ├── data/knowledge.js         内置知识库（课程/章节/知识点）
│   ├── css/style.css             设计变量、布局、消息、Markdown、响应式
│   └── js/
│       ├── config.js             运行时配置（接口、流式、超时、凭证）
│       ├── markdown.js           轻量 Markdown 渲染器（含 XSS 转义）
│       ├── knowledge-templates.js 本地模板出题（模型不可用时兜底）
│       ├── agent.js              意图打分、任务生成、流式与模型调用
│       └── app.js                消息流、流式渲染、停止、错题记录、复制、清空
└── server/
    ├── server.js                 零依赖 Node BFF（静态托管 + API）
    ├── .env.example              环境变量样例
    └── .env                      本地生成，已被 .gitignore 忽略，不入库
```

## 环境依赖

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | >= 18，推荐 20 LTS | 服务端与测试运行时 |
| npm | 随 Node.js 安装 | 只用于执行脚本，不安装第三方运行时依赖 |
| 浏览器 | Chrome、Edge、Safari、Firefox 现代版本 | 依赖 `fetch`、`ReadableStream`、`AbortController`，不支持 IE |
| 数据库 | 无 | 历史、错题本、自定义知识库均存浏览器 `localStorage` |
| 第三方 npm 依赖 | 无 | 前端零依赖，BFF 只使用 Node 内置模块 |

可选环境：

- Docker 20+：用于容器化部署。
- Nginx：用于静态文件与 `/api` 分离部署，不是运行必需。

## 一键安装

项目没有第三方 npm 依赖，安装步骤主要是检查 Node 版本并生成服务端配置文件。执行：

```bash
npm run setup
```

脚本 `scripts/setup.js` 会完成以下检查：

1. 检查 Node.js 是否 >= 18；
2. 若 `server/.env` 不存在，从 `server/.env.example` 复制生成；
3. 检测 `AGENT_API_KEY` 是否已填写；
4. 打印启动命令、访问地址和健康检查地址。

脚本在 Windows、macOS、Linux 下都可直接运行，不需要 `cp` 命令。

生成配置后，编辑 `server/.env`，至少填写：

```dotenv
AGENT_ENDPOINT=https://api.deepseek.com/chat/completions
AGENT_API_KEY=你的模型密钥
AGENT_MODEL=deepseek-chat
```

然后启动：

```bash
npm start
```

访问 `http://localhost:8080`，健康检查为 `http://localhost:8080/api/health`。

未配置 `AGENT_ENDPOINT` 或 `AGENT_API_KEY` 时，服务仍会启动，静态托管、健康检查、限流可用，模型能力回退到本地演示模式。

## 本地运行

方式一，直接打开 `index.html`。此方式不启动后端，使用内置题库与本地模拟流，适合演示与前端调试。

方式二，启动 Node 服务（推荐）：

```bash
npm run setup
# 编辑 server/.env，填写 AGENT_API_KEY
npm start
```

方式三，容器运行：

```bash
docker build -t course-review-assistant .
docker run --rm -p 8080:8080 --env-file server/.env course-review-assistant
```

开发与自检：

```bash
npm test              # 核心逻辑测试（Node 内置 test runner）
npm run check:model   # 模型接口连通性自检；未配置 AGENT_ENDPOINT 时会提示
```

## 部署

### Render（推荐，当前已按此流程部署）

Render 以 Web Service 方式运行 `server/server.js`，同时托管静态页面和 `/api`，模型密钥只放在 Render 环境变量中。

部署步骤：

1. 将代码推送到 Git 仓库，确认 `server/.env` 没有被提交。
2. 在 Render Dashboard 选择 **New → Web Service**，连接仓库。
3. Runtime 选择 **Node**，根目录使用仓库根目录。
4. Build Command 填 `npm install`。项目零依赖，这一步不会安装额外包；平台允许时也可以留空。
5. Start Command 填 `npm start`。
6. Health Check Path 填 `/api/health`。
7. 在 Environment 中添加下表变量，至少填写 `AGENT_API_KEY`。
8. 保存并部署，等待构建完成后访问 Render 提供的 `onrender.com` 域名。

Render 环境变量：

| 变量 | 是否必填 | 建议值 / 说明 |
| --- | --- | --- |
| `PORT` | 否 | **不要手动设置**，Render 会自动注入 |
| `STATIC_DIR` | 否 | 留空，默认项目根目录 |
| `AGENT_ENDPOINT` | 使用模型时必填 | `https://api.deepseek.com/chat/completions` |
| `AGENT_API_KEY` | 使用模型时必填 | 在 Render Dashboard 填写，不要提交到仓库 |
| `AGENT_MODEL` | 否 | `deepseek-chat`；留空时使用请求体里的 model |
| `AGENT_TEMPERATURE` | 否 | `0.6` |
| `CLIENT_TOKEN` | 否 | 可选；设置后前端 `config.js` 也要填对应 `clientToken` |
| `ALLOWED_ORIGIN` | 否 | 留空使用同源校验；跨域时填允许的来源，逗号分隔 |
| `RATE_LIMIT` | 否 | 每 IP 每分钟请求上限，默认 `30` |
| `UPSTREAM_TIMEOUT` | 否 | 上游超时，默认 `60000` 毫秒 |
| `NODE_VERSION` | 否 | 可填 `20` 固定 Node 版本 |

Render 注意事项：

- 免费实例长时间无请求会休眠，首次访问可能需要 30-60 秒冷启动；前端请求超时已放宽到 90 秒，冷启动超时会提示「暂时加载失败，稍后再试」，可重试。
- Render 支持 SSE 流式响应；如果前面再加代理，记得关闭代理缓冲，参考下方 Nginx 的 `proxy_buffering off`。
- 不要把 `server/.env` 上传到仓库或 Render；Render 使用 Dashboard 的环境变量。
- 只创建 **Static Site** 时没有 `/api` 后端，前端会回退本地模式，无法调用模型；需要模型能力请使用 **Web Service**。

部署后自检：

1. 打开首页，确认样式、脚本、图标加载正常；
2. 访问 `/api/health`，确认返回 `ok: true`，配置模型后 `upstream: true`；
3. 发一条「出 3 道栈和队列的自测题」，确认能流式输出；
4. 若失败，查看 Render Logs，重点检查 `AGENT_ENDPOINT`、`AGENT_API_KEY`、`AGENT_MODEL`。

### Docker

```bash
docker build -t course-review-assistant .
docker run --rm -p 8080:8080 --env-file server/.env course-review-assistant
```

### Nginx 分离部署

静态文件放入 `root` 目录，`/api/` 反向代理到 Node 服务。`nginx.conf` 已关闭代理缓冲，保证 SSE 不被聚合：

```nginx
location /api/ {
    proxy_pass http://app:8080;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 120s;
}
```

### 静态托管

静态托管没有 `/api` 后端，前端会自动回退本地模式；要使用模型，需要运行 `server/server.js` 并配置 `server/.env`，或部署到 Render Web Service / 容器平台。

### 码道平台

在码道项目页选择部署入口，类型选静态站点或容器，根目录指向本项目。需要模型能力时选择容器方式，并在平台环境变量中配置 `AGENT_ENDPOINT`、`AGENT_API_KEY`、`AGENT_MODEL`。

## 运行时配置

`assets/js/config.js` 可被页面预先覆盖，字段如下：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `endpoint` | 空 | 模型接口地址，留空时自动探测 `/api/chat` |
| `autoEndpoint` | `true` | 在 http/https 下自动使用 `/api/chat`；设为 `false` 可强制本地模式 |
| `model` | `codao-agent` | 传给服务端的模型标识；服务端 `AGENT_MODEL` 优先 |
| `timeout` | `90000` | 前端请求超时（毫秒） |
| `stream` | `true` | 是否请求流式响应 |
| `clientToken` | 空 | 与服务端 `CLIENT_TOKEN` 对应的会话凭证 |

说明：`file://` 打开时不会自动请求接口；自动探测失败后冷却 30 秒再自动重试，不会永久禁用，期间回退本地模式。

> `clientToken` 是会话凭证，不是模型密钥。模型密钥只能放在服务端。

## 接入真实模型

### 服务端环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 服务端口；Render 会自动注入，不要手动设置 |
| `STATIC_DIR` | 项目根目录 | 静态文件目录 |
| `AGENT_ENDPOINT` | 空 | 上游模型接口，留空则返回 503 并让前端回退本地 |
| `AGENT_API_KEY` | 空 | 上游密钥，仅服务端持有 |
| `AGENT_MODEL` | 空 | 上游模型名；留空时使用请求体里的 `model` |
| `AGENT_TEMPERATURE` | `0.6` | 采样温度 |
| `CLIENT_TOKEN` | 空 | 可选，要求前端携带 `X-Client-Token` |
| `ALLOWED_ORIGIN` | 空 | 可选，允许的跨域来源，逗号分隔；默认仅同源 |
| `RATE_LIMIT` | `30` | 每 IP 每分钟请求上限 |
| `UPSTREAM_TIMEOUT` | `60000` | 上游超时（毫秒） |

### 请求格式

前端 `POST /api/chat`：

```json
{
  "model": "codao-agent",
  "message": "用户的原始输入",
  "intent": "quiz",
  "history": [
    { "role": "user", "content": "上一轮提问" },
    { "role": "assistant", "content": "上一轮回复" }
  ],
  "wrongItems": [],
  "system": "五类任务的系统提示词",
  "stream": true
}
```

`intent` 取值：`outline`、`quiz`、`wrong`、`compare`、`wrongbook`。

BFF 会同时把 `messages`（system + history + user）传给上游，兼容 OpenAI 风格接口。`AGENT_ENDPOINT` 默认示例为 DeepSeek 的 OpenAI 兼容接口；接入其他兼容接口时，按平台文档调整 `server/server.js` 中的 `upstreamBody`。

### 响应格式

非流式：

```json
{ "content": "Markdown 文本" }
```

流式（SSE）：

```
data: {"delta":"## 标题\n\n"}
data: {"delta":"正文..."}
data: [DONE]
```

BFF 兼容上游返回 OpenAI 风格的 `choices[0].delta.content`。

### 安全设计

- 模型密钥只在服务端环境变量中，前端源码与打包产物不含密钥。
- 可选 `CLIENT_TOKEN` 鉴权、IP 限流、请求体大小限制、路径穿越防护。
- 默认同源校验；跨域需显式配置 `ALLOWED_ORIGIN`。
- 错误分级：未鉴权 401、限流 429、上游失败 502、未配置 503、超时 504。
- 静态页面响应头包含 `Content-Security-Policy`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`。

## 额外使用的开源组件

本项目**运行时没有第三方 npm 依赖**，前端也没有使用框架、构建工具或第三方 UI 库。具体如下：

| 组件 | 用途 | 许可证 | 说明 |
| --- | --- | --- | --- |
| Node.js | 服务端运行时 | MIT | 只使用内置 `http`、`fs`、`path`、`crypto`，未引入 Express 等框架 |
| `node:test` / `node:assert` | 单元测试 | MIT（Node.js 内置） | `npm test` 使用 Node 内置测试运行器 |
| Markdown 渲染器 | 复习资料渲染 | 项目自研 | `assets/js/markdown.js`，含 XSS 转义，未使用第三方 Markdown 库 |
| `node:20-alpine` | 可选 Docker 基础镜像 | Node.js MIT；Alpine 及各包按各自许可证 | 仅用于容器部署 |
| Nginx | 可选反向代理 | BSD-2-Clause | `nginx.conf` 为部署示例，不是运行必需 |

其他说明：

- 未使用数据库、ORM、前端框架、UI 组件库、第三方 CDN、统计 SDK。
- `favicon.svg` 为项目自绘，未引入第三方图标库。
- 项目未引入 GPL/AGPL 类强传染组件；如需对外开源，请补充项目自身 `LICENSE` 文件。

## 码道在项目开发中的应用总结

本项目在开发过程中使用华为云码道（CodeArts）辅助完成以下工作：

1. **需求拆解与方案设计**：把课程复习场景拆成考点梳理、自测卷生成、错题解析、知识点对比、错题本五类任务，确定「模型优先、本地兜底」的总体方案。
2. **输出协议设计**：约定 `<quiz>...</quiz>` JSON 结构，固定单选、判断、简答的字段，减少模型输出波动，便于前端解析、渲染和加入错题本。
3. **代码生成与重构**：生成并迭代前端模块（`config` / `markdown` / `knowledge-templates` / `agent` / `app`）和零依赖 Node BFF；把意图识别、题库匹配、模板生成、本地存储拆成独立模块，降低耦合。
4. **测试与质检**：补充 `node:test` 用例，覆盖题库完整性、意图识别、数量解析、答案补全、Markdown XSS、SSE 解析；用安全扫描复核 XSS 与响应头配置。
5. **文档与部署**：整理 README、Dockerfile、Nginx 配置和 Render 环境变量清单；把本地演示、Node 服务、容器、Render 四种运行方式写成可复现步骤。
6. **经验总结**：
   - 先定输出协议，再写提示词，模型输出更稳定；
   - 模型密钥只放服务端，前端只持有会话凭证；
   - 模型不可用时必须有本地兜底，避免页面空白；
   - 流式输出要处理中止、部分内容保留和超时重试；
   - 免费实例有冷启动，前端超时要留足余量。

## 自定义指南

### 换配色与字号

编辑 `assets/css/style.css` 顶部的 `:root`：

```css
:root {
  --brand: #2b59ff;
  --accent: #0fb5a4;
  --bg: #f3f6fb;
}
```

### 添加知识点与生成题目

页面里的「选择知识点」面板支持添加自定义知识点：

1. 点右上角或列表底部「添加知识点」。
2. 填课程、章节/分类、知识点名称、关键词。
3. 补充结构化字段：定义（用于单选、简答）、要点（每行一条）、易错点 / 常见错误说法（每行一条）。
4. 保存后出现在知识库列表，点主体看考点，或点「生成」由模型出题。

点「生成」后可先在生成视图里调整定义/要点/易错点，再点「生成预览」。系统优先调用模型生成，模型不可用时回退本地模板：

- 单选：正确项取定义，干扰项取同课程其他知识点或题库选项；
- 判断：要点生成正确陈述，易错点生成错误陈述；
- 简答：定义 + 要点。

预览里可移除不要的题，确认后点「保存到知识库」。此后点「出题」会优先使用这些自定义题。

自定义知识点保存在 `localStorage` 的 `course-review-knowledge-v1`，生成题目保存在 `course-review-knowledge-questions-v1`。没有定义/要点/易错点时，模板无法生成有效题目，会提示补充。

### 加一套题库

题库位于 `assets/data/questions.js`，在 `window.QUESTION_BANK` 中新增条目，并在 `detectTopic()` 增加主题判断：

```js
window.QUESTION_BANK.os = {
  title: '操作系统 · 自测卷',
  subtitle: '覆盖进程、内存与文件系统。',
  choices: [
    {
      q: '题干（　）。',
      options: ['A 选项', 'B 选项', 'C 选项', 'D 选项'],
      answer: 'B',
      analysis: '解析文字。'
    }
  ],
  shorts: [
    {
      q: '简答题干。',
      points: ['得分点一', '得分点二']
    }
  ]
};
```

出题时会自动生成 `questions` 元数据，供题目下方的「加入错题本」按钮使用；请求数量超过题库容量时，卷首会提示实际给出的题数。

### 加一组对比

在 `COMPARISONS` 中新增对象，并在 `buildCompare()` 加关键词分支。

### 调整意图规则

`INTENT_RULES` 采用「强匹配权重 ×2 + 弱匹配 +1」打分：

- `strong` 命中表示任务明确，置信度为 high；
- 只有 `weak` 命中时置信度为 low，回复会附澄清提示；
- 出现「再 / 然后 / 接着」等连接词时，会按出现顺序拆成最多两个步骤。

## 数据与隐私

- 历史对话保存在浏览器 `localStorage`（键名 `course-review-history-v1`），最多保留 30 条。
- 错题本保存在浏览器 `localStorage`（键名 `course-review-wrongbook-v1`），最多保留 100 条，跨全部对话汇总。
- 自定义知识库保存在浏览器 `localStorage`（键名 `course-review-knowledge-v1`）。
- 自定义知识点生成的题目保存在浏览器 `localStorage`（键名 `course-review-knowledge-questions-v1`）。
- 单个存储键上限 2MB；历史 30 条、错题 100 条、自定义知识点 100 条、每个知识点题目 200 道。
- 存储版本记录在 `course-review-storage-version`。
- 「清空对话」只清空当前会话并归档到历史，不删除历史记录或错题本；历史与错题可在各自面板中单独删除。
- 未使用 Cookie 或第三方统计。
- 接入模型后，请求会发送到 `AGENT_ENDPOINT` 配置的服务，由服务端持有密钥。

## 浏览器兼容

支持 Chrome、Edge、Safari、Firefox 现代版本。依赖 `fetch`、`ReadableStream`、`AbortController`、`Promise`、`Element.closest`、`String.padStart`，不支持 IE。

## 已知限制

- 内置知识库 4 套（数据库 / Java / 数据结构 / 计算机基础）；自定义知识点可用模板生成单选/判断/简答，但需要先填定义、要点或易错点，干扰项来自题库与同课程知识点，质量有限。
- 无真实上游时使用本地模拟流，内容来自内置模板，不具备开放域推理能力。
- 题库未覆盖的范围会直接提示，不再用通用卷填充；需要先补充对应知识库或题库。
- 错题归档依赖「第 N 题 / 我选 X」这类显式表达。
- 错题解析的「题库定位」只覆盖题库内已收录的题，未收录的题会回退到通用解析方法。
- 历史对话与错题本仅保存在当前浏览器，换设备或清除浏览器数据后不可恢复。
- 未做自动化 E2E 测试（浏览器内核受限）。
- Render 免费实例长时间无请求会休眠，首次访问需要冷启动，可能触发前端超时提示。
- 界面按钮文案与本文档术语存在待统一项，后续版本修正。

## 验证方式

可复现命令：

```bash
npm test
npm run check:model
```

`npm test` 覆盖：

- 题库四套的题量、答案与解析字段完整性；
- 意图识别与复合指令拆分；
- 题量解析、答案补全、题号引用；
- 模板生成（单选 / 判断 / 简答）；
- 错题匹配与变体；
- Markdown XSS 转义与表格渲染；
- SSE 增量解析。

手工验证（Chrome / Edge 现代版本）：

- 本地模式：考点梳理、自测卷生成、错题解析、知识点对比、错题本；
- 远程模式：流式输出、停止生成、部分内容保留、超时提示与重试；
- 历史对话：保存、打开、删除；
- 知识库：自定义知识点、生成预览、保存、出题；
- 安全响应头：CSP、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`。

## 免责声明

复习资料由模型或内置模板生成，仅供参考；考试范围、题型与答案以老师要求为准。