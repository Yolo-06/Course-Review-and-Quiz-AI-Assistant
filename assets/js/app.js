(function () {
  'use strict';

  var MAX_LEN = 1000;
  var RENDER_INTERVAL = 60;

  var state = {
    messages: [],
    busy: false,
    clearArmed: false,
    session: 0,
    sessionId: '',
    controller: null,
    quizSets: [],
    wrongItems: [],
    regenSeq: 0,
    knowledgeDraft: null,
    knowledgeEditingId: '',
    activeKnowledge: null,
    contextKnowledge: null,
    knowledgeGenerating: false
  };

  var els = {};
  var clearTimer = null;
  var toastTimer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function init() {
    els.sidebar = byId('sidebar');
    els.scrim = byId('scrim');
    els.messageList = byId('messageList');
    els.input = byId('input');
    els.chipBar = byId('chipBar');
    els.sendBtn = byId('sendBtn');
    els.counter = byId('counter');
    els.clearBtn = byId('clearBtn');
    els.clearBtnTop = byId('clearBtnTop');
    els.exportBtn = byId('exportBtn');
    els.menuBtn = byId('menuBtn');
    els.toast = byId('toast');
    els.historyBtn = byId('historyBtn');
    els.historyCount = byId('historyCount');
    els.historyModal = byId('historyModal');
    els.historyList = byId('historyList');
    els.closeHistoryBtn = byId('closeHistoryBtn');
    els.newChatBtn = byId('newChatBtn');
    els.wrongbookBtn = byId('wrongbookBtn');
    els.wrongbookCount = byId('wrongbookCount');
    els.wrongbookModal = byId('wrongbookModal');
    els.wrongbookList = byId('wrongbookList');
    els.closeWrongbookBtn = byId('closeWrongbookBtn');
    els.clearWrongbookBtn = byId('clearWrongbookBtn');
    els.knowledgeModal = byId('knowledgeModal');
    els.knowledgeTitle = byId('knowledgeTitle');
    els.knowledgeBody = byId('knowledgeBody');
    els.addKnowledgeBtn = byId('addKnowledgeBtn');
    els.closeKnowledgeBtn = byId('closeKnowledgeBtn');
    els.contextBar = byId('contextBar');

    els.input.maxLength = MAX_LEN;
    els.input.addEventListener('input', syncInput);
    els.input.addEventListener('keydown', onInputKeydown);
    els.sendBtn.addEventListener('click', function () {
      if (state.busy) {
        stopGeneration();
        return;
      }
      send();
    });
    els.clearBtn.addEventListener('click', armClear);
    els.clearBtnTop.addEventListener('click', armClear);
    els.exportBtn.addEventListener('click', exportConversation);
    els.historyBtn.addEventListener('click', openHistory);
    els.closeHistoryBtn.addEventListener('click', closeHistory);
    els.newChatBtn.addEventListener('click', startNewConversation);
    els.historyModal.addEventListener('click', onHistoryModalClick);
    els.historyList.addEventListener('click', onHistoryListClick);
    els.wrongbookBtn.addEventListener('click', openWrongbook);
    els.closeWrongbookBtn.addEventListener('click', closeWrongbook);
    els.clearWrongbookBtn.addEventListener('click', clearWrongbook);
    els.wrongbookModal.addEventListener('click', onWrongbookModalClick);
    els.wrongbookList.addEventListener('click', onWrongbookListClick);
    els.closeKnowledgeBtn.addEventListener('click', closeKnowledge);
    els.addKnowledgeBtn.addEventListener('click', renderKnowledgeForm);
    els.knowledgeModal.addEventListener('click', onKnowledgeModalClick);
    els.knowledgeBody.addEventListener('click', onKnowledgeBodyClick);
    els.knowledgeBody.addEventListener('submit', onKnowledgeSubmit);
    els.knowledgeBody.addEventListener('input', onKnowledgeSearchInput);
    els.knowledgeBody.addEventListener('compositionstart', onKnowledgeCompositionStart);
    els.knowledgeBody.addEventListener('compositionend', onKnowledgeCompositionEnd);
    els.menuBtn.addEventListener('click', openDrawer);
    els.scrim.addEventListener('click', closeDrawer);

    els.messageList.addEventListener('click', onMessageClick);
    document.addEventListener('click', onPromptClick);
    document.addEventListener('keydown', onGlobalKeydown);

    state.sessionId = uid();
    initStorageVersion();
    renderEmpty();
    syncInput();
    updateHistoryBadge();
    updateWrongbookBadge();
    renderComposerActions();
  }

  async function send(preset, sendOptions) {
    var sendOpts = sendOptions || {};
    var raw = typeof preset === 'string' ? preset : els.input.value;
    var text = raw.trim();

    if (!text || state.busy) return;
    if (text.length > MAX_LEN) {
      toast('内容超出 ' + MAX_LEN + ' 字限制');
      return;
    }

    if (!wantsNoAnswers(text) && wantsAnswers(text)) {
      var recentSet = findLastQuestionSet();
      els.input.value = '';
      syncInput();
      if (recentSet) {
        appendAnswerSheet(recentSet, text);
      } else {
        appendAnswerNotFound(text);
      }
      return;
    }

    var wantsGenerate = /(生成|类似|出一道|来一道|一套题|自测|考卷|试卷)/.test(text);
    var questionRef = wantsGenerate ? null : parseQuestionRef(text);
    if (questionRef) {
      var recentQuiz = findLastQuestionSet();
      var targetQuestion = recentQuiz
        ? recentQuiz.questions.filter(function (item) {
            return item.number === questionRef.number;
          })[0]
        : null;

      els.input.value = '';
      syncInput();
      if (targetQuestion) {
        appendQuestionExplanation(recentQuiz, targetQuestion, text, questionRef.userAnswer);
      } else {
        appendQuestionNotFound(text, questionRef.number);
      }
      return;
    }

    var session = state.session;
    var plan = sendOpts.plan || ReviewAssistant.analyzeIntent(text);
    var steps = sendOpts.steps || (ReviewAssistant.isRemote() ? [plan.primary] : plan.steps);
    var knowledge = sendOpts.knowledge || null;
    if (!knowledge && (plan.primary.id === 'quiz' || plan.primary.id === 'outline')) {
      var matchedKnowledge = findKnowledgeByText(text);
      if (matchedKnowledge) {
        setActiveKnowledge(matchedKnowledge);
        knowledge = enrichKnowledge(matchedKnowledge, plan.primary.id === 'quiz');
      } else {
        setActiveKnowledge(null);
        state.contextKnowledge = detectContextKnowledge(text);
        renderComposerActions();
      }
    }
    var hideAnswers = sendOpts.hideAnswers !== undefined
      ? Boolean(sendOpts.hideAnswers)
      : wantsNoAnswers(text);

    els.input.value = '';
    syncInput();
    appendUser(text);

    var controller = new AbortController();
    state.controller = controller;
    setBusy(true);

    try {
      for (var i = 0; i < steps.length; i += 1) {
        if (session !== state.session || controller.signal.aborted) break;
        await runStep(steps[i], text, plan, controller.signal, session, null, { knowledge: knowledge, hideAnswers: hideAnswers });
      }
    } catch (error) {
      if (session === state.session && !isAbort(error)) {
        toast('这次没整理出来，换个说法再试一次');
      }
    } finally {
      if (session === state.session) {
        state.controller = null;
        setBusy(false);
        syncInput();
      }
    }
  }

  async function runStep(step, text, plan, signal, session, insert, extra) {
    var exec = extra || {};
    var msg = {
      id: uid(),
      role: 'ai',
      content: '',
      intent: step.id,
      label: step.label,
      time: timeNow(),
      knowledgeId: exec.knowledge ? exec.knowledge.id : '',
      hideAnswers: Boolean(exec.hideAnswers)
    };

    var node;
    if (insert && typeof insert.index === 'number') {
      state.messages.splice(insert.index, 0, msg);
      node = createAssistantNode(msg, true, insert.before);
    } else {
      state.messages.push(msg);
      node = createAssistantNode(msg, true);
    }
    scrollToBottom(false);

    var lastRender = 0;
    var lowConfidence = plan.confidence === 'low' && step.id === 'outline' && !ReviewAssistant.isRemote();

    try {
      var result = await ReviewAssistant.streamStep(step, text, {
        history: history(),
        wrongItems: state.wrongItems,
        signal: signal,
        lowConfidence: lowConfidence,
        plan: plan,
        forceRemote: exec.forceRemote,
        variant: exec.variant || 0,
        knowledge: exec.knowledge || null,
        hideAnswers: Boolean(exec.hideAnswers)
      }, function (delta) {
        msg.content += delta;
        var now = Date.now();
        if (now - lastRender > RENDER_INTERVAL) {
          lastRender = now;
          renderStreamBody(node, msg.content);
        }
      });

      if (session !== state.session) return;

      msg.content = result.content;
      msg.source = result.source;
      msg.error = result.error || null;
      if (result.intent) msg.intent = result.intent;
      if (result.label) msg.label = result.label;
      msg.questions = result.questions || [];
      msg.canRegenerate = result.canRegenerate !== false;
      msg.quizTitle = result.quizTitle || (result.questions && result.questions.length
        ? String(result.content || '').split('\n')[0].replace(/^#+\s*/, '').trim()
        : '');
      if (result.questions && result.questions.length) {
        msg.quizKind = ReviewAssistant.detectQuizKind(text);
        msg.label = msg.quizKind === 'paper' ? '自测卷' : '练习题';
        state.quizSets.push({ messageId: msg.id, quizKind: msg.quizKind, questions: result.questions });
        if (state.quizSets.length > 3) state.quizSets.shift();
      }
      finishAssistantNode(node, msg, false);
    } catch (error) {
      if (session !== state.session) return;
      if (isAbort(error)) {
        finishAssistantNode(node, msg, true);
        return;
      }
      if (!msg.content) {
        msg.content = '## 这次没整理出来\n\n可以换个说法，或者补充一下课程和章节再试一次。';
      }
      msg.source = msg.source || 'local';
      msg.error = msg.error || { code: 'unknown', title: '请求失败', detail: '可稍后重试。', retryable: true };
      finishAssistantNode(node, msg, false);
      throw error;
    }
  }

  function stopGeneration() {
    if (!state.controller) return;
    state.controller.abort();
    toast('正在停止…');
  }

  function appendUser(text) {
    var msg = {
      id: uid(),
      role: 'user',
      content: text,
      time: timeNow()
    };
    state.messages.push(msg);
    createUserNode(msg);
    scrollToBottom(true);
    persistCurrent();
  }

  function createUserNode(msg) {
    var empty = els.messageList.querySelector('.empty');
    if (empty) empty.remove();

    var node = document.createElement('div');
    node.className = 'msg msg--user';
    node.dataset.id = msg.id;

    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = msg.content;
    node.appendChild(bubble);

    els.messageList.appendChild(node);
    return node;
  }

  function createAssistantNode(msg, streaming, beforeNode) {
    var empty = els.messageList.querySelector('.empty');
    if (empty) empty.remove();

    var node = document.createElement('div');
    node.className = 'msg msg--ai' + (streaming ? ' msg--streaming' : '');
    node.dataset.id = msg.id;
    node.innerHTML = assistantTemplate(msg, streaming);

    if (beforeNode && beforeNode.parentNode === els.messageList) {
      els.messageList.insertBefore(node, beforeNode);
    } else {
      els.messageList.appendChild(node);
    }
    return node;
  }

  function assistantTemplate(msg, streaming) {
    var esc = MarkdownRenderer.escape;
    var displayLabel = msg.quizKind === 'paper' ? '自测卷' : msg.quizKind === 'practice' ? '练习题' : msg.label;
    return '<div class="msg-head">' +
        '<span class="avatar">师</span>' +
        '<div class="msg-meta">' +
          '<strong>复习助教</strong>' +
          '<span class="intent-tag" data-intent="' + esc(msg.intent) + '">' + esc(displayLabel) + '</span>' +
          '<time>' + esc(msg.time) + '</time>' +
        '</div>' +
        '<div class="msg-tools">' +
          '<button type="button" class="copy-btn" data-action="copy" data-copy="' + esc(msg.id) + '"' + (msg.content ? '' : ' disabled') + '>' +
            '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
            '<span>复制</span>' +
          '</button>' +
          ((msg.retryKind ? false : (msg.intent === 'answers' || msg.noRetry || msg.canRegenerate === false))
            ? ''
            : '<button type="button" class="tool-btn" data-action="retry" data-id="' + esc(msg.id) + '" title="重新生成" aria-label="重新生成">' +
              '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>' +
            '</button>') +
          '<button type="button" class="tool-btn tool-btn--danger" data-action="delete" data-id="' + esc(msg.id) + '" title="删除这条回复" aria-label="删除这条回复">' +
            '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      (streaming
        ? '<p class="loading-hint">正在整理…</p>'
        : '') +
      '<div class="md-body' + (streaming ? ' is-streaming' : '') + '">' +
        (streaming ? '' : MarkdownRenderer.render(msg.content || '')) +
      '</div>';
  }

  var streamRenderState = { node: null, content: '', timer: null, last: 0 };

  function flushStreamBody() {
    var state = streamRenderState;
    if (!state.node) return;
    var body = state.node.querySelector('.md-body');
    if (body) body.innerHTML = MarkdownRenderer.render(state.content);
    var hint = state.node.querySelector('.loading-hint');
    if (hint) hint.remove();
    var typing = state.node.querySelector('.typing');
    if (typing) typing.remove();
    if (isNearBottom()) scrollToBottom(false);
    state.last = Date.now();
  }

  function cancelStreamBody() {
    if (streamRenderState.timer) {
      clearTimeout(streamRenderState.timer);
      streamRenderState.timer = null;
    }
  }

  function renderStreamBody(node, content) {
    if (!content) return;
    var state = streamRenderState;
    if (state.node !== node) {
      cancelStreamBody();
      state.node = node;
      state.content = content;
      state.last = 0;
      flushStreamBody();
      return;
    }
    state.content = content;
    var elapsed = Date.now() - state.last;
    if (elapsed >= 100) {
      cancelStreamBody();
      flushStreamBody();
    } else if (!state.timer) {
      state.timer = setTimeout(function () {
        streamRenderState.timer = null;
        flushStreamBody();
      }, 100 - elapsed);
    }
  }

  function finishAssistantNode(node, msg, stopped) {
    cancelStreamBody();
    streamRenderState.node = null;
    streamRenderState.content = '';
    if (stopped && !msg.content) {
      var index = state.messages.indexOf(msg);
      if (index >= 0) state.messages.splice(index, 1);
      node.remove();
      return;
    }

    var hint = node.querySelector('.loading-hint');
    if (hint) hint.remove();
    var typing = node.querySelector('.typing');
    if (typing) typing.remove();
    node.classList.remove('msg--streaming');

    var body = node.querySelector('.md-body');
    if (body) {
      body.classList.remove('is-streaming');
      body.innerHTML = MarkdownRenderer.render(msg.content || '');
    }

    if (stopped) {
      var note = document.createElement('p');
      note.className = 'stopped-note';
      note.textContent = '已停止，保留已生成的部分。';
      node.appendChild(note);
    }

    var copyBtn = node.querySelector('.copy-btn');
    if (copyBtn) copyBtn.disabled = !msg.content;

    var retryBtn = node.querySelector('[data-action="retry"]');
    if (retryBtn && msg.canRegenerate === false) retryBtn.remove();

    renderSourceTag(node, msg);
    renderErrorNote(node, msg);
    decorateQuestionActions(node, msg);

    if (isNearBottom()) scrollToBottom(true);
    persistCurrent();
    renderComposerActions();
  }

  function renderSourceTag(node, msg) {
    var meta = node.querySelector('.msg-meta');
    if (!meta) return;

    var existing = meta.querySelector('.source-tag');
    if (existing) existing.remove();
    if (!msg.source || msg.source === 'local') return;

    var labels = { remote: '在线', 'remote-partial': '中断', fallback: '离线' };
    var tag = document.createElement('span');
    tag.className = 'source-tag';
    tag.dataset.source = msg.source;
    tag.textContent = labels[msg.source] || '离线';

    var time = meta.querySelector('time');
    if (time) meta.insertBefore(tag, time);
    else meta.appendChild(tag);
  }

  function renderErrorNote(node, msg) {
    var existing = node.querySelector('.error-note');
    if (existing) existing.remove();
    if (!msg.error) return;

    var note = document.createElement('div');
    note.className = 'error-note';
    note.dataset.code = msg.error.code || 'unknown';

    var text = document.createElement('span');
    text.className = 'error-text';
    text.textContent = msg.error.title + '：' + msg.error.detail;
    note.appendChild(text);

    if (msg.error.retryable) {
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'error-retry';
      retry.setAttribute('data-action', 'retry-remote');
      retry.setAttribute('data-id', msg.id);
      retry.textContent = '重试';
      note.appendChild(retry);
    }

    node.appendChild(note);
  }

  function renderEmpty() {
    var cards = [
      ['01', '选择知识点', '从知识库开始复习', 'open-knowledge'],
      ['02', '解析错题', '从错题本、自测卷或手动粘贴', 'empty-wrong'],
      ['03', '对比概念', '对比两个概念或知识点', 'empty-compare']
    ];
    var esc = MarkdownRenderer.escape;

    els.messageList.innerHTML = '<div class="empty">' +
        '<div class="empty-badge">今天复习什么</div>' +
        '<h2>从哪一门开始？</h2>' +
        '<p>告诉我课程和章节，或者直接贴一道题。</p>' +
        '<div class="empty-cards">' +
          cards.map(function (card) {
            var attrs = ' data-action="' + card[3] + '"';
            return '<button type="button" class="empty-card"' + attrs + '>' +
                '<span class="ec-num">' + card[0] + '</span>' +
                '<strong>' + card[1] + '</strong>' +
                '<em>' + esc(card[2]) + '</em>' +
              '</button>';
          }).join('') +
        '</div>' +
      '</div>';
  }


  function onMessageClick(event) {
    var btn = event.target.closest('[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');
    if (action === 'copy') {
      handleCopy(btn);
      return;
    }
    if (action === 'toggle-wrong') {
      toggleWrongFromButton(btn);
      return;
    }

    var id = btn.getAttribute('data-id');
    if (action === 'retry') {
      var target = state.messages.filter(function (item) {
        return item.id === id;
      })[0];
      if (target && target.retryKind === 'answers' && target.retryPayload) {
        appendAnswerSheet(target.retryPayload.questionSet, target.retryPayload.text);
        return;
      }
      if (target && target.retryKind === 'wrong' && target.retryPayload) {
        appendQuestionExplanation(target.retryPayload.questionSet, target.retryPayload.question, target.retryPayload.text, target.retryPayload.userAnswer);
        return;
      }
      regenerate(id);
      return;
    }
    if (action === 'delete') {
      deleteMessage(id);
      return;
    }
    if (action === 'retry-remote') {
      regenerate(id, { forceRemote: true });
    }
  }

  function handleCopy(btn) {
    if (btn.disabled) return;

    var id = btn.getAttribute('data-copy');
    var msg = state.messages.find(function (item) {
      return item.id === id;
    });
    if (!msg || !msg.content) return;

    copyText(msg.content).then(function () {
      var label = btn.querySelector('span');
      btn.classList.add('is-done');
      if (label) label.textContent = '已复制';
      setTimeout(function () {
        btn.classList.remove('is-done');
        if (label) label.textContent = '复制';
      }, 1600);
      toast('已复制');
    }).catch(function () {
      toast('复制失败，请手动选择文本');
    });
  }

  async function regenerate(id, options) {
    if (state.busy) {
      toast('正在生成，请稍候');
      return;
    }

    var forceRemote = Boolean(options && options.forceRemote);
    if (forceRemote && ReviewAssistant.enableRemote) {
      ReviewAssistant.enableRemote();
    }

    var variant = (state.regenSeq || 0) + 1;
    state.regenSeq = variant;

    var index = state.messages.findIndex(function (item) {
      return item.id === id;
    });
    if (index < 0) return;

    var target = state.messages[index];
    if (target.role !== 'ai') return;
    if (target.canRegenerate === false) {
      toast('这套题已全部展示，补充要点/易错点后可生成更多');
      return;
    }

    var question = '';
    for (var i = index - 1; i >= 0; i -= 1) {
      if (state.messages[i].role === 'user') {
        question = state.messages[i].content;
        break;
      }
    }
    if (!question) {
      toast('找不到对应的问题，无法重新生成');
      return;
    }

    var node = els.messageList.querySelector('.msg[data-id="' + id + '"]');
    var before = node ? node.nextSibling : null;
    var knowledge = target.knowledgeId ? findKnowledge(target.knowledgeId) : null;
    if (knowledge) {
      knowledge = enrichKnowledge(knowledge, target.intent === 'quiz');
    }
    var plan = ReviewAssistant.analyzeIntent(question);
    var step = {
      id: target.intent || plan.primary.id,
      label: target.label || plan.primary.label
    };

    state.messages.splice(index, 1);
    state.quizSets = state.quizSets.filter(function (set) {
      return set.messageId !== id;
    });
    if (node) node.remove();

    var controller = new AbortController();
    state.controller = controller;
    var session = state.session;
    setBusy(true);

    try {
      await runStep(step, question, plan, controller.signal, session, { index: index, before: before }, { forceRemote: forceRemote, variant: variant, knowledge: knowledge, hideAnswers: Boolean(target.hideAnswers) });
    } catch (error) {
      if (session === state.session && !isAbort(error)) {
        toast('重新生成失败，请稍后再试');
      }
    } finally {
      if (session === state.session) {
        state.controller = null;
        setBusy(false);
        syncInput();
      }
    }
  }

  function deleteMessage(id) {
    if (state.busy) {
      toast('正在生成，请稍候');
      return;
    }

    var index = state.messages.findIndex(function (item) {
      return item.id === id;
    });
    if (index < 0) return;
    if (state.messages[index].role !== 'ai') return;

    state.messages.splice(index, 1);
    state.quizSets = state.quizSets.filter(function (set) {
      return set.messageId !== id;
    });

    var node = els.messageList.querySelector('.msg[data-id="' + id + '"]');
    if (node) {
      node.classList.add('msg--leaving');
      setTimeout(function () {
        node.remove();
        if (!state.messages.length) renderEmpty();
      }, 160);
    } else if (!state.messages.length) {
      renderEmpty();
    }
    toast('已删除这条回复');
    persistCurrent();
    renderComposerActions();
  }

  function exportConversation() {
    if (!state.messages.length) {
      toast('还没有可导出的对话');
      return;
    }

    var text = ReviewAssistant.exportTranscript(state.messages);
    var now = new Date();
    var stamp = now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) +
      '-' + pad2(now.getHours()) + pad2(now.getMinutes());
    downloadText('复习对话-' + stamp + '.md', text);
    toast('已导出对话');
  }

  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function downloadText(filename, text) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function detectContextKnowledge(text) {
    var source = String(text || '').replace(/\s+/g, ' ').trim();
    if (!source) return null;

    var chapterMatch = source.match(/第\s*[一二三四五六七八九十百零两\d]+\s*章/);
    var chapter = chapterMatch ? chapterMatch[0].replace(/\s+/g, '') : '';
    var before = chapterMatch ? source.slice(0, source.indexOf(chapterMatch[0])) : source;

    var verbs = /^(给我|帮我|请|我要|我想|要|想出|出|整理|生成|讲讲|说说|看看|考考|列出|总结|复习|梳理|做|准备|来)+/;
    var course = before;
    var previous = '';
    while (course && course !== previous) {
      previous = course;
      course = course.replace(verbs, '').trim();
    }

    course = course
      .replace(/[的\s，,。]+$/g, '')
      .replace(/(的)?(考点|知识点|内容|题目|题)$/g, '')
      .trim();

    var coursePattern = /(原理|系统|结构|网络|设计|导论|基础|编程|语言|数学|物理|化学|英语|数据库|操作系统|数据结构|组成|体系|概论|教程|技术|分析|算法|工程|管理|经济|法学|医学)$/;
    if (!course || course.length > 20 || /^[\d\s]/.test(course) || /道题|个题|为什么|怎么|选|答案/.test(course) || (course.length > 6 && !coursePattern.test(course))) {
      if (chapter) return { course: '', chapter: chapter, isContext: true };
      return null;
    }

    return { course: course, chapter: chapter, isContext: true };
  }

  function setActiveKnowledge(item) {
    if (!item) {
      state.activeKnowledge = null;
    } else {
      state.activeKnowledge = {
        id: item.id,
        course: item.course,
        chapter: item.chapter || '',
        title: item.title,
        topic: item.topic || '',
        source: item.source || 'custom'
      };
      state.contextKnowledge = null;
    }
    renderComposerActions();
  }

  function renderComposerActions() {
    var esc = MarkdownRenderer.escape;
    var knowledge = state.activeKnowledge;
    var questionSet = findLastQuestionSet();
    var hasConversation = state.messages.length > 0;
    var list = [];

    if (!hasConversation && !knowledge) {
      list = [
        { text: '选择知识点', action: 'open-knowledge' },
        { text: '生成练习题', action: 'empty-quiz' },
        { text: '解析错题', action: 'empty-wrong' },
        { text: '知识点对比', action: 'empty-compare' }
      ];
    } else if (knowledge) {
      list.push({ text: '生成练习题', action: 'ctx-quiz' });
      list.push({ text: '看考点', action: 'ctx-outline' });
      if (questionSet) {
        list.push({ text: '给出答案', action: 'ctx-answer' });
      } else {
        list.push({ text: '知识点对比', action: 'ctx-compare' });
      }
      list.push({ text: '解析错题', action: 'empty-wrong' });
      list.push({ text: '换知识点', action: 'open-knowledge' });
    } else if (questionSet) {
      list.push({ text: '给出答案', action: 'ctx-answer' });
      if (questionSet.quizKind === 'paper' && questionSet.canRegenerate !== false) {
        list.push({ text: '再出一套', action: 'ctx-regenerate' });
      }
      list.push({ text: '换知识点', action: 'open-knowledge' });
      list.push({ text: '解析错题', action: 'empty-wrong' });
    } else {
      list = [
        { text: '选择知识点', action: 'open-knowledge' },
        { text: '生成练习题', action: 'empty-quiz' },
        { text: '解析错题', action: 'empty-wrong' },
        { text: '知识点对比', action: 'empty-compare' }
      ];
    }

    els.chipBar.innerHTML = list.map(function (item) {
      var attr = ' data-action="' + item.action + '"';
      return '<button type="button" class="chip"' + attr + '>' + esc(item.text) + '</button>';
    }).join('');

    var context = knowledge || state.contextKnowledge;
    if (context) {
      var contextText = knowledge
        ? knowledge.course + (knowledge.chapter ? ' · ' + knowledge.chapter : '') + ' · ' + knowledge.title
        : [context.course, context.chapter].filter(Boolean).join(' · ');
      if (contextText) {
        els.contextBar.hidden = false;
        els.contextBar.innerHTML = (knowledge ? '当前知识点：' : '当前上下文：') + '<strong>' + esc(contextText) + '</strong>';
      } else {
        els.contextBar.hidden = true;
        els.contextBar.innerHTML = '';
      }
    } else {
      els.contextBar.hidden = true;
      els.contextBar.innerHTML = '';
    }
  }

  function focusInput(hint) {
    var input = els.input;
    if (!input.dataset.defaultPlaceholder) {
      input.dataset.defaultPlaceholder = input.getAttribute('placeholder') || '';
    }
    input.value = '';
    syncInput();
    input.placeholder = hint || input.dataset.defaultPlaceholder;
    input.focus();
    closeDrawer();
    toast(hint ? '输入后按发送' : '');
  }

  function handleQuickAction(action) {
    if (!action) return false;

    if (action === 'open-knowledge') {
      openKnowledge();
      return true;
    }

    if (action === 'empty-quiz') {
      if (state.busy) {
        toast('正在生成，请稍候');
        return true;
      }
      if (state.activeKnowledge) {
        sendKnowledge(state.activeKnowledge, 'quiz', { hideAnswers: true });
        return true;
      }
      if (state.contextKnowledge && state.contextKnowledge.course) {
        var contextScope = state.contextKnowledge.course + (state.contextKnowledge.chapter ? ' · ' + state.contextKnowledge.chapter : '');
        send('根据「' + contextScope + '」出 3 道练习题', { hideAnswers: true });
        return true;
      }
      openKnowledge();
      toast('先选知识点，或说明课程和章节');
      return true;
    }

    if (action === 'empty-wrong') {
      openWrongSource();
      return true;
    }

    if (action === 'empty-compare') {
      var template = '对比 A 和 B 的区别，用表格呈现';
      els.input.value = template;
      syncInput();
      els.input.focus();
      els.input.setSelectionRange(3, 4);
      toast('把 A、B 替换成两个概念后发送');
      return true;
    }

    if (action === 'ctx-quiz') {
      if (state.busy) {
        toast('正在生成，请稍候');
        return true;
      }
      if (!state.activeKnowledge) {
        toast('请先选择知识点');
        return true;
      }
      sendKnowledge(state.activeKnowledge, 'quiz', { hideAnswers: true });
      return true;
    }

    if (action === 'ctx-outline') {
      if (state.busy) {
        toast('正在生成，请稍候');
        return true;
      }
      if (!state.activeKnowledge) {
        toast('请先选择知识点');
        return true;
      }
      sendKnowledge(state.activeKnowledge, 'outline');
      return true;
    }

    if (action === 'ctx-compare') {
      if (!state.activeKnowledge) {
        toast('请先选择知识点');
        return true;
      }
      var knowledge = state.activeKnowledge;
      var text = '对比「' + (knowledge.chapter ? knowledge.chapter + ' · ' : '') + knowledge.title + '」和 ';
      els.input.value = text;
      syncInput();
      els.input.focus();
      els.input.setSelectionRange(text.length, text.length);
      toast('已填入，补上第二个概念即可');
      return true;
    }

    if (action === 'ctx-answer') {
      if (state.busy) {
        toast('正在生成，请稍候');
        return true;
      }
      var questionSet = findLastQuestionSet();
      if (!questionSet) {
        toast('当前没有可补答案的题目');
        return true;
      }
      els.input.value = '';
      syncInput();
      appendAnswerSheet(questionSet, '给出答案');
      return true;
    }

    if (action === 'ctx-regenerate') {
      if (state.busy) {
        toast('正在生成，请稍候');
        return true;
      }
      var recent = findLastQuestionSet();
      if (!recent || recent.quizKind !== 'paper') {
        toast('当前没有可重新生成的自测卷');
        return true;
      }
      toast('正在重新生成自测卷…');
      regenerate(recent.id);
      return true;
    }

    return false;
  }

  function onPromptClick(event) {
    var actionTrigger = event.target.closest('[data-action]');
    if (actionTrigger && handleQuickAction(actionTrigger.getAttribute('data-action'))) {
      event.preventDefault();
      return;
    }

    }

  function onInputKeydown(event) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!state.busy) send();
  }

  function onGlobalKeydown(event) {
    if (event.key === 'Escape') {
      closeDrawer();
      closeHistory();
      closeWrongbook();
      closeKnowledge();
    }
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      event.target.closest &&
      event.target.closest('[data-action="open-knowledge"]') &&
      event.target.tagName !== 'BUTTON'
    ) {
      event.preventDefault();
      openKnowledge();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      els.input.focus();
    }
  }

  function syncInput() {
    var input = els.input;
    if (input.dataset.defaultPlaceholder && input.placeholder !== input.dataset.defaultPlaceholder) {
      input.placeholder = input.dataset.defaultPlaceholder;
    }
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 168) + 'px';
    els.counter.textContent = String(input.value.length);
    els.sendBtn.disabled = state.busy ? false : !input.value.trim();
  }

  function setBusy(value) {
    state.busy = value;
    var label = els.sendBtn.querySelector('span');
    if (label) label.textContent = value ? '停止' : '发送';
    els.sendBtn.classList.toggle('is-stop', value);
    els.sendBtn.disabled = value ? false : !els.input.value.trim();
    els.input.setAttribute('aria-busy', String(value));
  }

  function armClear() {
    if (state.busy) {
      toast('内容生成中，请先停止或稍候');
      return;
    }
    if (!state.messages.length) {
      toast('当前没有可清空的对话');
      return;
    }
    if (!state.clearArmed) {
      state.clearArmed = true;
      els.clearBtn.textContent = '再次点击确认清空';
      els.clearBtnTop.textContent = '再次点击确认';
      clearTimeout(clearTimer);
      clearTimer = setTimeout(resetClearArm, 4000);
      toast('再次点击即可清空对话');
      return;
    }
    clearConversation();
  }

  function resetClearArm() {
    state.clearArmed = false;
    els.clearBtn.textContent = '清空对话';
    els.clearBtnTop.textContent = '清空对话';
    clearTimeout(clearTimer);
  }

  function clearConversation() {
    persistCurrent();
    state.session += 1;
    if (state.controller) state.controller.abort();
    state.messages = [];
    state.quizSets = [];
    state.wrongItems = [];
    state.regenSeq = 0;
    state.controller = null;
    state.sessionId = uid();
    state.contextKnowledge = null;
    setActiveKnowledge(null);
    resetClearArm();
    renderEmpty();
    setBusy(false);
    syncInput();
    updateHistoryBadge();
    toast('已清空，历史对话已保留');
  }

  var STORAGE_VERSION_KEY = 'course-review-storage-version';
  var MAX_STORAGE_BYTES = 2 * 1024 * 1024;

  function safeWriteJSON(key, value) {
    try {
      var text = JSON.stringify(value);
      if (text.length > MAX_STORAGE_BYTES) return false;
      localStorage.setItem(key, text);
      return true;
    } catch (error) {
      return false;
    }
  }

  function initStorageVersion() {
    try {
      if (!localStorage.getItem(STORAGE_VERSION_KEY)) {
        localStorage.setItem(STORAGE_VERSION_KEY, '1');
      }
    } catch (error) {}
  }

  var HISTORY_KEY = 'course-review-history-v1';
  var HISTORY_LIMIT = 30;

  function readHistoryStore() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  function writeHistoryStore(list) {
    return safeWriteJSON(HISTORY_KEY, list.slice(0, HISTORY_LIMIT));
  }

  function buildHistoryTitle() {
    var first = state.messages.filter(function (msg) {
      return msg.role === 'user';
    })[0];
    if (!first) return '未命名对话';
    var text = first.content.replace(/\s+/g, ' ').trim();
    return text.length > 36 ? text.slice(0, 36) + '…' : text;
  }

  function persistCurrent() {
    if (!state.messages.length || !state.sessionId) return;
    if (typeof localStorage === 'undefined') return;

    var list = readHistoryStore();
    var index = -1;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === state.sessionId) {
        index = i;
        break;
      }
    }

    var record = {
      id: state.sessionId,
      title: buildHistoryTitle(),
      createdAt: index >= 0 ? list[index].createdAt : Date.now(),
      updatedAt: Date.now(),
      messages: state.messages,
      quizSets: state.quizSets,
      wrongItems: state.wrongItems
    };

    if (index >= 0) list[index] = record;
    else list.unshift(record);

    list.sort(function (a, b) {
      return b.updatedAt - a.updatedAt;
    });

    if (!writeHistoryStore(list)) {
      toast('历史记录已满，请删除旧对话');
    }
    updateHistoryBadge();
  }

  function updateHistoryBadge() {
    if (!els.historyCount) return;
    var count = readHistoryStore().length;
    els.historyCount.textContent = String(count);
    els.historyCount.classList.toggle('is-empty', count === 0);
  }

  function openHistory() {
    renderHistoryList();
    els.historyModal.classList.add('is-open');
    els.historyModal.setAttribute('aria-hidden', 'false');
    closeDrawer();
  }

  function closeHistory() {
    els.historyModal.classList.remove('is-open');
    els.historyModal.setAttribute('aria-hidden', 'true');
  }

  function onHistoryModalClick(event) {
    if (event.target === els.historyModal) closeHistory();
  }

  function formatHistoryTime(timestamp) {
    var date = new Date(timestamp || Date.now());
    return pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
  }

  function renderHistoryList() {
    var list = readHistoryStore();
    if (!list.length) {
      els.historyList.innerHTML = '<p class="history-empty">还没有历史对话，发送第一条消息后会自动保存到这里。</p>';
      return;
    }

    var esc = MarkdownRenderer.escape;
    els.historyList.innerHTML = list.map(function (item) {
      var isCurrent = item.id === state.sessionId;
      var count = item.messages ? item.messages.length : 0;
      return '<div class="history-item' + (isCurrent ? ' is-current' : '') + '">' +
          '<button type="button" class="history-open" data-action="open-history" data-id="' + esc(item.id) + '">' +
            '<strong>' + esc(item.title || '未命名对话') + '</strong>' +
            '<span>' + esc(formatHistoryTime(item.updatedAt)) + ' · ' + count + ' 条消息' + (isCurrent ? ' · 当前' : '') + '</span>' +
          '</button>' +
          '<button type="button" class="history-del" data-action="delete-history" data-id="' + esc(item.id) + '" title="删除这条历史" aria-label="删除这条历史">' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>' +
          '</button>' +
        '</div>';
    }).join('');
  }

  function onHistoryListClick(event) {
    var btn = event.target.closest('[data-action]');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var action = btn.getAttribute('data-action');
    if (action === 'open-history') loadHistoryItem(id);
    else if (action === 'delete-history') deleteHistoryItem(id);
  }

  function loadHistoryItem(id) {
    if (state.busy) {
      toast('正在生成，请先停止');
      return;
    }

    var list = readHistoryStore();
    var item = null;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) {
        item = list[i];
        break;
      }
    }
    if (!item) {
      toast('这条对话已被删除');
      renderHistoryList();
      return;
    }

    persistCurrent();
    state.session += 1;
    state.sessionId = item.id;
    state.messages = JSON.parse(JSON.stringify(item.messages || []));
    state.quizSets = JSON.parse(JSON.stringify(item.quizSets || []));
    state.wrongItems = JSON.parse(JSON.stringify(item.wrongItems || []));
    migrateQuizKinds();
    state.regenSeq = 0;
    state.controller = null;
    state.contextKnowledge = null;

    var restoredKnowledge = null;
    for (var k = state.messages.length - 1; k >= 0; k -= 1) {
      if (state.messages[k].knowledgeId) {
        restoredKnowledge = findKnowledge(state.messages[k].knowledgeId);
        break;
      }
    }
    setActiveKnowledge(restoredKnowledge);

    renderAllMessages();
    updateHistoryBadge();
    closeHistory();
    toast('已打开历史对话');
  }

  function deleteHistoryItem(id) {
    var list = readHistoryStore().filter(function (item) {
      return item.id !== id;
    });
    writeHistoryStore(list);

    if (id === state.sessionId) {
      state.messages = [];
      state.quizSets = [];
      state.wrongItems = [];
      state.regenSeq = 0;
      state.sessionId = uid();
      renderEmpty();
    }

    updateHistoryBadge();
    renderHistoryList();
    toast('已删除历史对话');
  }

  function startNewConversation() {
    if (state.busy) {
      toast('正在生成，请先停止');
      return;
    }
    persistCurrent();
    state.session += 1;
    state.messages = [];
    state.quizSets = [];
    state.wrongItems = [];
    state.regenSeq = 0;
    state.sessionId = uid();
    state.controller = null;
    state.contextKnowledge = null;
    setActiveKnowledge(null);
    renderEmpty();
    updateHistoryBadge();
    closeHistory();
    toast('已开始新对话');
  }

  function renderAllMessages() {
    migrateQuizKinds();
    els.messageList.innerHTML = '';
    if (!state.messages.length) {
      renderEmpty();
      return;
    }

    state.messages.forEach(function (msg) {
      if (msg.role === 'user') {
        createUserNode(msg);
      } else {
        var node = createAssistantNode(msg, false);
        renderSourceTag(node, msg);
        renderErrorNote(node, msg);
        decorateQuestionActions(node, msg);
      }
    });
    scrollToBottom(false);
  }

  var WRONGBOOK_KEY = 'course-review-wrongbook-v1';

  function readWrongbook() {
    try {
      var raw = localStorage.getItem(WRONGBOOK_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  function writeWrongbook(list) {
    var ok = safeWriteJSON(WRONGBOOK_KEY, list.slice(0, 100));
    if (!ok) toast('错题本保存失败，浏览器存储可能已满');
    return ok;
  }

  function wrongFingerprint(question) {
    return (String(question.q || '') + '|' + String(question.answer || ''))
      .replace(/[\s，。、；：（）()「」]/g, '')
      .toLowerCase();
  }

  function isQuestionInWrongbook(question) {
    var fingerprint = wrongFingerprint(question);
    return readWrongbook().some(function (item) {
      return item.fingerprint === fingerprint;
    });
  }

  function isQuestionInWrongbookForQuiz(question, quizId) {
    var fingerprint = wrongFingerprint(question);
    return readWrongbook().some(function (item) {
      return item.fingerprint === fingerprint && (!item.quizId || item.quizId === quizId);
    });
  }

  function wrongEntryForQuiz(question, quizId) {
    var fingerprint = wrongFingerprint(question);
    return readWrongbook().filter(function (item) {
      return item.fingerprint === fingerprint && (!item.quizId || item.quizId === quizId);
    })[0] || null;
  }

  var EXPLAIN_CACHE_KEY = 'course-review-explain-cache-v1';

  function explainCacheKey(question, userAnswer) {
    return wrongFingerprint(question) + '|' + String(userAnswer || '');
  }

  function readExplainCache() {
    try {
      var raw = localStorage.getItem(EXPLAIN_CACHE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  var EXPLAIN_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

  function readExplainCacheItem(question, userAnswer) {
    var key = explainCacheKey(question, userAnswer);
    var now = Date.now();
    var list = readExplainCache();
    var valid = list.filter(function (entry) {
      return entry && entry.content && entry.createdAt && (now - entry.createdAt) < EXPLAIN_CACHE_TTL;
    });
    if (valid.length !== list.length) {
      safeWriteJSON(EXPLAIN_CACHE_KEY, valid.slice(0, 50));
    }
    var item = valid.filter(function (entry) {
      return entry.key === key;
    })[0];
    return item ? item.content : '';
  }

  function writeExplainCacheItem(question, userAnswer, content) {
    if (!content) return;
    var key = explainCacheKey(question, userAnswer);
    var list = readExplainCache().filter(function (entry) {
      return entry.key !== key;
    });
    list.unshift({ key: key, content: content, createdAt: Date.now() });
    safeWriteJSON(EXPLAIN_CACHE_KEY, list.slice(0, 50));
  }

  function questionFromButton(btn) {
    var msgId = btn.getAttribute('data-msg');
    var number = parseInt(btn.getAttribute('data-number'), 10);
    var msg = state.messages.filter(function (item) {
      return item.id === msgId;
    })[0];
    if (!msg || !Array.isArray(msg.questions)) return null;
    var question = msg.questions.filter(function (item) {
      return item.number === number;
    })[0] || null;
    if (!question) return null;
    return { question: question, msg: msg };
  }

  function toggleWrongFromButton(btn) {
    var found = questionFromButton(btn);
    if (!found) {
      toast('没找到这道题的数据');
      return;
    }
    var question = found.question;
    var msg = found.msg;

    var fingerprint = wrongFingerprint(question);
    var list = readWrongbook();
    var index = -1;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].fingerprint === fingerprint) {
        index = i;
        break;
      }
    }

    if (index >= 0) {
      list.splice(index, 1);
      writeWrongbook(list);
      toast('已从错题本移除');
    } else {
      list.unshift({
        fingerprint: fingerprint,
        q: question.q,
        type: question.type || 'choice',
        options: question.options || [],
        answer: question.answer || '',
        analysis: question.analysis || '',
        sourceTitle: buildHistoryTitle(),
        sourceSessionId: state.sessionId,
        quizId: msg.id,
        quizKind: msg.quizKind || '',
        addedAt: Date.now()
      });
      writeWrongbook(list);
      toast('已加入错题本');
    }

    updateWrongbookBadge();
    refreshQuestionActions();
    if (els.wrongbookModal.classList.contains('is-open')) renderWrongbookList();
  }

  function updateWrongbookBadge() {
    if (!els.wrongbookCount) return;
    var count = readWrongbook().length;
    els.wrongbookCount.textContent = String(count);
    els.wrongbookCount.classList.toggle('is-empty', count === 0);
  }

  function decorateQuestionActions(node, msg) {
    if (msg.intent === 'answers' || msg.intent === 'wrong') return;
    var questions = msg.questions || [];
    if (!questions.length) return;

    var body = node.querySelector('.md-body');
    if (!body) return;

    body.querySelectorAll('.question-action').forEach(function (item) {
      item.remove();
    });

    var byNumber = {};
    questions.forEach(function (question) {
      byNumber[question.number] = question;
    });

    body.querySelectorAll('strong').forEach(function (strong) {
      var text = strong.textContent.trim();
      if (/^第\s*\d+\s*题\s*答案/.test(text)) return;
      if (/答案[：:]/.test(text)) return;
      if (/参考答案/.test(text)) return;

      var match = text.match(/^(\d+)\./);
      if (!match) return;

      var number = parseInt(match[1], 10);
      var question = byNumber[number];
      if (!question) return;

      var holder = strong.closest('p');
      if (!holder) return;

      var added = isQuestionInWrongbook(question);
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'question-action' + (added ? ' is-added' : '');
      button.setAttribute('data-action', 'toggle-wrong');
      button.setAttribute('data-msg', msg.id);
      button.setAttribute('data-number', String(number));
      button.textContent = added ? '已加入错题本' : '加入错题本';

      holder.insertAdjacentElement('afterend', button);
    });
  }

  function refreshQuestionActions() {
    els.messageList.querySelectorAll('.msg--ai').forEach(function (node) {
      var id = node.getAttribute('data-id');
      var msg = state.messages.filter(function (item) {
        return item.id === id;
      })[0];
      if (msg) decorateQuestionActions(node, msg);
    });
  }

  function openWrongbook() {
    renderWrongbookList();
    els.wrongbookModal.classList.add('is-open');
    els.wrongbookModal.setAttribute('aria-hidden', 'false');
    closeDrawer();
  }

  function closeWrongbook() {
    els.wrongbookModal.classList.remove('is-open');
    els.wrongbookModal.setAttribute('aria-hidden', 'true');
  }

  function onWrongbookModalClick(event) {
    if (event.target === els.wrongbookModal) closeWrongbook();
  }

  function onWrongbookListClick(event) {
    var btn = event.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var key = btn.getAttribute('data-key');

    if (action === 'delete-wrong') {
      var list = readWrongbook().filter(function (item) {
        return item.fingerprint !== key;
      });
      writeWrongbook(list);
      updateWrongbookBadge();
      renderWrongbookList();
      refreshQuestionActions();
      toast('已从错题本移除');
      return;
    }

    if (action === 'explain-wrong') {
      var item = readWrongbook().filter(function (entry) {
        return entry.fingerprint === key;
      })[0];
      if (!item) return;
      closeWrongbook();
      appendQuestionExplanation(
        { quizTitle: item.sourceTitle || '错题本' },
        {
          number: item.number || 1,
          type: item.type || 'choice',
          q: item.q || '',
          options: item.options || [],
          answer: item.answer || '',
          analysis: item.analysis || ''
        },
        '解析这道错题',
        item.userAnswer || ''
      );
    }
  }

  function clearWrongbook() {
    if (!readWrongbook().length) {
      toast('错题本已经是空的');
      return;
    }
    writeWrongbook([]);
    updateWrongbookBadge();
    renderWrongbookList();
    refreshQuestionActions();
    toast('已清空错题本');
  }

  function renderWrongbookList() {
    var list = readWrongbook();
    if (!list.length) {
      els.wrongbookList.innerHTML = '<p class="history-empty">错题本还是空的。在题目下方点「加入错题本」即可收集，全部对话的错题都会汇总到这里。</p>';
      return;
    }

    var esc = MarkdownRenderer.escape;
    els.wrongbookList.innerHTML = list.map(function (item) {
      var options = (item.options || []).map(function (option, index) {
        return '<span class="wrongbook-option">' + String.fromCharCode(65 + index) + '. ' + esc(option) + '</span>';
      }).join('');

      return '<article class="wrongbook-item">' +
          '<div class="wrongbook-item-head">' +
            '<strong>' + esc(item.q || '未命名题目') + '</strong>' +
            '<div class="wrongbook-item-actions">' +
              '<button type="button" class="wrongbook-explain" data-action="explain-wrong" data-key="' + esc(item.fingerprint) + '">解析</button>' +
              '<button type="button" class="history-del" data-action="delete-wrong" data-key="' + esc(item.fingerprint) + '" title="从错题本移除" aria-label="从错题本移除">' +
                '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
          (options ? '<div class="wrongbook-options">' + options + '</div>' : '') +
          '<p class="wrongbook-answer">正确答案：<strong>' + esc(item.answer || '—') + '</strong></p>' +
          (item.analysis ? '<p class="wrongbook-analysis">' + esc(item.analysis) + '</p>' : '') +
          '<p class="wrongbook-meta">' + esc(item.sourceTitle || '历史会话') + ' · ' + esc(formatHistoryTime(item.addedAt)) + '</p>' +
        '</article>';
    }).join('');
  }

  var KNOWLEDGE_KEY = 'course-review-knowledge-v1';

  function readCustomKnowledge() {
    try {
      var raw = localStorage.getItem(KNOWLEDGE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  function writeCustomKnowledge(list) {
    return safeWriteJSON(KNOWLEDGE_KEY, list.slice(0, 100));
  }

  function getKnowledgeList() {
    var builtin = Array.isArray(window.BUILTIN_KNOWLEDGE) ? window.BUILTIN_KNOWLEDGE : [];
    return builtin.concat(readCustomKnowledge());
  }

  function generateAndSaveKnowledgeQuestions(item) {
    if (!window.KnowledgeTemplates) return [];

    var generated = window.KnowledgeTemplates.generate(item, getKnowledgeList(), window.QUESTION_BANK);
    if (!generated.length) return [];

    var store = readKnowledgeQuestions();
    var existing = Array.isArray(store[item.id]) ? store[item.id] : [];
    var keys = {};
    existing.forEach(function (question) {
      keys[question.q] = true;
    });

    generated.forEach(function (question) {
      if (keys[question.q]) return;
      keys[question.q] = true;
      existing.push(question);
    });

    store[item.id] = existing;
    if (!writeKnowledgeQuestions(store)) {
      toast('题目保存失败，浏览器存储可能已满');
      return [];
    }
    return existing;
  }

  function enrichKnowledge(item, autoGenerate) {
    var questions = item.source === 'custom' ? getKnowledgeQuestions(item.id) : [];
    if (!questions.length && autoGenerate && item.source === 'custom') {
      questions = generateAndSaveKnowledgeQuestions(item);
    }
    return Object.assign({}, item, {
      customQuestions: questions
    });
  }

  function normalizeForMatch(value) {
    return String(value || '').replace(/[\s，。、；：（）()「」·]/g, '').toLowerCase();
  }

  function findKnowledgeByText(text) {
    var source = normalizeForMatch(text);
    if (!source) return null;

    var best = null;
    getKnowledgeList().forEach(function (item) {
      var score = 0;
      var course = normalizeForMatch(item.course);
      var courseAlias = course.slice(0, 3);
      if (course && (source.indexOf(course) !== -1 || (courseAlias && source.indexOf(courseAlias) !== -1))) {
        score += 3;
      }

      var chapter = normalizeForMatch(item.chapter);
      if (chapter && source.indexOf(chapter) !== -1) score += 2;

      var title = normalizeForMatch(item.title);
      if (title && source.indexOf(title) !== -1) score += 4;

      (item.keywords || []).forEach(function (keyword) {
        var key = normalizeForMatch(keyword);
        if (key && source.indexOf(key) !== -1) score += 1;
      });

      if (score >= 4 && (!best || score > best.score)) {
        best = { item: item, score: score };
      }
    });

    return best ? best.item : null;
  }

  function wantsNoAnswers(text) {
    var source = String(text || '');
    return /(不要|不用|无需|别给|不显示|先别|只出题).{0,8}(答案|解析)/.test(source) ||
      /(只要|仅要|只给).{0,4}(题|题目)/.test(source) ||
      /(答案|解析).{0,4}(不要|不用|隐藏)/.test(source);
  }

  function wantsAnswers(text) {
    var source = String(text || '').trim();
    if (!source) return false;
    return /^(给出|给|补|显示|查看|需要|要)?\s*(答案|解析)/.test(source) ||
      /(给出|给|补|显示|查看|需要|要).{0,6}(答案|解析)/.test(source) ||
      /(答案|解析).{0,4}(呢|给我|补上|在哪)/.test(source);
  }

  function findLastQuestionSet() {
    for (var i = state.messages.length - 1; i >= 0; i -= 1) {
      var msg = state.messages[i];
      if (msg.role === 'ai' && !msg.noRetry && msg.intent !== 'answers' && msg.intent !== 'wrong' && Array.isArray(msg.questions) && msg.questions.length) {
        return msg;
      }
    }
    return null;
  }

  function findLastQuizSet() {
    var msg = findLastQuestionSet();
    if (msg && msg.quizKind === 'paper' && Array.isArray(msg.questions) && msg.questions.length) {
      return { messageId: msg.id, quizKind: 'paper', questions: msg.questions, quizTitle: msg.quizTitle || '' };
    }
    var sets = Array.isArray(state.quizSets) ? state.quizSets : [];
    for (var i = sets.length - 1; i >= 0; i -= 1) {
      var set = sets[i];
      if (set && set.quizKind === 'paper' && Array.isArray(set.questions) && set.questions.length) {
        return { messageId: set.messageId || '', quizKind: 'paper', questions: set.questions, quizTitle: '' };
      }
    }
    return null;
  }

  function migrateQuizKinds() {
    var kindById = {};
    (state.messages || []).forEach(function (msg) {
      if (!msg || msg.role !== 'ai' || !Array.isArray(msg.questions) || !msg.questions.length) return;
      if (!msg.quizKind) {
        var text = String(msg.quizTitle || '') + ' ' + String(msg.label || '') + ' ' + String(msg.content || '').slice(0, 200);
        msg.quizKind = /自测卷|自测题|一套题|考卷|试卷/.test(text) ? 'paper' : 'practice';
      }
      kindById[msg.id] = msg.quizKind;
    });
    (state.quizSets || []).forEach(function (set) {
      if (set && !set.quizKind) set.quizKind = kindById[set.messageId] || 'practice';
    });
  }

  async function appendAnswerSheet(questionSet, text) {
    appendUser(text);

    var msg = {
      id: uid(),
      role: 'ai',
      content: '',
      intent: 'answers',
      label: '答案解析',
      time: timeNow(),
      questions: questionSet.questions,
      quizTitle: questionSet.quizTitle || '',
      hideAnswers: false,
      answerFor: questionSet.id,
      noRetry: true,
      source: ''
    };

    state.messages.push(msg);
    var node = createAssistantNode(msg, true);
    persistCurrent();

    var payload = questionSet.questions.map(function (question) {
      return {
        number: question.number,
        type: question.type,
        q: question.q,
        options: question.options,
        answer: question.answer
      };
    });
    var prompt = '请根据以下题目数据给出答案与解析，逐题先给正确答案，再解释原因，不要重复题干：\n' + JSON.stringify(payload);
    var remote = null;
    try {
      remote = await ReviewAssistant.streamCustom(prompt, {
        intent: 'answers',
        label: '答案解析',
        forceRemote: true
      }, function (delta) {
        msg.content += delta;
        renderStreamBody(node, msg.content);
      });

      if (!remote || !remote.content) {
        msg.content = '';
        var answerBody = node.querySelector('.md-body');
        if (answerBody) answerBody.innerHTML = '';
        remote = await ReviewAssistant.streamCustom(prompt, {
          intent: 'answers',
          label: '答案解析',
          silent: true,
          forceRemote: true
        });
      }
    } catch (error) {
      if (error && error.isTimeout) {
        msg.content = '> 暂时加载失败，稍后再试。';
        msg.source = 'timeout';
        msg.noRetry = false;
        msg.retryKind = 'answers';
        msg.retryPayload = { questionSet: questionSet, text: '给出答案' };
        msg.error = null;
        finishAssistantNode(node, msg, false);
        scrollToBottom(true);
        persistCurrent();
        toast('暂时加载失败，稍后再试');
        return;
      }
      throw error;
    }

    if (remote && remote.content) {
      msg.content = remote.content;
      msg.source = 'remote';
      renderStreamBody(node, msg.content);
    } else {
      msg.content = '> 本地兜底：模型暂不可用，以下内容来自本地答案解析。\n\n' + ReviewAssistant.buildAnswerSheet(questionSet.questions, {
        title: questionSet.quizTitle || ''
      });
      msg.source = 'fallback';
      msg.error = { code: 'fallback', title: '模型服务异常', detail: '已使用本地答案解析（本地兜底）。', retryable: false };
    }

    finishAssistantNode(node, msg, false);
    scrollToBottom(true);
    persistCurrent();
    toast(remote && remote.content ? '已给出答案' : '已用本地答案解析');
  }

  function appendAnswerNotFound(text) {
    appendUser(text);

    var msg = {
      id: uid(),
      role: 'ai',
      content: '## 没有找到上一套题\n\n> 当前对话里还没有可补答案的题目。先让我出题，再说「给出答案」即可。',
      intent: 'answers',
      label: '答案解析',
      time: timeNow(),
      questions: [],
      hideAnswers: false
    };

    state.messages.push(msg);
    createAssistantNode(msg, false);
    scrollToBottom(true);
    persistCurrent();
    toast('当前没有可补答案的题目');
  }

  var CN_NUMBERS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

  function parseChineseNumber(value) {
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    if (value === '十') return 10;
    if (value.indexOf('十') !== -1) {
      var parts = value.split('十');
      var tens = parts[0] ? (CN_NUMBERS[parts[0]] || 0) : 1;
      var ones = parts[1] ? (CN_NUMBERS[parts[1]] || 0) : 0;
      return tens * 10 + ones;
    }
    return CN_NUMBERS[value] || 0;
  }

  function parseQuestionRef(text) {
    var source = String(text || '');
    if (/(生成|类似|出一道|来一道|一套题|自测|考卷|试卷)/.test(source)) return null;
    var match = source.match(/第\s*([一二三四五六七八九十百零两\d]+)\s*(?:道)?题/);
    if (!match) return null;

    var number = parseChineseNumber(match[1]);
    if (!number) return null;

    var userMatch = source.match(/(?:我选|选择了?|答案(?:是|为)?|为什么选|选)\s*([A-D])(?![A-Za-z])/i);
    return {
      number: number,
      userAnswer: userMatch ? userMatch[1].toUpperCase() : ''
    };
  }

  async function appendQuestionExplanation(questionSet, question, text, userAnswer) {
    appendUser(text);

    var cached = readExplainCacheItem(question, userAnswer);
    if (cached) {
      var cacheMsg = {
        id: uid(),
        role: 'ai',
        content: cached,
        intent: 'wrong',
        label: '错题解析',
        time: timeNow(),
        questions: [question],
        quizTitle: questionSet.quizTitle || '',
        hideAnswers: false,
        noRetry: true,
        source: 'remote',
        cached: true
      };
      state.messages.push(cacheMsg);
      createAssistantNode(cacheMsg, false);
      scrollToBottom(true);
      persistCurrent();
      toast('已使用缓存解析');
      return;
    }

    var msg = {
      id: uid(),
      role: 'ai',
      content: '',
      intent: 'wrong',
      label: '错题解析',
      time: timeNow(),
      questions: [question],
      quizTitle: questionSet.quizTitle || '',
      hideAnswers: false,
      noRetry: true,
      source: ''
    };

    state.messages.push(msg);
    var node = createAssistantNode(msg, true);
    persistCurrent();

    var prompt = '请解析这道题，先给结论，再逐项分析，最后给出知识点拆解和同类题建议：\n' +
      JSON.stringify({
        number: question.number,
        type: question.type,
        q: question.q,
        options: question.options,
        answer: question.answer,

        userAnswer: userAnswer || ''
      });
    var remote = null;
    try {
      remote = await ReviewAssistant.streamCustom(prompt, {
        intent: 'wrong',
        label: '错题解析',
        silent: true,
        forceRemote: true
      });
    } catch (error) {
      if (error && error.isTimeout) {
        msg.content = '> 暂时加载失败，稍后再试。';
        msg.source = 'timeout';
        msg.noRetry = false;
        msg.retryKind = 'wrong';
        msg.retryPayload = { questionSet: questionSet, question: question, text: text, userAnswer: userAnswer };
        msg.error = null;
        finishAssistantNode(node, msg, false);
        scrollToBottom(true);
        persistCurrent();
        toast('暂时加载失败，稍后再试');
        return;
      }
      throw error;
    }

    if (remote && remote.content) {
      msg.content = remote.content;
      msg.source = 'remote';
      renderStreamBody(node, msg.content);
      writeExplainCacheItem(question, userAnswer, remote.content);
    } else {
      msg.content = '> 本地兜底：模型暂不可用，以下内容来自本地解析。\n\n' + ReviewAssistant.buildQuestionExplanation(question, {
        number: question.number,
        userAnswer: userAnswer
      });
      msg.source = 'fallback';
      msg.error = { code: 'fallback', title: '模型服务异常', detail: '已使用本地解析（本地兜底）。', retryable: false };
    }

    finishAssistantNode(node, msg, false);
    scrollToBottom(true);
    persistCurrent();
    toast(remote && remote.content ? '已生成解析' : '已用本地解析');
  }

  function appendQuestionNotFound(text, number) {
    appendUser(text);

    var msg = {
      id: uid(),
      role: 'ai',
      content: '## 没有找到第 ' + number + ' 题\n\n> 当前对话里没有这套题，或者题号超出范围。请先让我出题，或直接把题干和选项粘贴过来。',
      intent: 'wrong',
      label: '错题解析',
      time: timeNow(),
      questions: [],
      noRetry: true
    };

    state.messages.push(msg);
    createAssistantNode(msg, false);
    scrollToBottom(true);
    persistCurrent();
    toast('没有找到对应题号');
  }

  function findKnowledge(id) {
    return getKnowledgeList().filter(function (item) {
      return item.id === id;
    })[0] || null;
  }

  var KNOWLEDGE_QUESTIONS_KEY = 'course-review-knowledge-questions-v1';

  function readKnowledgeQuestions() {
    try {
      var raw = localStorage.getItem(KNOWLEDGE_QUESTIONS_KEY);
      var store = raw ? JSON.parse(raw) : {};
      return store && typeof store === 'object' ? store : {};
    } catch (error) {
      return {};
    }
  }

  function writeKnowledgeQuestions(store) {
    var limited = {};
    Object.keys(store).forEach(function (key) {
      if (Array.isArray(store[key])) limited[key] = store[key].slice(0, 200);
    });
    return safeWriteJSON(KNOWLEDGE_QUESTIONS_KEY, limited);
  }

  function getKnowledgeQuestions(id) {
    var store = readKnowledgeQuestions();
    return Array.isArray(store[id]) ? store[id] : [];
  }

  function knowledgeQuestionCount(item) {
    var custom = getKnowledgeQuestions(item.id).length;
    var bank = window.QUESTION_BANK && item.topic ? window.QUESTION_BANK[item.topic] : null;
    var builtin = bank ? (bank.choices ? bank.choices.length : 0) + (bank.shorts ? bank.shorts.length : 0) : 0;
    return builtin + custom;
  }

  function openKnowledge() {
    renderKnowledgeList('');
    els.knowledgeTitle.textContent = '知识库';
    els.addKnowledgeBtn.style.display = '';
    els.knowledgeModal.classList.add('is-open');
    els.knowledgeModal.setAttribute('aria-hidden', 'false');
    closeDrawer();
    closeHistory();
    closeWrongbook();
  }

  function closeKnowledge() {
    els.knowledgeModal.classList.remove('is-open');
    els.knowledgeModal.setAttribute('aria-hidden', 'true');
    els.knowledgeTitle.textContent = '知识库';
    els.addKnowledgeBtn.style.display = '';
  }

  function openWrongSource() {
    var bookCount = readWrongbook().length;
    var quiz = findLastQuizSet();
    var wrongQuestions = quiz ? quiz.questions.filter(function (question) {
      return isQuestionInWrongbookForQuiz(question, quiz.messageId);
    }) : [];

    els.knowledgeTitle.textContent = '解析错题';
    els.addKnowledgeBtn.style.display = 'none';
    els.knowledgeBody.innerHTML = '<div class="wrong-source">' +
        '<button type="button" class="wrong-source-item" data-action="wrong-source-book">' +
          '<strong>从错题本选择</strong>' +
          '<span>' + (bookCount ? '已收藏 ' + bookCount + ' 道错题' : '错题本还是空的') + '</span>' +
        '</button>' +
        (wrongQuestions.length
          ? '<button type="button" class="wrong-source-item" data-action="wrong-source-quiz">' +
              '<strong>从当前自测卷选择</strong>' +
              '<span>当前自测卷错题 ' + wrongQuestions.length + ' 道</span>' +
            '</button>'
          : '') +
        '<button type="button" class="wrong-source-item" data-action="wrong-source-paste">' +
          '<strong>粘贴题目解析</strong>' +
          '<span>手动粘贴题干和选项</span>' +
        '</button>' +
      '</div>';

    els.knowledgeModal.classList.add('is-open');
    els.knowledgeModal.setAttribute('aria-hidden', 'false');
    closeDrawer();
    closeHistory();
    closeWrongbook();
  }

  function renderQuizSourceList() {
    var quiz = findLastQuizSet();
    var wrongItems = quiz ? quiz.questions.map(function (question) {
      var entry = wrongEntryForQuiz(question, quiz.messageId);
      return entry ? { question: question, entry: entry } : null;
    }).filter(Boolean) : [];
    if (!wrongItems.length) {
      toast('当前自测卷还没有错题');
      return;
    }

    var esc = MarkdownRenderer.escape;
    els.knowledgeBody.innerHTML = '<div class="wrong-source">' +
        wrongItems.map(function (item) {
          var question = item.question;
          var number = question.number || 0;
          var label = question.type === 'short' ? '简答' : question.type === 'judge' ? '判断' : '单选';
          var legacy = !item.entry.quizId;
          return '<button type="button" class="wrong-source-item" data-action="wrong-source-pick" data-number="' + number + '">' +
              '<strong>第 ' + number + ' 题 · ' + label + (legacy ? ' · 历史' : '') + '</strong>' +
              '<span>' + esc(question.q || '') + (legacy ? '（历史错题，来源无法区分）' : '') + '</span>' +
            '</button>';
        }).join('') +
      '</div>';
  }

  function onKnowledgeModalClick(event) {
    if (event.target === els.knowledgeModal) closeKnowledge();
  }

  var knowledgeComposing = false;

  function onKnowledgeSearchInput(event) {
    if (!event.target || event.target.id !== 'knowledgeSearch') return;
    if (knowledgeComposing || event.isComposing) return;
    renderKnowledgeList(event.target.value);
  }

  function onKnowledgeCompositionStart(event) {
    if (!event.target || event.target.id !== 'knowledgeSearch') return;
    knowledgeComposing = true;
  }

  function onKnowledgeCompositionEnd(event) {
    if (!event.target || event.target.id !== 'knowledgeSearch') return;
    knowledgeComposing = false;
    renderKnowledgeList(event.target.value);
  }

  function knowledgeSearchText(item) {
    return [
      item.course,
      item.chapter,
      item.title,
      item.topic,
      (item.keywords || []).join(' '),
      item.definition,
      (item.points || []).join(' '),
      (item.pitfalls || []).join(' '),
      item.content
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function renderKnowledgeList(keyword) {
    var esc = MarkdownRenderer.escape;
    var query = String(keyword || '').trim().toLowerCase();
    var list = getKnowledgeList();
    var groups = [];

    list.forEach(function (item) {
      if (query && knowledgeSearchText(item).indexOf(query) === -1) return;
      var group = groups.filter(function (entry) {
        return entry.course === item.course;
      })[0];
      if (!group) {
        group = { course: item.course, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    });

    var input = els.knowledgeBody.querySelector('#knowledgeSearch');
    if (!input) {
      els.knowledgeBody.innerHTML = '<div class="knowledge-search">' +
          '<input type="search" id="knowledgeSearch" placeholder="搜索课程、章节或知识点">' +
        '</div>' +
        '<div id="knowledgeResults"></div>' +
        '<p class="knowledge-tip">自定义知识点可先补充「要点 / 易错点」，再点「生成」得到更多题。</p>' +
        '<button type="button" class="knowledge-add" data-action="knowledge-add">+ 添加知识点</button>';
      input = els.knowledgeBody.querySelector('#knowledgeSearch');
    }

    var text = String(keyword || '');
    if (input && input.value !== text) input.value = text;

    var results = els.knowledgeBody.querySelector('#knowledgeResults');
    if (!results) return;

    if (!groups.length) {
      results.innerHTML = '<p class="history-empty">没有匹配的知识点。可以点下方「添加知识点」自己建一个。</p>';
      return;
    }

    results.innerHTML = groups.map(function (group) {
      return '<section class="knowledge-group">' +
          '<h3>' + esc(group.course) + '</h3>' +
          group.items.map(function (item) {
            var count = knowledgeQuestionCount(item);
            var custom = item.source === 'custom';
            return '<div class="knowledge-item">' +
                '<button type="button" class="knowledge-main" data-action="knowledge-outline" data-id="' + esc(item.id) + '">' +
                  '<strong>' + esc(item.title) + '</strong>' +
                  '<span>' + esc(item.chapter || '未分章节') + ' · ' + (count ? count + ' 道题' : '暂无题目') + (custom ? ' · 自定义' : '') + '</span>' +
                '</button>' +
                '<div class="knowledge-actions">' +
                  (custom ? '<button type="button" class="knowledge-gen" data-action="knowledge-generate" data-id="' + esc(item.id) + '">生成</button>' : '') +
                  '<button type="button" class="knowledge-quiz" data-action="knowledge-quiz" data-id="' + esc(item.id) + '">出题</button>' +
                  (custom ? '<button type="button" class="knowledge-del" data-action="knowledge-delete" data-id="' + esc(item.id) + '" aria-label="删除知识点">删除</button>' : '') +
                '</div>' +
              '</div>';
          }).join('') +
        '</section>';
    }).join('');
  }

  function renderKnowledgeForm() {
    els.knowledgeBody.innerHTML = '<form class="knowledge-form" id="knowledgeForm">' +
        '<label>课程<input name="course" required maxlength="40" placeholder="如 操作系统"></label>' +
        '<label>章节 / 分类<input name="chapter" maxlength="40" placeholder="如 第 3 章 进程管理"></label>' +
        '<label>知识点名称<input name="title" required maxlength="60" placeholder="如 进程调度"></label>' +
        '<label>关键词<input name="keywords" maxlength="120" placeholder="用逗号分隔，如 进程,线程,调度"></label>' +
        '<label>定义（用于生成单选、简答）<textarea name="definition" rows="2" maxlength="300" placeholder="如 进程调度是指从就绪队列中按策略选择进程并分配 CPU 的过程"></textarea></label>' +
        '<label>要点（每行一条，用于简答、判断）<textarea name="points" rows="4" maxlength="1500" placeholder="先来先服务；短作业优先；时间片轮转"></textarea></label>' +
        '<label>易错点 / 常见错误说法（每行一条，判断题会判为错误）<textarea name="pitfalls" rows="3" maxlength="1000" placeholder="如 进程调度等同于作业调度"></textarea></label>' +
        '<label>考点内容（可选，支持 Markdown）<textarea name="content" rows="6" maxlength="4000" placeholder="粘贴课件、笔记或考点提纲"></textarea></label>' +
        '<div class="knowledge-form-actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="knowledge-cancel">取消</button>' +
          '<button type="submit" class="btn btn--send">保存</button>' +
        '</div>' +
      '</form>';
  }

  function onKnowledgeSubmit(event) {
    event.preventDefault();
    var form = event.target;
    var course = String(form.elements.course.value || '').trim();
    var chapter = String(form.elements.chapter.value || '').trim();
    var title = String(form.elements.title.value || '').trim();
    var keywords = String(form.elements.keywords.value || '').split(/[,，、\s]+/).filter(Boolean);
    var definition = String(form.elements.definition.value || '').trim();
    var points = String(form.elements.points.value || '').split(/\n+/).map(function (line) {
      return line.replace(/^[\s\-*•]+/, '').trim();
    }).filter(Boolean);
    var pitfalls = String(form.elements.pitfalls.value || '').split(/\n+/).map(function (line) {
      return line.replace(/^[\s\-*•]+/, '').trim();
    }).filter(Boolean);
    var content = String(form.elements.content.value || '').trim();

    if (!course || !title) {
      toast('课程和知识点名称不能为空');
      return;
    }

    var list = readCustomKnowledge();
    if (list.length >= 100) {
      toast('自定义知识点最多 100 个，请先删除旧条目');
      return;
    }
    list.unshift({
      id: 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      course: course,
      chapter: chapter,
      title: title,
      keywords: keywords,
      definition: definition,
      points: points,
      pitfalls: pitfalls,
      content: content,
      source: 'custom',
      createdAt: Date.now()
    });

    if (!writeCustomKnowledge(list)) {
      toast('保存失败，浏览器存储可能已满');
      return;
    }

    renderKnowledgeList('');
    toast('已添加知识点');
  }

  function onKnowledgeBodyClick(event) {
    var btn = event.target.closest('[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');

    if (action === 'knowledge-add') {
      renderKnowledgeForm();
      return;
    }
    if (action === 'knowledge-cancel') {
      renderKnowledgeList('');
      return;
    }
    if (action === 'knowledge-delete') {
      deleteKnowledge(id);
      return;
    }
    if (action === 'knowledge-generate') {
      var target = findKnowledge(id);
      if (target) openKnowledgeGenerator(target);
      return;
    }
    if (action === 'knowledge-back') {
      backToKnowledgeList();
      return;
    }
    if (action === 'knowledge-generate-now') {
      generateKnowledgePreview();
      return;
    }
    if (action === 'knowledge-draft-remove') {
      removeKnowledgeDraft(parseInt(btn.getAttribute('data-index'), 10));
      return;
    }
    if (action === 'knowledge-save-questions') {
      saveKnowledgeDraft();
      return;
    }
    if (action === 'wrong-source-book') {
      closeKnowledge();
      openWrongbook();
      return;
    }
    if (action === 'wrong-source-quiz') {
      renderQuizSourceList();
      return;
    }
    if (action === 'wrong-source-paste') {
      closeKnowledge();
      focusInput('粘贴题目和选项，或说「第 3 题为什么选 B」');
      return;
    }
    if (action === 'wrong-source-pick') {
      var number = parseInt(btn.getAttribute('data-number'), 10);
      var quiz = findLastQuizSet();
      var question = quiz ? quiz.questions.filter(function (entry) {
        return entry.number === number;
      })[0] : null;
      closeKnowledge();
      if (quiz && question) {
        appendQuestionExplanation(quiz, question, '第 ' + number + ' 题为什么选 B');
      } else {
        toast('没有找到这道题');
      }
      return;
    }

    var item = findKnowledge(id);
    if (!item) {
      toast('这个知识点不存在');
      return;
    }

    if (action === 'knowledge-outline') sendKnowledge(item, 'outline');
    else if (action === 'knowledge-quiz') sendKnowledge(item, 'quiz', { hideAnswers: true });
  }

  function openKnowledgeGenerator(item) {
    var esc = MarkdownRenderer.escape;
    state.knowledgeEditingId = item.id;
    state.knowledgeDraft = null;

    var definition = window.KnowledgeTemplates.extractDefinition(item);
    var points = window.KnowledgeTemplates.extractPoints(item);
    var pitfalls = window.KnowledgeTemplates.extractPitfalls(item);

    els.knowledgeBody.innerHTML = '<div class="knowledge-generator">' +
        '<div class="knowledge-generator-head">' +
          '<strong>' + esc(item.title) + '</strong>' +
          '<span>' + esc(item.course) + (item.chapter ? ' · ' + esc(item.chapter) : '') + '</span>' +
        '</div>' +
        '<label>定义（用于单选、简答）<textarea id="kgDefinition" rows="2" maxlength="300">' + esc(definition) + '</textarea></label>' +
        '<label>要点（每行一条，用于简答、判断）<textarea id="kgPoints" rows="4" maxlength="1500">' + esc(points.join('\n')) + '</textarea></label>' +
        '<label>易错点 / 常见错误说法（每行一条，判断题会判为错误）<textarea id="kgPitfalls" rows="3" maxlength="1000">' + esc(pitfalls.join('\n')) + '</textarea></label>' +
        '<div class="knowledge-form-actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="knowledge-back">返回</button>' +
          '<button type="button" class="btn btn--send" data-action="knowledge-generate-now">生成预览</button>' +
        '</div>' +
        '<div class="knowledge-preview" id="knowledgePreview"></div>' +
      '</div>';
  }

  async function generateKnowledgePreview() {
    if (state.knowledgeGenerating) {
      toast('正在生成，请稍候');
      return;
    }
    state.knowledgeGenerating = true;
    var button = els.knowledgeBody.querySelector('[data-action="knowledge-generate-now"]');
    if (button) button.disabled = true;
    try {
      await generateKnowledgePreviewInner();
    } catch (error) {
      if (error && error.isTimeout) {
        var preview = els.knowledgeBody.querySelector('#knowledgePreview');
        if (preview) preview.innerHTML = '<p class="history-empty">暂时加载失败，稍后再试。</p>';
        state.knowledgeDraft = null;
        toast('暂时加载失败，稍后再试');
        return;
      }
      throw error;
    } finally {
      state.knowledgeGenerating = false;
      if (button) button.disabled = false;
    }
  }

  async function generateKnowledgePreviewInner() {
    var id = state.knowledgeEditingId;
    var list = readCustomKnowledge();
    var index = -1;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) {
        index = i;
        break;
      }
    }
    if (index < 0) {
      toast('知识点不存在');
      return;
    }

    var definition = String((els.knowledgeBody.querySelector('#kgDefinition') || {}).value || '').trim();
    var points = String((els.knowledgeBody.querySelector('#kgPoints') || {}).value || '').split(/\n+/).map(function (line) {
      return line.replace(/^[\s\-*•]+/, '').trim();
    }).filter(Boolean);
    var pitfalls = String((els.knowledgeBody.querySelector('#kgPitfalls') || {}).value || '').split(/\n+/).map(function (line) {
      return line.replace(/^[\s\-*•]+/, '').trim();
    }).filter(Boolean);

    list[index].definition = definition;
    list[index].points = points;
    list[index].pitfalls = pitfalls;
    writeCustomKnowledge(list);

    var item = list[index];
    var preview = els.knowledgeBody.querySelector('#knowledgePreview');
    if (preview) {
      preview.innerHTML = '<p class="history-empty">正在调用模型生成题目…</p>';
    }

    var prompt = '请根据以下知识点生成练习题，严格按系统要求只输出 <quiz> JSON 块：\n' + JSON.stringify({
      course: item.course,
      chapter: item.chapter || '',
      title: item.title,
      definition: definition,
      points: points,
      pitfalls: pitfalls
    }) + '\n要求：3-5 道，包含单选/判断/简答；选择题 4 个选项；必须给出 answer 和 analysis。';

    var questions = [];
    var localFallback = false;

    for (var attempt = 0; attempt < 2 && !questions.length; attempt += 1) {
      var remote = await ReviewAssistant.streamCustom(prompt, {
        intent: 'quiz',
        label: '知识点出题',
        silent: true,
        forceRemote: true
      });

      if (remote && remote.content) {
        var payload = ReviewAssistant.extractQuizPayload(remote.content);
        var normalized = payload ? ReviewAssistant.normalizeQuizPayload(payload, false) : null;
        if (normalized) questions = normalized.questions;
      }
    }

    if (!questions.length) {
      questions = window.KnowledgeTemplates.generate(item, getKnowledgeList(), window.QUESTION_BANK);
      localFallback = true;
      toast('模型暂不可用，已使用本地题库兜底');
    }

    if (state.knowledgeEditingId !== id) return;
    state.knowledgeDraft = { item: item, questions: questions, localFallback: localFallback };
    renderKnowledgePreview();

    if (!questions.length) {
      toast('信息不足，没能生成题目');
    } else {
      toast('已生成 ' + questions.length + ' 道题');
    }
  }

  function renderKnowledgePreview() {
    var draft = state.knowledgeDraft;
    var preview = els.knowledgeBody.querySelector('#knowledgePreview');
    if (!preview || !draft) return;

    var esc = MarkdownRenderer.escape;
    if (!draft.questions.length) {
      preview.innerHTML = '<p class="history-empty">没有生成题目。至少需要「定义」或「要点」；单选题还需要同课程其他知识点或题库提供干扰项。</p>';
      return;
    }

    preview.innerHTML = '<div class="knowledge-preview-head">' +
      (draft.localFallback ? '本地兜底（模型暂不可用） · ' : '模型生成 · ') +
      '已生成 ' + draft.questions.length + ' 道题，可移除不需要的再保存。</div>' +
      draft.questions.map(function (question, index) {
        var typeLabel = question.type === 'choice' ? '单选' : question.type === 'judge' ? '判断' : '简答';
        var options = (question.options && question.options.length)
          ? '<div class="knowledge-preview-options">' + question.options.map(function (option, optionIndex) {
              return '<span>' + String.fromCharCode(65 + optionIndex) + '. ' + esc(option) + '</span>';
            }).join('') + '</div>'
          : '';
        var answer = question.type === 'judge' ? (question.answer === 'A' ? '正确' : '错误') : question.answer;

        return '<article class="knowledge-preview-item">' +
            '<div class="knowledge-preview-meta">' +
              '<span class="tag">' + typeLabel + '</span>' +
              '<button type="button" data-action="knowledge-draft-remove" data-index="' + index + '">移除</button>' +
            '</div>' +
            '<p class="knowledge-preview-q">' + esc(question.q) + '</p>' +
            options +
            '<p class="knowledge-preview-answer">答案：' + esc(answer) + '</p>' +
            (question.analysis ? '<p class="knowledge-preview-analysis">' + esc(question.analysis) + '</p>' : '') +
          '</article>';
      }).join('') +
      '<div class="knowledge-form-actions">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-action="knowledge-back">返回</button>' +
        '<button type="button" class="btn btn--send" data-action="knowledge-save-questions">保存到知识库</button>' +
      '</div>';
  }

  function removeKnowledgeDraft(index) {
    if (!state.knowledgeDraft || !state.knowledgeDraft.questions.length) return;
    state.knowledgeDraft.questions.splice(index, 1);
    renderKnowledgePreview();
  }

  function saveKnowledgeDraft() {
    if (!state.knowledgeDraft || !state.knowledgeDraft.questions.length) {
      toast('没有可保存的题目');
      return;
    }

    var item = state.knowledgeDraft.item;
    var questions = state.knowledgeDraft.questions.slice();
    var store = readKnowledgeQuestions();

    store[item.id] = questions;
    if (!writeKnowledgeQuestions(store)) {
      toast('保存失败，浏览器存储可能已满');
      return;
    }

    state.knowledgeDraft = null;
    state.knowledgeEditingId = '';
    renderKnowledgeList('');
    toast('已保存，共 ' + questions.length + ' 道自定义题');
  }

  function backToKnowledgeList() {
    state.knowledgeDraft = null;
    state.knowledgeEditingId = '';
    renderKnowledgeList('');
  }

  function deleteKnowledge(id) {
    var list = readCustomKnowledge().filter(function (item) {
      return item.id !== id;
    });
    writeCustomKnowledge(list);
    var store = readKnowledgeQuestions();
    if (store[id]) {
      delete store[id];
      writeKnowledgeQuestions(store);
    }
    renderKnowledgeList('');
    toast('已删除知识点');
  }

  function quizRequestText(scope) {
    return '根据「' + scope + '」出 3 道题';
  }

  function sendKnowledge(item, mode, options) {
    var opts = options || {};
    if (state.busy) {
      toast('正在生成，请稍候');
      return;
    }
    closeKnowledge();
    setActiveKnowledge(item);

    var isQuiz = mode === 'quiz';
    var scope = '《' + item.course + '》' + (item.chapter ? item.chapter + ' · ' : '') + item.title;
    var knowledge = enrichKnowledge(item, isQuiz);
    var text = isQuiz ? quizRequestText(scope) : '帮我整理' + scope + '的考点';
    var label = isQuiz ? '习题生成' : '考点梳理';
    var plan = {
      primary: { id: isQuiz ? 'quiz' : 'outline', label: label },
      steps: [{ id: isQuiz ? 'quiz' : 'outline', label: label }],
      confidence: 'high',
      ranked: []
    };


    send(text, {
      plan: plan,
      steps: plan.steps,
      knowledge: knowledge,
      hideAnswers: opts.hideAnswers
    });
  }

  function openDrawer() {
    els.sidebar.classList.add('is-open');
    els.scrim.classList.add('is-open');
  }

  function closeDrawer() {
    els.sidebar.classList.remove('is-open');
    els.scrim.classList.remove('is-open');
  }

  function isNearBottom() {
    var list = els.messageList;
    return list.scrollHeight - list.scrollTop - list.clientHeight < 140;
  }

  function scrollToBottom(smooth) {
    els.messageList.scrollTo({
      top: els.messageList.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.focus();
      area.select();
      try {
        var ok = document.execCommand('copy');
        document.body.removeChild(area);
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (error) {
        document.body.removeChild(area);
        reject(error);
      }
    });
  }

  function history() {
    return state.messages.map(function (msg) {
      return {
        role: msg.role === 'ai' ? 'assistant' : 'user',
        content: msg.content
      };
    }).filter(function (item) {
      return item.content;
    }).slice(-8);
  }

  function isAbort(error) {
    return Boolean(error) && (error.name === 'AbortError' || error.code === 20);
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-show');
    }, 1900);
  }

  function uid() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function timeNow() {
    var now = new Date();
    return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();