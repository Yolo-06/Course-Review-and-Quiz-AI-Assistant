# 课程复习刷题 AI 助教

面向课程复习场景的对话式刷题助教。用户用自然语言提问，页面自动判断任务类型，流式输出结构化 Markdown 复习资料，支持一键复制到笔记或 Word。

前端纯静态、零依赖、零构建；可选 Node BFF 负责模型代理、鉴权、限流与 SSE。

## 功能一览

| 能力 | 输出内容 | 示例问法 |
| --- | --- | --- |
| 考点梳理 | 从知识库选择课程/知识点，生成分级大纲；支持自定义知识点 | 点「选择知识点」，或直接说「整理数据库第 4 章考点」 |
| 习题生成 | 选择知识点后由模型出题；快捷出题默认隐藏答案，用「给出答案」补；模型不可用时回退本地题库 | 出 5 道栈和队列的题，不要答案 |
| 错题解析 | 支持粘贴题干匹配题库，也支持说「第 3 题为什么选 C」直接解析上一套题 | 第 3 题为什么选 C |
| 知识点对比 | Markdown 对比表格 + 选型建议 | 对比进程和线程 |
| 错题本 | 题目下方一键加入，页头面板汇总全部对话的错题，可逐条删除 | 点题目下方「加入错题本」，再到页头「错题本」查看 |
| 知识库出题 | 自定义知识点优先由模型按定义/要点/易错点生成；模型不可用时回退本地模板 | 直接说「出 XX 练习题」或点条目「出题」 |

界面与交互：

- 左右气泡、多行输入、自动增高，Enter 发送 / Shift+Enter 换行。
- 流式增量渲染，发送按钮在生成时切换为「停止」，保留已输出内容。
- 每条 AI 回复可复制、删除；「再出一套」仅对自测卷显示，普通练习题不显示；失败时提示“重新生成失败，请稍后再试”。
- 页头可导出整段会话为 Markdown；清空需二次确认。
- 历史对话自动保存在本机浏览器，可从侧栏查看、打开或删除；「清空对话」只清空当前会话。
- 轻量的意图标注，复合指令会拆成多个步骤依次执行。
- 每道题下方有「加入错题本」快捷按钮，可随时加入/移出；页头「错题本」汇总全部对话的错题。
- 远程失败会区分超时、网络、鉴权等原因；首 token 10 秒无响应就取消，总超时 30 秒；提示「暂时加载失败，稍后再试」并可重试，其他失败可回退本地兜底。
- 自然语言出题会先匹配知识库课程/章节/知识点；题库未覆盖时明确提示，不再用通用卷代替。
- 说「不要答案 / 只出题」会隐藏答案与解析，需要时再说「给出答案」。
- 说「给出答案 / 需要答案 / 答案呢」会按上一套题的原题号补答案，不重新出题。
- 说「第 3 题为什么选 C」会直接读取上一套题的第 3 题解析；题号越界或当前没有题集时明确提示。
- 自定义知识点还没生成题目时，直接出题会自动按定义/要点生成并保存；只填名称会提示补充定义或要点。
- 输入框快捷按钮在空状态保留原始功能；选中知识点时显示「生成练习题 / 看考点 / 给出答案（或知识点对比）/ 解析错题 / 换知识点」，并显示当前知识点或当前上下文。
- 快捷「生成练习题」默认只出题、默认 3 道，答案通过「给出答案」补；有知识点或当前上下文时直接按范围出题，没有范围时打开知识库；自然语言出题默认带答案，明确说「不要答案」才隐藏。
- 桌面与移动端自适应，移动端侧栏为抽屉。

## 目录结构

```
course-review-assistant/
├── index.html                 页面结构
├── README.md                  使用与部署说明

├── favicon.svg                站点图标
├── package.json               npm start 入口
├── Dockerfile                 容器构建
├── nginx.conf                 Nginx 部署示例
├── scripts/check-upstream.js  模型接口连通性自检
├── tests/logic.test.js        核心逻辑测试（node --test）
├── assets/
│   ├── data/questions.js      题库（window.QUESTION_BANK，四套各 16 题）
│   ├── data/knowledge.js      内置知识库（window.BUILTIN_KNOWLEDGE，课程/章节/知识点）
│   ├── css/style.css          设计变量、布局、消息、Markdown、响应式
│   └── js/
│       ├── config.js          运行时配置（接口、流式、超时、凭证）
│       ├── markdown.js        轻量 Markdown 渲染器（含 XSS 转义）
│       ├── agent.js           意图打分、任务生成、流式与模型调用
│       └── app.js             消息流、流式渲染、停止、错题记录、复制、清空
└── server/
    ├── server.js              零依赖 Node BFF（静态托管 + API）
    └── .env.example           环境变量样例
```

