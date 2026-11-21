'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.location = { protocol: 'http:' };
global.ASSISTANT_CONFIG = { autoEndpoint: false };

require('../assets/data/questions.js');
require('../assets/data/knowledge.js');
require('../assets/js/knowledge-templates.js');
require('../assets/js/markdown.js');
require('../assets/js/agent.js');

const A = global.ReviewAssistant;
const T = global.KnowledgeTemplates;
const M = global.MarkdownRenderer;
const BANK = global.QUESTION_BANK;

test('题库：四套，每套 12 单选 + 4 简答，答案与解析完整', () => {
  assert.deepEqual(Object.keys(BANK).sort(), ['database', 'ds', 'generic', 'java']);
  Object.keys(BANK).forEach((topic) => {
    const bank = BANK[topic];
    assert.equal(bank.choices.length, 12, topic + ' 单选数量');
    assert.equal(bank.shorts.length, 4, topic + ' 简答数量');
    bank.choices.forEach((item) => {
      assert.match(item.answer, /^[A-D]$/);
      assert.ok(item.options.length >= 2);
      assert.ok(item.analysis);
      assert.ok(item.options[item.answer.charCodeAt(0) - 65]);
    });
  });
});

test('意图识别：五类任务与常见纠偏', () => {
  const cases = [
    ['帮我整理《数据库原理》第 4 章的考点', 'outline'],
    ['给我出 5 道单选 + 2 道简答，考察栈和队列', 'quiz'],
    ['这道题为什么选 B？帮我解释一下这个知识点', 'wrong'],
    ['对比进程和线程的区别', 'compare'],
    ['把刚才 3 道错题整理成错题笔记', 'wrongbook'],
    ['帮我总结一下出题套路', 'outline'],
    ['先对比进程和线程，再出 3 道题', 'compare']
  ];
  cases.forEach(([text, expected]) => {
    assert.equal(A.analyzeIntent(text).primary.id, expected, text);
  });
});

test('出题：数量解析与题型条件渲染', async () => {
  const five = await A.respond('给我出 5 道单选 + 2 道简答，考察栈和队列');
  assert.equal(five.questions.length, 7);
  assert.equal(five.questions.filter((q) => q.type === 'choice').length, 5);
  assert.equal(five.questions.filter((q) => q.type === 'short').length, 2);

  const ten = await A.respond('出一套 10 题的数据库自测卷');
  assert.equal(ten.questions.length, 10);

  const onlyChoice = await A.respond('给我出 5 道栈和队列的单选');
  assert.equal(onlyChoice.questions.length, 5);
  assert.ok(!onlyChoice.content.includes('简答题（每题'));
});

test('答案与题号解析：按原题给答案和单题解析', () => {
  const sheet = A.buildAnswerSheet([
    { number: 1, type: 'choice', q: '测试题', options: ['A项', 'B项', 'C项'], answer: 'B', analysis: '解析' }
  ]);
  assert.ok(sheet.includes('上一套题的答案与解析'));
  assert.ok(sheet.includes('答案：B'));

  const explanation = A.buildQuestionExplanation(
    { number: 3, type: 'choice', q: '测试题', options: ['A项', 'B项', 'C项'], answer: 'C', analysis: '解析' },
    { userAnswer: 'C' }
  );
  assert.ok(explanation.includes('第 3 题 · 解析'));
  assert.ok(explanation.includes('你选：**C**'));
  assert.ok(explanation.includes('正确'));
});

test('模板生成：单选答案位置、判断题、简答题与校验', () => {
  const item = {
    id: 'test-item',
    course: '操作系统',
    title: '进程调度',
    source: 'custom',
    definition: '进程调度是指从就绪队列中按策略选择进程并分配 CPU 的过程。',
    points: ['先来先服务', '短作业优先', '时间片轮转'],
    pitfalls: ['进程调度等同于作业调度']
  };
  const other = {
    id: 'other-item',
    course: '操作系统',
    title: '死锁',
    source: 'custom',
    definition: '死锁是指多个进程互相等待对方释放资源而无法继续执行。'
  };
  const questions = T.generate(item, [item, other], BANK);
  assert.ok(questions.length >= 4);
  questions.forEach((q) => assert.ok(T.validate(q)));

  const choice = questions.filter((q) => q.type === 'choice')[0];
  assert.ok(choice);
  assert.equal(choice.options[choice.answer.charCodeAt(0) - 65], item.definition);
  assert.ok(questions.some((q) => q.type === 'judge'));
  assert.ok(questions.some((q) => q.type === 'short'));
});

test('错题解析：粘贴题干与选项可定位题库原题', async () => {
  const text = '1. 链队列相比顺序队列的主要优势是（　）。\nA. 可以随机访问\nB. 不会出现假溢出\nC. 入队出队一定更快\nD. 不需要头尾指针\n解析这道题';
  const result = await A.respond(text);
  assert.ok(result.content.includes('已定位题库原题'));
  assert.ok(result.content.includes('B. 不会出现假溢出'));
  assert.ok(!result.content.includes('没贴完整题干'));
});

test('重新生成：同问稳定、变体换题', async () => {
  const first = await A.respond('给我出 5 道栈和队列的单选', { variant: 0 });
  const same = await A.respond('给我出 5 道栈和队列的单选', { variant: 0 });
  const other = await A.respond('给我出 5 道栈和队列的单选', { variant: 1 });
  const key = (r) => r.questions.map((q) => q.q).join('|');
  assert.equal(key(first), key(same));
  assert.notEqual(key(first), key(other));
});

test('Markdown：XSS 转义与粗体解析', () => {
  const html = M.render('<script>alert(1)</script> **bold**');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('<strong>bold</strong>'));
});

test('SSE：远程流式解析与 OpenAI delta 兼容', async () => {
  const encoder = new TextEncoder();
  const originalFetch = global.fetch;
  A.config.endpoint = 'http://test.local/api/chat';
  A.enableRemote();
  global.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: ' + JSON.stringify({ delta: '## 流式\n\n' }) + '\n\n'));
      controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'SSE 通过' } }] }) + '\n\n'));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });

  try {
    const result = await A.streamStep({ id: 'compare', label: '知识点对比' }, '对比 A 和 B', {}, () => {});
    assert.equal(result.source, 'remote');
    assert.equal(result.content, '## 流式\n\nSSE 通过');
  } finally {
    global.fetch = originalFetch;
    A.config.endpoint = '';
  }
});