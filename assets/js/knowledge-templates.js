(function (global) {
  'use strict';

  function normalize(text) {
    return String(text || '').replace(/[\s，。、；：（）()「」]/g, '').toLowerCase();
  }

  function unique(list) {
    var seen = {};
    return list.filter(function (item) {
      var key = normalize(item);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function similarity(left, right) {
    var a = normalize(left);
    var b = normalize(right);
    if (!a || !b) return 0;
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

    var pool = {};
    for (var i = 0; i < b.length - 1; i += 1) pool[b.slice(i, i + 2)] = true;

    var hits = 0;
    var total = 0;
    for (var j = 0; j < a.length - 1; j += 1) {
      total += 1;
      if (pool[a.slice(j, j + 2)]) hits += 1;
    }
    return total ? hits / total : 0;
  }

  function parseLines(text) {
    return unique(String(text || '').split(/\n+/).map(function (line) {
      return line.replace(/^[\s\-*•]+/, '').replace(/^\d+[.、]\s*/, '').trim();
    }).filter(Boolean));
  }

  function extractDefinition(item) {
    if (item.definition) return String(item.definition).trim();
    var content = String(item.content || '');
    var match = content.match(/([^\n。；]{2,40})(?:是指|指的是|定义为|是)([^\n。；]{2,120})/);
    if (match) return (match[1] + '是指' + match[2]).trim();

    var first = parseLines(content)[0];
    return first && first.length <= 120 ? first : '';
  }

  function extractPoints(item) {
    if (Array.isArray(item.points) && item.points.length) return unique(item.points);
    var lines = parseLines(item.content);
    return lines.filter(function (line) {
      return line.length <= 80;
    }).slice(0, 6);
  }

  function extractPitfalls(item) {
    if (Array.isArray(item.pitfalls) && item.pitfalls.length) return unique(item.pitfalls);
    return [];
  }

  function shuffle(items) {
    var list = items.slice();
    for (var i = list.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = list[i];
      list[i] = list[j];
      list[j] = temp;
    }
    return list;
  }

  function collectDistractors(item, allItems, bank, count) {
    var pool = [];

    (allItems || []).forEach(function (entry) {
      if (entry.id === item.id || entry.course !== item.course) return;
      var definition = extractDefinition(entry);
      if (definition) pool.push(definition);
    });

    if (bank) {
      Object.keys(bank).forEach(function (topic) {
        ((bank[topic] && bank[topic].choices) || []).forEach(function (question) {
          (question.options || []).forEach(function (option) {
            if (option && String(option).length <= 60) pool.push(option);
          });
        });
      });
    }

    var correct = normalize(extractDefinition(item));
    var result = [];

    unique(pool).forEach(function (candidate) {
      if (result.length >= count) return;
      if (normalize(candidate) === correct) return;
      if (similarity(candidate, correct) > 0.72) return;
      result.push(candidate);
    });

    return result;
  }

  function generateChoice(item, allItems, bank) {
    var definition = extractDefinition(item);
    if (!definition) return null;

    var distractors = collectDistractors(item, allItems, bank, 3);
    if (distractors.length < 2) return null;

    var options = shuffle([definition].concat(distractors).slice(0, 4));
    var answerIndex = options.indexOf(definition);
    if (answerIndex < 0) return null;

    return {
      type: 'choice',
      q: '下列关于「' + item.title + '」的说法，正确的是（　）。',
      options: options,
      answer: String.fromCharCode(65 + answerIndex),
      analysis: definition,
      source: 'template'
    };
  }

  function generateJudges(item) {
    var pitfalls = extractPitfalls(item);
    var points = extractPoints(item);
    var questions = [];

    pitfalls.slice(0, 3).forEach(function (pitfall) {
      questions.push({
        type: 'judge',
        q: '「' + item.title + '」：' + pitfall + '（　）',
        options: ['正确', '错误'],
        answer: 'B',
        analysis: '这是常见错误说法，请对照定义与要点辨析。',
        source: 'template'
      });
    });

    points.slice(0, 2).forEach(function (point) {
      questions.push({
        type: 'judge',
        q: '「' + item.title + '」：' + point + '（　）',
        options: ['正确', '错误'],
        answer: 'A',
        analysis: point,
        source: 'template'
      });
    });

    return questions;
  }

  function generateShort(item) {
    var definition = extractDefinition(item);
    var points = extractPoints(item);
    if (!definition && !points.length) return null;

    return {
      type: 'short',
      q: '简述「' + item.title + '」的定义与主要要点。',
      options: [],
      answer: [definition].concat(points).filter(Boolean).join('；'),
      analysis: '参考答案由知识点的定义与要点整理。',
      source: 'template'
    };
  }

  function validate(question) {
    if (!question || !question.q) return false;

    if (question.type === 'choice') {
      if (!/^[A-D]$/.test(question.answer)) return false;
      var index = question.answer.charCodeAt(0) - 65;
      var options = question.options || [];
      if (index < 0 || index >= options.length) return false;
      var keys = options.map(normalize);
      if (keys.some(function (key) { return !key; })) return false;
      if (new Set(keys).size !== keys.length) return false;
      if (options.length < 3) return false;
    }

    if (question.type === 'judge') {
      if (!question.options || question.options.length !== 2) return false;
      if (question.answer !== 'A' && question.answer !== 'B') return false;
    }

    if (question.type === 'short' && !question.answer) return false;
    return true;
  }

  function generate(item, allItems, bank) {
    var questions = [];
    var choice = generateChoice(item, allItems, bank);
    if (choice) questions.push(choice);
    questions = questions.concat(generateJudges(item));
    var shortQuestion = generateShort(item);
    if (shortQuestion) questions.push(shortQuestion);

    return questions.map(function (question, index) {
      question.id = 'tpl-' + Date.now().toString(36) + '-' + index;
      return question;
    }).filter(validate);
  }

  global.KnowledgeTemplates = {
    generate: generate,
    validate: validate,
    extractDefinition: extractDefinition,
    extractPoints: extractPoints,
    extractPitfalls: extractPitfalls
  };
})(window);