## 快速开始

方式一，直接打开 `index.html`。此方式不启动后端，使用内置题库与本地模拟流，适合演示与前端调试。

方式二，启动 Node 服务（推荐）：

```bash
cp server/.env.example server/.env
npm start
```

访问 `http://localhost:8080`。未配置 `AGENT_ENDPOINT` 时仍使用本地演示模式，但静态托管、健康检查、限流等能力可用。

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

## 运行时配置

`assets/js/config.js` 可被页面预先覆盖，字段如下：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `endpoint` | 空 | 模型接口地址，留空时自动探测 `/api/chat` |
| `autoEndpoint` | `true` | 在 http/https 下自动使用 `/api/chat`；设为 `false` 可强制本地模式 |
| `model` | `codao-agent` | 传给服务端的模型标识 |
| `timeout` | `30000` | 前端请求超时（毫秒） |
| `stream` | `true` | 是否请求流式响应 |
| `clientToken` | 空 | 与服务端 `CLIENT_TOKEN` 对应的会话凭证 |

说明：`file://` 打开时不会自动请求接口；自动探测失败后冷却 30 秒再自动重试，不会永久禁用，期间回退本地模式。

> `clientToken` 是会话凭证，不是模型密钥。模型密钥只能放在服务端。

## 接入真实模型

### 1. 服务端环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 服务端口，默认 8080 |
| `STATIC_DIR` | 静态文件目录，默认项目根目录 |
| `AGENT_ENDPOINT` | 上游模型接口，留空则返回 503 并让前端回退本地 |
| `AGENT_API_KEY` | 上游密钥，仅服务端持有 |
| `CLIENT_TOKEN` | 可选，要求前端携带 `X-Client-Token` |
| `ALLOWED_ORIGIN` | 可选，允许的跨域来源，逗号分隔；默认仅同源 |
| `RATE_LIMIT` | 每 IP 每分钟请求上限，默认 30 |
| `UPSTREAM_TIMEOUT` | 上游超时（毫秒），默认 60000 |

### 2. 请求格式

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

BFF 会同时把 `messages`（system + history + user）传给上游，兼容 OpenAI 风格接口；接入码道 Agent 时可按平台文档调整 `server/server.js` 中的 `upstreamBody`。

### 3. 响应格式

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

### 4. 安全设计

- 模型密钥只在服务端环境变量中，前端源码与打包产物不含密钥。
- 可选 `CLIENT_TOKEN` 鉴权、IP 限流、请求体大小限制、路径穿越防护。
- 默认同源校验；跨域需显式配置 `ALLOWED_ORIGIN`。
- 错误分级：未鉴权 401、限流 429、上游失败 502、未配置 503、超时 504。

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

- 单选：正确项取定义，干扰项取同课程其他知识点或题库选项
- 判断：要点生成正确陈述，易错点生成错误陈述
- 简答：定义 + 要点

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
      q: '简答题题干。',
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

- `strong` 命中表示任务明确，置信度为 high。
- 只有 `weak` 命中时置信度为 low，回复会附澄清提示。
- 出现「再 / 然后 / 接着」等连接词时，会按出现顺序拆成最多两个步骤。

## 部署

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

静态托管没有 `/api` 后端，前端会自动回退本地模式；要使用模型，需要运行 `server/server.js` 并配置 `server/.env`。

### 码道平台

在码道项目页选择部署入口，类型选静态站点或容器，根目录指向本项目。

### 安全响应头

`server/server.js` 为静态页面设置：

- `Content-Security-Policy`：限制脚本、样式与连接来源
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy`：禁用摄像头、麦克风、定位

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

当前限制：

- 内置知识库 4 套（数据库 / Java / 数据结构 / 计算机基础）；自定义知识点可用模板生成单选/判断/简答，但需要先填定义、要点或易错点，干扰项来自题库与同课程知识点，质量有限。
- 安全扫描（规则模式）报告 174 条待复核命中，完整报告见 `.security/report-rule-scan_87e6af4b-a76.md`；发布前需逐条复核。
- 自定义知识点还没有题目时，直接出题会自动按定义/要点生成并保存；缺字段或干扰项不足时会提示补充。
- 题库未覆盖的范围会直接提示，不再用通用卷填充；需要先补充对应知识库或题库。
- 无真实上游时使用本地模拟流，内容来自内置模板，不具备开放域推理能力。
- 错题归档依赖「第 N 题 / 我选 X」这类显式表达。
- 错题解析的「题库定位」只覆盖题库内已收录的题，未收录的题会回退到通用解析方法。
- 历史对话仅保存在当前浏览器，换设备或清除浏览器数据后不可恢复。
- 错题本同样只保存在当前浏览器，按「题干 + 答案」指纹去重。
- 未做自动化 E2E 测试（浏览器内核受限）。

## 验证情况

- 意图识别：9 组用例通过，含「总结出题套路」纠偏与复合指令拆分。
- 本地流式：jsdom 实测流式节点、停止生成、部分内容保留、复制、清空均通过。
- 远程流式：Node 环境验证 SSE 解析、OpenAI 风格 delta 兼容、AbortSignal 中止。
- BFF：静态托管、路径穿越 403、鉴权 401、限流 429、Origin 403、无上游 503、JSON 与 SSE 代理均通过。
- Markdown：XSS 转义、无分隔行表格兼容通过。
- 滚动修复：`.chat/.messages` 已补 `min-height: 0`，头尾固定不收缩；受浏览器环境限制，未做截图级视觉核对。
- P1-7：重新生成、单条删除、会话导出已在 jsdom 中实测通过，导出文件含意图标签、时间与原文。
- P1-10：错误分类（401 / 网络 / 超时）与前端错误条、来源标记、重试链路在 Node 与 jsdom 中实测通过。
- P1-6：题库扩充至四套各 16 题，题量与答案完整性校验通过；超量请求会提示实际题数。
- 历史对话：保存、查看、打开恢复、单条删除在 jsdom 中实测通过。
- 错题解析：粘贴题干 + 选项可定位题库原题并返回答案与解析，未知题回退通用方法，已通过 Node 与 jsdom 验证。
- 错题本：题目下方快捷加入/移出、页头面板跨会话汇总、历史恢复按钮状态，均已在 jsdom 中实测通过。
- 知识库：内置目录选择、自定义知识点添加/删除、考点生成、内置出题、自定义无题提示，均已在 jsdom 中实测通过。
- 出题来源：自定义知识点优先由模型生成单选 + 判断 + 简答，模型不可用时回退本地模板；预览移除、保存入库、出题与解析匹配均通过。
- 自动出题：未手动生成的自定义知识点直接出题会自动生成并保存；重新生成不再出现“暂无题目”；缺字段时提示补充，已通过 jsdom 验证。
- 重生成按钮：内置题库 5 题显示、16 题全量隐藏、自定义题库隐藏；知识库补充提示可见，已通过 jsdom 验证。
- 知识库出题匹配：自然语言指定自定义知识点时使用其题目；未覆盖范围提示；「不要答案」隐藏解析，均已通过 jsdom 验证。
- 补答案：隐藏答案后说「给出答案」可按上一套题原题号补答案；无题提示与历史恢复后补答案均已通过 jsdom 验证。
- 第 N 题解析：直接引用上一套题题号，支持中文数字、选择判断、越界提示与历史恢复，均已通过 jsdom 验证。
- 上下文快捷：空状态原始按钮、选知识点后切换、出题后给答案、换知识点、清空恢复与历史恢复，均已通过 jsdom 验证。
- 快捷出题：默认隐藏答案、「给出答案」能补上；自然语言默认显示、说「不要答案」则隐藏，均已通过 jsdom 验证。
- 重新生成：本地题库按变体随机抽题，同一问题重生成会换一批题目，已通过 Node 与 jsdom 验证。
- 项目内测试：`npm test` 覆盖题库、意图、数量解析、答案/题号、模板生成、错题匹配、变体、Markdown 与 SSE。
- 安全加固：CSP 与安全响应头已加入 BFF；XSS 命中行复核为使用 `esc` / Markdown 转义的模板输出。
- 存储加固：2MB 单键上限、历史/错题/知识库/题目数量上限与存储版本键已加入。
- 模型自检：`npm run check:model` 可在配置上游后检查连通性。