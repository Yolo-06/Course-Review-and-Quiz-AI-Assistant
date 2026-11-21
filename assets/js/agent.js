(function (global) {
  'use strict';

  var CONFIG = Object.assign({
    endpoint: '',
    model: 'codao-agent',
    timeout: 60000,
    stream: true,
    clientToken: '',
    minLatency: 550,
    maxLatency: 950
  }, global.ASSISTANT_CONFIG || {});

  var remoteState = { autoDisabled: false, retryAt: 0 };

  var SYSTEM_PROMPT = [
    '你是「课程复习刷题 AI 助教」，面向大学生课程复习场景。',
    '直接给出内容，不要寒暄、不要自我说明、不要复述用户原话。',
    '先判断任务类型，再按对应格式输出：',
    '1. 考点梳理：Markdown 分级标题 + 重点加粗 + 简洁条目，按章节组织，补充易错点与速记。',
    '2. 习题生成：只输出一个 <quiz>...</quiz> 块，块内是 JSON，不要输出任何其他文字，不要用代码围栏：',
    '{"quizTitle":"标题","questions":[{"number":1,"type":"choice","q":"题干","options":["A. ...","B. ...","C. ...","D. ..."],"answer":"A","analysis":"解析"}]}',
    'type 取 choice（单选）、judge（判断）、short（简答）；判断题 options 固定为 ["正确","错误"]；answer 单选填字母，判断题填「正确」或「错误」。',
    '3. 错题解析：Markdown，结论先行 → 逐项分析 → 知识点拆解 → 同类题迁移建议。',
    '4. 知识点对比：Markdown 表格，维度自拟，末尾给出结论或选型建议。',
    '5. 错题本整理：按「题干 → 错因 → 正确思路 → 关联知识点」汇总，并给出复习计划。',
    '6. 答案解析：逐题给出正确答案与解析，先答案后理由，不重复题干。',
    '题量规则：用户指定数量时严格遵守；未指定时按知识点容量给 3-5 道，不要为凑数编造低质量题。',
    '事实规则：不编造教材页码、版本或引用；不确定的内容标注「建议核对教材」。',
    '语言规则：中文作答，术语可保留英文缩写；面向考试，句子短、信息密度高。'
  ].join('\n');

  var INTENT_RULES = [
    {
      id: 'wrongbook',
      label: '错题本整理',
      strong: /(错题本|错题笔记|错题整理|汇总.*错题|收集.*错题|整理.*错题|错题.*(整理|汇总|成册))/,
      weak: /(整理|汇总|归档|笔记)/,
      weight: 4
    },
    {
      id: 'compare',
      label: '知识点对比',
      strong: /(对比|比较|区分|异同|不同点|vs\.?|VS)/,
      weak: /(区别|差异|不同)/,
      weight: 3
    },
    {
      id: 'wrong',
      label: '错题解析',
      strong: /(为什么选|为啥选|为什么是|错在哪|错题解析|解析(一下)?(这|该)?(道)?题|这道题|这题|帮我解释|答得好不好|优化(一下)?答案|答案.*(优化|改进)|第?\s*\d+\s*题[^。\n]{0,12}(错|选|答案|不会))/,
      weak: /(错题|解释|解析|得分|踩分|对不对)/,
      weight: 3
    },
    {
      id: 'quiz',
      label: '习题生成',
      strong: /(出\s*\d*\s*道|出题|生成.*题|自测题|自测|自测卷|一套题|考卷|考试卷|试卷|练习题|习题|单选|多选|简答|判断|\d+\s*道|\d+\s*题)/,
      weak: /(题|卷|考察|考考)/,
      weight: 3
    },
    {
      id: 'outline',
      label: '考点梳理',
      strong: /(考点|知识点|大纲|梳理|总结|归纳|提纲|重点)/,
      weak: /(复习|学习|掌握|框架)/,
      weight: 2
    }
  ];

  var TOPIC_LABELS = {
    database: '数据库原理',
    java: 'Java 面向对象',
    ds: '数据结构',
    os: '操作系统',
    net: '计算机网络',
    generic: '课程'
  };

  var BANK = global.QUESTION_BANK || {};

  var COMPARISONS = {
    thread: [
      '## 知识点对比 · 进程 vs 线程',
      '',
      '| 对比维度 | 进程 | 线程 |',
      '| --- | --- | --- |',
      '| 定义 | 资源分配的基本单位 | CPU 调度的基本单位 |',
      '| 地址空间 | 独立，互不共享 | 同一进程内共享 |',
      '| 切换开销 | 较大，需切换页表等上下文 | 较小，共享地址空间 |',
      '| 通信方式 | 管道、消息队列、共享内存等 IPC | 直接读写共享变量，需加锁同步 |',
      '| 独立性 | 一个进程崩溃通常不影响其他进程 | 一个线程崩溃可能拖垮整个进程 |',
      '| 典型场景 | 需要隔离的多任务，如浏览器多标签 | 同一任务内的高并发，如 IO 密集服务 |',
      '',
      '### 联系',
      '- 一个进程至少包含一个线程，线程是进程内的执行流。',
      '- 线程共享进程的堆与方法区，但每个线程有独立的栈和程序计数器。',
      '',
      '> **选型建议**：需要稳定隔离用多进程；同一任务内追求低开销高并发用多线程，并配合线程池与锁。'
    ],
    btree: [
      '## 知识点对比 · B 树 vs B+ 树',
      '',
      '| 对比维度 | B 树 | B+ 树 |',
      '| --- | --- | --- |',
      '| 数据存放位置 | 每个结点都存放数据 | 只有叶子结点存放数据 |',
      '| 叶子结点 | 彼此独立 | 通过链表顺序相连 |',
      '| 查询稳定性 | 不稳定，可能在内部结点命中 | 稳定，必须走到叶子结点 |',
      '| 范围查询 | 需中序遍历，效率较低 | 沿叶子链表扫描，效率高 |',
      '| 磁盘 IO | 相对较高 | 更低，结点可容纳更多索引项 |',
      '| 典型应用 | 文件系统 | MySQL InnoDB 索引 |',
      '',
      '### 联系',
      '- B+ 树是 B 树的变体，非叶子结点只存索引，不存数据。',
      '- 两者都是多路平衡查找树，树高低、磁盘访问次数少。',
      '',
      '> **选型建议**：需要范围查询与稳定查询性能的数据库索引选 B+ 树；文件系统等场景可用 B 树。'
    ],
    net: [
      '## 知识点对比 · TCP vs UDP',
      '',
      '| 对比维度 | TCP | UDP |',
      '| --- | --- | --- |',
      '| 连接方式 | 面向连接，需三次握手 | 无连接，直接发送 |',
      '| 可靠性 | 可靠，确认重传、按序到达 | 不可靠，可能丢包与乱序 |',
      '| 传输形式 | 字节流 | 数据报 |',
      '| 开销 | 较大，有握手、拥塞控制 | 较小，头部仅 8 字节 |',
      '| 实时性 | 较低 | 较高 |',
      '| 典型场景 | 网页、文件传输、邮件 | 视频直播、在线游戏、DNS |',
      '',
      '### 联系',
      '- 两者都工作在传输层，使用 IP 进行寻址与路由。',
      '- 应用层可基于 UDP 自行实现可靠性（如 QUIC）。',
      '',
      '> **选型建议**：数据完整性优先选 TCP；实时性与低延迟优先选 UDP。'
    ],
    javaType: [
      '## 知识点对比 · 接口 vs 抽象类',
      '',
      '| 对比维度 | 接口 interface | 抽象类 abstract class |',
      '| --- | --- | --- |',
      '| 继承关系 | 一个类可实现多个接口 | 一个类只能继承一个抽象类 |',
      '| 成员变量 | 默认 public static final 常量 | 可有普通成员变量 |',
      '| 方法 | 抽象方法 + default / static 方法 | 抽象方法 + 普通方法 |',
      '| 构造方法 | 没有 | 有，供子类调用 |',
      '| 设计意图 | 定义能力契约 | 抽取共性、复用代码 |',
      '| 访问修饰符 | 方法默认 public | 可使用 private / protected |',
      '',
      '### 联系',
      '- 两者都不能被直接实例化，都可以定义抽象方法。',
      '- 接口更强调「能做什么」，抽象类更强调「是什么」。',
      '',
      '> **选型建议**：跨类型的能力扩展用接口；有共享状态和公共实现时用抽象类。'
    ],
    stackImpl: [
      '## 知识点对比 · 顺序栈 vs 链栈',
      '',
      '| 对比维度 | 顺序栈 | 链栈 |',
      '| --- | --- | --- |',
      '| 存储结构 | 数组，连续内存 | 单链表，结点离散分布 |',
      '| 容量 | 固定，可能溢出 | 动态增长，不易溢出 |',
      '| 空间开销 | 可能预留浪费 | 需要额外指针域 |',
      '| 访问速度 | 快，缓存友好 | 相对较慢 |',
      '| 实现难度 | 简单 | 稍复杂，需管理指针 |',
      '| 适用场景 | 数据量可预估 | 数据量波动大 |',
      '',
      '### 联系',
      '- 两者都遵循 LIFO，基本操作时间复杂度均为 O(1)。',
      '- 链栈通常用头插头删实现，栈顶即链表头。',
      '',
      '> **选型建议**：容量稳定选顺序栈；频繁扩容或内存受限选链栈。'
    ]
  };

  function scoreRule(source, rule) {
    var strong = source.match(rule.strong);
    var weak = source.match(rule.weak);
    var score = 0;
    if (strong) score += rule.weight * 2;
    if (weak) score += 1;
    return {
      score: score,
      strong: Boolean(strong),
      index: strong ? strong.index : (weak ? weak.index : -1)
    };
  }

  function analyzeIntent(text) {
    var source = String(text || '');
    var hits = [];

    INTENT_RULES.forEach(function (rule) {
      var result = scoreRule(source, rule);
      if (result.score > 0) {
        hits.push({
          id: rule.id,
          label: rule.label,
          score: result.score,
          strong: result.strong,
          index: result.index
        });
      }
    });

    if (/(出题|命题).{0,6}(套路|规律|方法|技巧|思路|原则|模板)/.test(source)) {
      hits = hits.filter(function (item) {
        return item.id !== 'quiz';
      });
    }

    var looksLikeQuestion =
      /(^|\n)\s*A[.、．]/.test(source) &&
      /(^|\n)\s*B[.、．]/.test(source) &&
      /(^|\n)\s*C[.、．]/.test(source);
    var asksExplain = /(解析|讲解|为什么|为啥|怎么选|我选|选错|错了|答案|对不对|帮我看看|求解析)/.test(source);
    var asksGenerate = /(出|生成|来).{0,6}(题|卷)/.test(source);

    if (looksLikeQuestion && asksExplain && !asksGenerate) {
      return {
        primary: { id: 'wrong', label: '错题解析', score: 0, strong: true, index: 0 },
        steps: [{ id: 'wrong', label: '错题解析' }],
        confidence: 'high',
        ranked: []
      };
    }

    hits.sort(function (a, b) { return a.index - b.index; });

    var best = hits.slice().sort(function (a, b) { return b.score - a.score; })[0];

    if (!best || best.score < 2) {
      return {
        primary: { id: 'outline', label: '考点梳理', score: 0, strong: false, index: -1 },
        steps: [{ id: 'outline', label: '考点梳理' }],
        confidence: 'low',
        ranked: []
      };
    }

    var steps = [{ id: best.id, label: best.label }];
    var confidence = best.strong ? 'high' : 'low';

    if (best.id !== 'wrongbook' && /(再|然后|接着|并且|同时|最后|顺便)/.test(source)) {
      var ordered = hits.filter(function (item) {
        return item.strong || item.id === best.id;
      });
      if (ordered.length > 1) {
        steps = ordered.slice(0, 2).map(function (item) {
          return { id: item.id, label: item.label };
        });
        confidence = 'high';
      }
    }

    return {
      primary: steps[0],
      steps: steps,
      confidence: confidence,
      ranked: hits
    };
  }

  function detectIntent(text) {
    var plan = analyzeIntent(text);
    return { id: plan.primary.id, label: plan.primary.label };
  }

  function detectTopic(text) {
    var source = String(text || '');
    if (/(数据库|SQL|范式|ER\s*图|关系模式|事务|索引|主键)/i.test(source)) return 'database';
    if (/(Java|面向对象|封装|继承|多态|接口|抽象类|重写|重载)/i.test(source)) return 'java';
    if (/(栈|队列|线性表|链表|二叉树|哈希|排序|查找|数据结构)/.test(source)) return 'ds';
    if (/(进程|线程|死锁|调度|内存管理|操作系统)/.test(source)) return 'os';
    if (/(网络|TCP|UDP|HTTP|IP|协议|握手)/i.test(source)) return 'net';
    return 'generic';
  }

  function pickChapter(text) {
    var match = String(text).match(/第\s*([0-9一二三四五六七八九十]+)\s*章/);
    if (!match) return '';
    var map = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };
    var value = map[match[1]] || match[1];
    return '第 ' + value + ' 章';
  }

  function pad(number) {
    return number < 10 ? '0' + number : String(number);
  }

  function buildOutline(text, topic) {
    if (topic === 'database') {
      return [
        '## 《数据库原理》' + (pickChapter(text) || '第 4 章') + ' · 关系数据库设计（考点梳理）',
        '',
        '> 章节主线：**函数依赖 → 范式判定 → 模式分解**。考试多以「求候选码 + 判断范式 + 分解关系」组合出题。',
        '',
        '### 一、核心概念（必须会背）',
        '- **函数依赖**：X→Y 表示 X 的取值唯一确定 Y 的取值。',
        '- **完全 / 部分函数依赖**：看 X 的真子集能否决定 Y，能则为部分依赖。',
        '- **传递函数依赖**：X→Y、Y→Z 且 Y 不能决定 X。',
        '- **候选码**：能唯一标识元组且不含多余属性的属性组。',
        '- **主属性 / 非主属性**：包含在任一候选码中的属性为主属性。',
        '',
        '### 二、范式判定（高频）',
        '1. **1NF**：属性不可再分。',
        '2. **2NF**：在 1NF 基础上，**消除非主属性对码的部分函数依赖**。',
        '3. **3NF**：在 2NF 基础上，**消除非主属性对码的传递函数依赖**。',
        '4. **BCNF**：每个决定因素都包含候选码，**主属性之间的依赖也要检查**。',
        '',
        '### 三、解题步骤（背下来直接套）',
        '1. 写出全部函数依赖，标出**候选码**。',
        '2. 找出**非主属性**，检查部分依赖 → 判 2NF。',
        '3. 检查传递依赖 → 判 3NF。',
        '4. 检查每个决定因素是否包含候选码 → 判 BCNF。',
        '5. 分解后验证**无损连接**与**保持函数依赖**。',
        '',
        '### 四、易错提醒',
        '> - 「主属性」也可能造成 BCNF 违规，别只盯非主属性。',
        '> - 无损连接看的是自然连接后能否还原原关系，不是属性有没有重复。',
        '> - 分解后要**重新判断**子关系的范式，不能沿用原结论。',
        '',
        '### 五、30 秒速记',
        '**1NF 原子性 → 2NF 去部分依赖 → 3NF 去传递依赖 → BCNF 决定因素全是候选码。**'
      ].join('\n');
    }

    if (topic === 'java') {
      return [
        '## Java 面向对象 · 核心知识点梳理',
        '',
        '> 主线：**封装 → 继承 → 多态**。三大特性撑起面向对象，接口与抽象类是设计层面的高频考点。',
        '',
        '### 一、类与对象',
        '- **类**：抽象模板，描述属性（成员变量）与行为（方法）。',
        '- **对象**：类的实例，通过 `new` 在堆中分配内存。',
        '- **构造方法**：与类同名、无返回值，用于初始化，可重载。',
        '',
        '### 二、三大特性（必考）',
        '1. **封装**：私有化属性，提供 `getter / setter`，隐藏实现细节。',
        '2. **继承**：`extends` 单继承，子类复用父类成员，`super` 调用父类构造。',
        '3. **多态**：父类引用指向子类对象，运行时动态绑定；前提是**继承 + 重写 + 向上转型**。',
        '',
        '### 三、重载 vs 重写',
        '| 对比项 | 重载 Overload | 重写 Override |',
        '| --- | --- | --- |',
        '| 位置 | 同一个类中 | 父子类之间 |',
        '| 方法名 | 相同 | 相同 |',
        '| 参数列表 | 必须不同 | 必须相同 |',
        '| 绑定时机 | 编译期 | 运行期 |',
        '| 返回值 | 无关 | 兼容或协变 |',
        '',
        '### 四、接口与抽象类',
        '- **接口**：定义能力契约，可多实现；成员变量默认 `public static final`。',
        '- **抽象类**：抽取共性，可有构造器与普通方法；只能单继承。',
        '- 选择口诀：**「是不是」用抽象类，「有没有某种能力」用接口**。',
        '',
        '### 五、易错点',
        '> - 重写不能降低访问权限，不能抛出更宽的受检异常。',
        '> - `static`、`private`、`final` 方法不参与多态。',
        '> - 接口的 `default` 方法用于在不破坏实现类的前提下扩展接口。',
        '',
        '### 六、速记',
        '**封装藏细节，继承复代码，多态靠重写；接口定契约，抽象抽共性。**'
      ].join('\n');
    }

    if (topic === 'ds') {
      return [
        '## 数据结构 · 栈与队列考点梳理',
        '',
        '> 主线：**逻辑特性 → 存储实现 → 典型应用**。栈看 LIFO，队列看 FIFO。',
        '',
        '### 一、栈（Stack）',
        '- **特点**：后进先出（LIFO），只在栈顶插入与删除。',
        '- **基本操作**：`push`、`pop`、`top`，时间复杂度均为 O(1)。',
        '- **存储实现**：',
        '  - 顺序栈：数组 + `top` 指针，容量固定。',
        '  - 链栈：单链表头插头删，动态扩容。',
        '- **典型应用**：括号匹配、表达式求值、递归调用、撤销操作。',
        '',
        '### 二、队列（Queue）',
        '- **特点**：先进先出（FIFO），队尾入队、队头出队。',
        '- **循环队列**：用取模复用空间，牺牲一个单元区分空满。',
        '  - 队空：`front == rear`',
        '  - 队满：`(rear + 1) % MaxSize == front`',
        '- **典型应用**：打印机缓冲、任务调度、广度优先搜索。',
        '',
        '### 三、高频对比',
        '| 维度 | 栈 | 队列 |',
        '| --- | --- | --- |',
        '| 存取规则 | 后进先出 | 先进先出 |',
        '| 操作位置 | 栈顶 | 队头出、队尾入 |',
        '| 典型场景 | 递归、括号匹配 | 缓冲、BFS |',
        '',
        '### 四、易错提醒',
        '> - 出栈序列题一律用**模拟栈**验证，不要凭直觉。',
        '> - 循环队列的 `rear` 通常指向下一个空位，判满公式别写反。',
        '> - 共享栈让两端向中间增长，可提升空间利用率。',
        '',
        '### 五、速记',
        '**栈是叠盘子，队列是排队伍；一个后进先出，一个先进先出。**'
      ].join('\n');
    }

    var label = TOPIC_LABELS[topic] || TOPIC_LABELS.generic;
    return [
      '## 《' + label + '》复习框架',
      '',
      '> 你问的是「' + String(text).replace(/\s+/g, ' ').trim().slice(0, 30) + '」。下面给出一套可直接套用的复习骨架，把教材内容填进对应位置即可。',
      '',
      '### 一、先搭知识骨架',
      '- **核心概念**：用一句话定义每个名词，确保能复述。',
      '- **分类与结构**：画出章节思维导图，标出概念之间的上下位关系。',
      '- **公式与规则**：单独整理一页，注明适用条件。',
      '',
      '### 二、锁定高频考点',
      '1. **必背结论**：教材加粗、老师反复强调的内容。',
      '2. **典型例题**：每类题型至少吃透 2 道。',
      '3. **易错边界**：整理「什么情况下不适用」。',
      '',
      '### 三、复习节奏建议',
      '| 阶段 | 任务 | 产出 |',
      '| --- | --- | --- |',
      '| 一轮 | 通读 + 画框架 | 一页思维导图 |',
      '| 二轮 | 刷题 + 标错因 | 错题清单 |',
      '| 三轮 | 只看错题与结论 | 考前速记卡 |',
      '',
      '### 四、下一步',
      '> 告诉我具体课程与章节，我可以直接输出分级考点大纲、配套练习题和错题解析。'
    ].join('\n');
  }

  function hashString(input) {
    var hash = 2166136261;
    var text = String(input);
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    var state = seed >>> 0;
    return function () {
      state += 0x6D2B79F5;
      var value = Math.imul(state ^ (state >>> 15), 1 | state);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(items, seed) {
    var list = items.slice();
    var random = mulberry32(seed);
    for (var i = list.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var temp = list[i];
      list[i] = list[j];
      list[j] = temp;
    }
    return list;
  }

  function requestedCounts(text) {
    var source = String(text);
    var choiceMatch = source.match(/(\d+)\s*道?[^，。；\n\d]{0,10}?(?:单项选择|单选题|单选|选择题)/);
    var shortMatch = source.match(/(\d+)\s*道?[^，。；\n\d]{0,10}?(?:简答|问答)/);
    var totalMatch = source.match(/一套\s*(\d+)\s*(?:道)?\s*题/) || source.match(/(\d+)\s*(?:道)?\s*题/);
    var mentionsChoice = /(单项选择|单选题|单选|选择题)/.test(source);
    var mentionsShort = /(简答|问答)/.test(source);

    var result = {
      choice: choiceMatch ? parseInt(choiceMatch[1], 10) : 0,
      short: shortMatch ? parseInt(shortMatch[1], 10) : 0,
      explicit: Boolean(choiceMatch || shortMatch || totalMatch)
    };

    if (!result.choice && !result.short) {
      if (!totalMatch) {
        result.choice = 5;
        result.short = 2;
        return result;
      }
      var total = parseInt(totalMatch[1], 10);
      result.short = total >= 8 ? 2 : 1;
      result.choice = Math.max(1, total - result.short);
      return result;
    }

    if (!result.choice) result.choice = mentionsShort && !mentionsChoice ? 0 : 5;
    if (!result.short) result.short = mentionsChoice && !mentionsShort ? 0 : 2;

    return result;
  }

  function buildQuizResult(text, topic, variant, hideAnswers) {
    var bank = BANK[topic];

    if (!bank || !bank.choices || !bank.choices.length) {
      return {
        content: '## 题库暂未覆盖这个范围\n\n> 当前题库没有「' + (TOPIC_LABELS[topic] || topic || '该主题') + '」的配套题目，不会用通用卷代替。可以在知识库添加该知识点并生成模板题，或换一个已收录的范围。',
        questions: []
      };
    }

    var counts = requestedCounts(text);
    var seed = hashString(topic + '|' + String(text)) + (variant || 0) * 7919;
    var choicePool = seededShuffle(bank.choices, seed);
    var shortPool = seededShuffle(bank.shorts, seed + 101);
    var choices = choicePool.slice(0, Math.min(counts.choice, choicePool.length));
    var shorts = shortPool.slice(0, Math.min(counts.short, shortPool.length));
    var parts = [];

    parts.push('## ' + bank.title);
    parts.push('');
    parts.push('> ' + bank.subtitle);
    parts.push('');
    parts.push('> 本次共 **' + (choices.length + shorts.length) + ' 题**：单选 ' + choices.length + ' 道 + 简答 ' + shorts.length + ' 道。');
    if (hideAnswers) {
      parts.push('> 本次只出题，答案与解析已隐藏；点「给出答案」查看。');
    }

    var notes = [];
    if (counts.choice > bank.choices.length) {
      notes.push('你要求 ' + counts.choice + ' 道单选，题库当前收录 ' + bank.choices.length + ' 道，已全部给出。');
    }
    if (counts.short > bank.shorts.length) {
      notes.push('你要求 ' + counts.short + ' 道简答，题库当前收录 ' + bank.shorts.length + ' 道，已全部给出。');
    }
    if (notes.length) {
      parts.push('>');
      parts.push('> 提示：' + notes.join(' '));
    }
    parts.push('');
    if (choices.length) {
      parts.push('### 一、单项选择题（每题 10 分）');
      parts.push('');

      choices.forEach(function (item, index) {
        parts.push('**' + (index + 1) + '. ' + item.q + '**');
        item.options.forEach(function (option, optionIndex) {
          parts.push('- ' + String.fromCharCode(65 + optionIndex) + '. ' + option);
        });
        parts.push('');
      });
    }

    if (shorts.length) {
      parts.push('### ' + (choices.length ? '二、' : '一、') + '简答题（每题 25 分）');
      parts.push('');

      shorts.forEach(function (item, index) {
        parts.push('**' + (choices.length + index + 1) + '. ' + item.q + '**');
        parts.push('');
      });
    }

    if (!hideAnswers) {
      parts.push('---');
      parts.push('');
      parts.push('## 参考答案与详细解析');
      parts.push('');

      if (choices.length) {
        parts.push('### 单项选择题');
        parts.push('');

        choices.forEach(function (item, index) {
          parts.push('**' + (index + 1) + '. 答案：' + item.answer + '**');
          parts.push('');
          parts.push('解析：' + item.analysis);
          parts.push('');
        });
      }

      if (shorts.length) {
        parts.push('### 简答题');
        parts.push('');

        shorts.forEach(function (item, index) {
          parts.push('**' + (choices.length + index + 1) + '. 参考答案要点**');
          parts.push('');
          item.points.forEach(function (point) {
            parts.push('- ' + point);
          });
          parts.push('');
        });
      }

      parts.push('---');
      parts.push('');
      parts.push('> 做完后把错题发给我，我可以按「错因 → 正确思路 → 关联知识点」整理进错题本。');
    } else {
      parts.push('> 需要答案时直接说「给出答案」，我会补上。');
    }

    var questions = choices.map(function (item, index) {
      return {
        number: index + 1,
        type: 'choice',
        q: item.q,
        options: item.options.slice(),
        answer: item.answer,
        analysis: item.analysis
      };
    }).concat(shorts.map(function (item, index) {
      return {
        number: choices.length + index + 1,
        type: 'short',
        q: item.q,
        options: [],
        answer: item.points.join('；'),
        analysis: '参考答案要点见上方解析区。'
      };
    }));

    var totalCount = (bank.choices ? bank.choices.length : 0) + (bank.shorts ? bank.shorts.length : 0);

    return {
      content: parts.join('\n'),
      questions: questions,
      canRegenerate: totalCount > questions.length
    };
  }


  function buildCompare(text) {
    var source = String(text);
    var key = '';

    if (/(进程|线程)/.test(source)) key = 'thread';
    else if (/B\+?\s*树|B\s*树/i.test(source)) key = 'btree';
    else if (/(TCP|UDP)/i.test(source)) key = 'net';
    else if (/(接口|抽象类)/.test(source)) key = 'javaType';
    else if (/(顺序栈|链栈)/.test(source)) key = 'stackImpl';

    if (key && COMPARISONS[key]) {
      return COMPARISONS[key].join('\n');
    }

    return [
      '## 知识点对比 · 通用对比框架',
      '',
      '> 暂未匹配到内置的高频对比组合。下面给出统一的对比维度，把两个概念代入即可；也可以直接告诉我具体名称，我会生成更精确的表格。',
      '',
      '### 一、对比维度',
      '| 维度 | 概念 A | 概念 B |',
      '| --- | --- | --- |',
      '| 定义 | 用一句话说明本质 | 用一句话说明本质 |',
      '| 所属范畴 | 属于哪一章节、哪一类 | 属于哪一章节、哪一类 |',
      '| 核心特征 | 2-3 个关键词 | 2-3 个关键词 |',
      '| 典型应用 | 常见使用场景 | 常见使用场景 |',
      '| 常见考点 | 考试怎么问 | 考试怎么问 |',
      '| 易混点 | 最容易混的地方 | 最容易混的地方 |',
      '',
      '### 二、怎么用这张表',
      '1. 先写**定义**，确保两个概念不在同一层级。',
      '2. 再找**差异最大的 2-3 个维度**，考试通常只考这些。',
      '3. 最后补**联系**：谁包含谁、谁依赖谁、能否相互替代。',
      '',
      '### 三、内置高频对比',
      '> 进程 vs 线程、B 树 vs B+ 树、TCP vs UDP、接口 vs 抽象类、顺序栈 vs 链栈。直接说「对比 A 和 B」即可。'
    ].join('\n');
  }

  function normalizeText(input) {
    return String(input || '')
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
      })
      .toLowerCase()
      .replace(/[^0-9a-z\u4e00-\u9fa5]/g, '');
  }

  function charBigrams(input) {
    var text = normalizeText(input);
    var grams = [];
    for (var i = 0; i < text.length - 1; i += 1) {
      grams.push(text.slice(i, i + 2));
    }
    if (!grams.length && text) grams.push(text);
    return grams;
  }

  function coverage(needle, haystack) {
    var target = charBigrams(needle);
    if (!target.length) return 0;
    var pool = {};
    charBigrams(haystack).forEach(function (gram) {
      pool[gram] = true;
    });
    var hit = 0;
    target.forEach(function (gram) {
      if (pool[gram]) hit += 1;
    });
    return hit / target.length;
  }

  function extractUserAnswer(text) {
    var match = String(text || '').match(/(?:我选|选择了?|答案(?:是|为)?|选)\s*([A-D])(?![A-Za-z])/i);
    return match ? match[1].toUpperCase() : '';
  }

  function readCustomQuestionBank() {
    try {
      var raw = localStorage.getItem('course-review-knowledge-questions-v1');
      var store = raw ? JSON.parse(raw) : {};
      return store && typeof store === 'object' ? store : {};
    } catch (error) {
      return {};
    }
  }

  function findQuestionInBank(text) {
    var best = null;
    var source = String(text || '');
    var hasOptionsInInput = /(^|\n)\s*A[.、．]/.test(source) && /(^|\n)\s*B[.、．]/.test(source);

    Object.keys(BANK).forEach(function (topic) {
      var bank = BANK[topic];
      if (!bank) return;

      (bank.choices || []).forEach(function (item, index) {
        var stem = coverage(item.q, source);
        var optionHits = 0;
        (item.options || []).forEach(function (option) {
          if (coverage(option, source) >= 0.6) optionHits += 1;
        });
        var optionScore = item.options && item.options.length ? optionHits / item.options.length : 0;
        var score = stem * 0.75 + optionScore * 0.25;
        var passes = hasOptionsInInput ? (stem >= 0.7 && optionScore >= 0.3) : (stem >= 0.78);

        if (passes && (!best || score > best.score)) {
          best = {
            type: 'choice',
            topic: topic,
            bank: bank,
            number: index + 1,
            item: item,
            score: score
          };
        }
      });

      (bank.shorts || []).forEach(function (item, index) {
        var stem = coverage(item.q, source);
        if (stem >= 0.78 && (!best || stem > best.score)) {
          best = {
            type: 'short',
            topic: topic,
            bank: bank,
            number: (bank.choices ? bank.choices.length : 0) + index + 1,
            item: item,
            score: stem
          };
        }
      });
    });

    var customStore = readCustomQuestionBank();
    Object.keys(customStore).forEach(function (knowledgeId) {
      var list = customStore[knowledgeId];
      if (!Array.isArray(list)) return;

      list.forEach(function (item, index) {
        var stem = coverage(item.q, source);
        var options = item.options || [];
        var optionHits = 0;
        options.forEach(function (option) {
          if (coverage(option, source) >= 0.6) optionHits += 1;
        });
        var optionScore = options.length ? optionHits / options.length : 0;
        var score = stem * 0.75 + optionScore * 0.25;
        var passes = hasOptionsInInput ? (stem >= 0.7 && optionScore >= 0.3) : (stem >= 0.78);

        if (passes && (!best || score > best.score)) {
          best = {
            type: item.type || 'choice',
            topic: 'custom',
            bank: { title: '自定义知识库', choices: [], shorts: [] },
            number: index + 1,
            item: item,
            score: score
          };
        }
      });
    });

    return best;
  }

  function buildMatchedWrong(match, text) {
    var item = match.item;
    var bank = match.bank || {};
    var bankName = (bank.title || '题库').split('·')[0].trim();
    var parts = [];

    parts.push('## 错题解析 · 已定位题库原题');
    parts.push('');
    parts.push('> 在「' + (bank.title || bankName) + '」第 ' + match.number + ' 题找到匹配。');
    parts.push('');
    parts.push('### 题目');
    parts.push('**' + match.number + '. ' + item.q + '**');
    parts.push('');

    if (match.type === 'choice' || match.type === 'judge') {
      (item.options || []).forEach(function (option, index) {
        parts.push('- ' + String.fromCharCode(65 + index) + '. ' + option);
      });
      parts.push('');

      var answerIndex = item.answer ? item.answer.charCodeAt(0) - 65 : -1;
      var answerText = item.options && item.options[answerIndex] !== undefined ? item.options[answerIndex] : '';
      parts.push('### 正确答案');
      if (match.type === 'judge') {
        parts.push('**' + (item.answer === 'A' ? '正确' : '错误') + '**');
      } else {
        parts.push('**' + item.answer + (answerText ? '. ' + answerText : '') + '**');
      }
      parts.push('');

      var userAnswer = extractUserAnswer(text);
      if (userAnswer) {
        parts.push('### 你的答案');
        parts.push('- 你选择：**' + userAnswer + '**');
        parts.push('- 判断：**' + (userAnswer === item.answer ? '正确' : '错误') + '**');
        parts.push('');
      }

      parts.push('### 解析');
      parts.push(item.analysis || '建议核对教材对应小节。');
      parts.push('');

      var others = [];
      (item.options || []).forEach(function (option, index) {
        var letter = String.fromCharCode(65 + index);
        if (letter !== item.answer) others.push(letter + '. ' + option);
      });
      if (others.length) {
        parts.push('### 其他选项');
        parts.push('> ' + others.join('；') + '。这些选项与正确答案不符，对照上面的解析理解即可。');
        parts.push('');
      }

      parts.push('### 易错提醒');
      parts.push('- 先抓住题干的关键限定词，再看选项是否偷换了概念。');
      parts.push('- 本题正确项是 **' + item.answer + '**，把理由和题目一起记，而不是只记答案。');
      parts.push('');
      parts.push('### 下一步');
      parts.push('> 需要的话我可以再出 3 道同类题，直接说「出 3 道' + bankName + '的题」即可。');
    } else {
      parts.push('### 参考答案要点');
      (item.points || []).forEach(function (point) {
        parts.push('- ' + point);
      });
      parts.push('');
      parts.push('### 下一步');
      parts.push('> 需要的话我可以把这道题再展开成要点清单。');
    }

    return parts.join('\n');
  }

  function buildWrong(text, topic) {
    var source = String(text || '');
    var isShortReview = /(简答|答得好不好|答案.*(优化|改进)|优化.*答案|得分|踩分)/.test(source);
    var match = findQuestionInBank(source);

    if (match && !(isShortReview && match.type === 'choice')) {
      return buildMatchedWrong(match, source);
    }

    if (isShortReview) return buildShortAnswerReview();
    if (topic === 'database') return wrongDatabase();
    if (topic === 'ds') return wrongStack();
    if (topic === 'java') return wrongJava();
    return wrongGeneric();
  }

  function wrongStack() {
    return [
      '## 错题解析 · 栈的出栈序列',
      '',
      '> 题库里没有找到这道原题，先给你这类题的通用判断方法；把完整题干和选项发我，也可以直接代入。',
      '',
      '### 一、结论先行',
      '判断出栈序列是否合法，只需**模拟栈**：按入栈顺序依次压栈，栈顶等于目标序列当前元素时弹出，最后能全部弹出即合法。',
      '',
      '### 二、为什么容易错',
      '很多同学凭感觉判断，忽略了**已入栈但未出栈的元素仍然压在栈里**，导致顺序判断错误。',
      '',
      '### 三、模拟验证示例',
      '入栈顺序 `1 2 3 4`，判断出栈序列 `3 1 4 2`：',
      '',
      '| 步骤 | 操作 | 栈内（底 → 顶） | 已输出 |',
      '| --- | --- | --- | --- |',
      '| 1 | 1 入栈 | 1 | — |',
      '| 2 | 2 入栈 | 1 2 | — |',
      '| 3 | 3 入栈 | 1 2 3 | — |',
      '| 4 | 3 出栈 | 1 2 | 3 |',
      '| 5 | 目标下一个是 1，但栈顶是 2 | 1 2 | 3 |',
      '',
      '**栈顶为 2、无法先输出 1，因此该序列不合法。**',
      '',
      '### 四、涉及知识点',
      '- 栈的 LIFO 特性与基本操作',
      '- 入栈 / 出栈操作序列的合法性判断',
      '- n 个元素的合法出栈序列数为卡特兰数 `C(2n,n)/(n+1)`',
      '',
      '### 五、同类题迁移',
      '> 遇到「哪个出栈序列不可能」的题，一律画栈逐步模拟，不要心算。',
      '',
      '### 六、下一步',
      '把完整题干和你的选项发我，我会逐项排除，并说明每个错误选项的陷阱。'
    ].join('\n');
  }

  function wrongDatabase() {
    return [
      '## 错题解析 · 范式判定',
      '',
      '### 一、结论先行',
      '判断范式只做三件事：**找候选码 → 找非主属性 → 看依赖类型**。',
      '',
      '### 二、标准流程',
      '1. 写出全部函数依赖。',
      '2. 求候选码：能推出全部属性的最小属性组。',
      '3. 区分主属性与非主属性。',
      '4. 查部分依赖判 2NF，查传递依赖判 3NF，查决定因素判 BCNF。',
      '',
      '### 三、易错点',
      '| 易错点 | 正确理解 |',
      '| --- | --- |',
      '| 只盯非主属性 | BCNF 还要检查主属性之间的依赖 |',
      '| 把无损连接当成保持依赖 | 两者性质不同，分解可能只满足其一 |',
      '| 分解后不重新判范式 | 每个子关系都要单独判断 |',
      '',
      '### 四、典型例题',
      '关系模式 R(A,B,C)，F={A→B, B→C}：',
      '- 候选码：**A**（A 能推出 B 和 C，且不可再分）。',
      '- 非主属性：B、C；A 是单属性码，不存在部分依赖，满足 2NF。',
      '- 存在 A→B→C 的**传递依赖**，不满足 3NF。',
      '- 结论：**R ∈ 2NF，但不属于 3NF**。',
      '',
      '### 五、下一步',
      '把你的题干和函数依赖发我，我按这套流程逐步判定。'
    ].join('\n');
  }

  function wrongJava() {
    return [
      '## 错题解析 · Java 多态',
      '',
      '### 一、结论先行',
      '多态三前提：**继承、方法重写、父类引用指向子类对象**。缺一个都不会发生运行时动态绑定。',
      '',
      '### 二、逐项分析',
      '| 写法 | 判断 | 原因 |',
      '| --- | --- | --- |',
      '| 父类引用 = 子类对象 | 合法，体现多态 | 编译看左边，运行看右边 |',
      '| 子类引用 = 父类对象 | 编译不通过 | 需要强制转型，且可能抛出 ClassCastException |',
      '| static 方法 | 不参与多态 | 属于类，编译期绑定 |',
      '| private 方法 | 不能重写 | 子类同名方法只是新方法 |',
      '',
      '### 三、涉及知识点',
      '- 向上转型与向下转型',
      '- 方法重写规则（访问权限、异常声明）',
      '- `instanceof` 判断与强制类型转换',
      '',
      '### 四、记忆口诀',
      '**编译看左边，运行看右边；静态和私有，通通不多态。**',
      '',
      '### 五、下一步',
      '把题目代码贴给我，我可以逐行标注输出结果。'
    ].join('\n');
  }

  function wrongGeneric() {
    return [
      '## 错题解析 · 四步拆解法',
      '',
      '> 题库里没有找到这道原题，先用这套通用方法定位问题；把完整题干和选项发我，我可以给出精确解析。',
      '',
      '### 一、结论先行',
      '错题不是「记住答案」，而是找到**错误的思维路径**。',
      '',
      '### 二、四步拆解',
      '1. **审题**：圈出限制条件、否定词与关键数据。',
      '2. **定位考点**：这道题考的是哪个定义、公式或规则。',
      '3. **逐项排除**：每个选项都写出「对在哪里 / 错在哪里」。',
      '4. **同类迁移**：换一个条件，能否仍用同一方法解决。',
      '',
      '### 三、错因分类',
      '| 错因 | 典型表现 | 对策 |',
      '| --- | --- | --- |',
      '| 概念混淆 | 定义记混、适用条件不清 | 回到教材原文，做概念对比表 |',
      '| 审题疏漏 | 漏看「不正确」「最多」等关键词 | 答题前先圈关键词 |',
      '| 计算失误 | 步骤正确但结果错误 | 单独检查计算过程 |',
      '| 方法不会 | 完全没思路 | 先看解析，再独立重做一遍 |',
      '',
      '### 四、下一步',
      '把题干、你的答案和正确答案发我，我会按这四步给出完整解析。'
    ].join('\n');
  }

  function buildShortAnswerReview() {
    return [
      '## 简答题答案优化',
      '',
      '### 一、评分维度（阅卷老师看什么）',
      '| 维度 | 权重 | 关注点 |',
      '| --- | --- | --- |',
      '| 概念准确 | 40% | 术语是否用对、定义是否完整 |',
      '| 要点齐全 | 30% | 是否覆盖踩分点 |',
      '| 逻辑结构 | 20% | 是否分点、有层次 |',
      '| 表达规范 | 10% | 是否简洁、无口语化 |',
      '',
      '### 二、常见失分原因',
      '- 只写结论，没有展开关键词。',
      '- 要点堆在一起，阅卷老师找不到踩分点。',
      '- 举例与概念不匹配，反而暴露理解偏差。',
      '',
      '### 三、优化模板',
      '> **定义**：……是指……。',
      '> **特点 / 分类**：①……；②……；③……。',
      '> **作用 / 应用**：……。',
      '> **小结**：因此……。',
      '',
      '### 四、示例优化',
      '**原答案**：多态就是同一个方法有不同的表现。',
      '',
      '**优化后**：多态是指父类引用指向子类对象时，调用被重写的方法会根据对象的实际类型在运行时动态绑定，从而表现出不同行为。实现前提是继承、方法重写与向上转型。',
      '',
      '### 五、得分点清单',
      '- [ ] 是否写出核心定义',
      '- [ ] 是否分点列出特征',
      '- [ ] 是否给出应用或例子',
      '- [ ] 是否用术语而非口语',
      '',
      '### 六、下一步',
      '把你的原答案发我，我会按踩分点逐条标注，并给出改写版本。'
    ].join('\n');
  }

  function buildKnowledgeOutline(knowledge) {
    var item = knowledge || {};
    var course = item.course || '课程';
    var chapter = item.chapter ? item.chapter + ' · ' : '';
    var keywords = Array.isArray(item.keywords) ? item.keywords.filter(Boolean) : [];
    var parts = [];

    parts.push('## 《' + course + '》' + chapter + (item.title || '知识点') + ' · 考点梳理');
    parts.push('');

    if (item.source === 'custom') {
      parts.push('> 来自自定义知识库' + (keywords.length ? ' · 关键词：' + keywords.join('、') : ''));
      parts.push('');

      var definition = String(item.definition || '').trim();
      var points = Array.isArray(item.points) ? item.points.filter(Boolean) : [];

      if (definition || points.length) {
        parts.push('### 一、核心定义');
        if (definition) parts.push(definition);
        parts.push('');

        if (points.length) {
          parts.push('### 二、要点');
          points.forEach(function (point) {
            parts.push('- ' + point);
          });
          parts.push('');
        }

        if (item.content) {
          parts.push('### 三、补充内容');
          parts.push(String(item.content).trim());
          parts.push('');
        }

        parts.push('### 复习建议');
        parts.push('- 按「定义 → 要点 → 例题」三层复述。');
        parts.push('- 能不看笔记说出定义和至少 2 个要点，再进入做题。');
        parts.push('');
        parts.push('> 想练题的话，点条目右侧「生成」或「出题」。');
      } else if (item.content) {
        parts.push('### 一、考点内容');
        parts.push(String(item.content).trim());
        parts.push('');
        parts.push('### 二、复习建议');
        parts.push('- 按「概念 → 判断 → 例题」三层整理上面的内容。');
        parts.push('- 先复述定义，再遮住答案自测关键结论。');
        parts.push('');
        parts.push('### 三、下一步');
        parts.push('> 在知识库中补充定义与要点后，可以按模板生成练习题。');
      } else {
        parts.push('### 一、复习框架');
        parts.push('- **核心概念**：补充这个知识点的定义与分类。');
        parts.push('- **常见考法**：补充对应的选择题、简答题问法。');
        parts.push('- **易错点**：记录容易混淆的地方。');
        parts.push('');
        parts.push('### 二、下一步');
        parts.push('> 在知识库中补充定义或要点，就能生成更具体的提纲和模板题。');
      }

      return parts.join('\n');
    }

    var topic = item.topic || detectTopic(course + ' ' + (item.chapter || '') + ' ' + (item.title || ''));
    return buildOutline(course + ' ' + (item.chapter || '') + ' ' + (item.title || ''), topic);
  }

  function buildQuizFromCustom(knowledge, variant, hideAnswers, counts) {
    var questions = (knowledge.customQuestions || []).slice();
    if (!questions.length) return null;

    var seed = hashString(String(knowledge.id || '') + '|' + String(variant || 0));
    questions = seededShuffle(questions, seed);

    var choicePool = questions.filter(function (item) {
      return item.type === 'choice' || item.type === 'judge';
    });
    var shortPool = questions.filter(function (item) {
      return item.type === 'short';
    });
    var choiceList = choicePool.slice(0, counts ? counts.choice : choicePool.length);
    var shortList = shortPool.slice(0, counts ? counts.short : shortPool.length);

    var parts = [];
    var header = '《' + (knowledge.course || '自定义') + '》' +
      (knowledge.chapter ? knowledge.chapter + ' · ' : '') +
      (knowledge.title || '知识点');

    parts.push('## ' + header + ' · 自测卷');
    parts.push('');
    parts.push('> 来自自定义知识库 · 共 **' + (choiceList.length + shortList.length) + ' 题**。');
    if (counts && choiceList.length + shortList.length < counts.choice + counts.short) {
      parts.push('> 该知识点当前共 ' + questions.length + ' 道可用题，已全部给出。');
    }
    if (hideAnswers) {
      parts.push('> 本次只出题，答案与解析已隐藏；点「给出答案」查看。');
    }
    parts.push('');

    if (choiceList.length) {
      parts.push('### 一、选择题（每题 10 分）');
      parts.push('');

      choiceList.forEach(function (item, index) {
        parts.push('**' + (index + 1) + '. ' + item.q + '**');
        (item.options || []).forEach(function (option, optionIndex) {
          parts.push('- ' + String.fromCharCode(65 + optionIndex) + '. ' + option);
        });
        parts.push('');
      });
    }

    if (shortList.length) {
      parts.push('### ' + (choiceList.length ? '二、' : '一、') + '简答题（每题 25 分）');
      parts.push('');

      shortList.forEach(function (item, index) {
        parts.push('**' + (choiceList.length + index + 1) + '. ' + item.q + '**');
        parts.push('');
      });
    }

    if (!hideAnswers) {
      parts.push('---');
      parts.push('');
      parts.push('## 参考答案与详细解析');
      parts.push('');

      if (choiceList.length) {
        parts.push('### 选择题');
        parts.push('');

        choiceList.forEach(function (item, index) {
          var answerText = item.type === 'judge'
            ? (item.answer === 'A' ? '正确' : '错误')
            : item.answer;
          parts.push('**' + (index + 1) + '. 答案：' + answerText + '**');
          parts.push('');
          parts.push('解析：' + (item.analysis || '对照知识点内容理解。'));
          parts.push('');
        });
      }

      if (shortList.length) {
        parts.push('### 简答题');
        parts.push('');

        shortList.forEach(function (item, index) {
          parts.push('**' + (choiceList.length + index + 1) + '. 参考答案要点**');
          parts.push('');
          String(item.answer || '').split('；').filter(Boolean).forEach(function (point) {
            parts.push('- ' + point);
          });
          parts.push('');
        });
      }
    } else {
      parts.push('> 需要答案时直接说「给出答案」，我会补上。');
    }

    var meta = [];
    choiceList.forEach(function (item, index) {
      meta.push({
        number: index + 1,
        type: item.type,
        q: item.q,
        options: item.options || [],
        answer: item.answer,
        analysis: item.analysis || ''
      });
    });
    shortList.forEach(function (item, index) {
      meta.push({
        number: choiceList.length + index + 1,
        type: 'short',
        q: item.q,
        options: [],
        answer: item.answer,
        analysis: item.analysis || ''
      });
    });

    return { content: parts.join('\n'), questions: meta, canRegenerate: false };
  }

  function buildAnswerSheet(questions, options) {
    var list = Array.isArray(questions) ? questions : [];
    if (!list.length) return '';

    var opts = options || {};
    var title = opts.title ? String(opts.title).replace(/^#+\s*/, '').trim() : '';
    var parts = [];

    parts.push('## 上一套题的答案与解析');
    parts.push('');
    parts.push('> ' + (title ? '针对「' + title + '」这套 ' + list.length + ' 题。' : '针对本次对话中最近的 ' + list.length + ' 题。'));
    parts.push('');

    var choiceList = list.filter(function (item) {
      return item.type === 'choice' || item.type === 'judge';
    });
    var shortList = list.filter(function (item) {
      return item.type === 'short';
    });

    if (choiceList.length) {
      choiceList.forEach(function (item, index) {
        var number = item.number || (index + 1);
        var answerText = item.type === 'judge'
          ? (item.answer === 'A' ? '正确' : '错误')
          : item.answer;
        var answerOption = '';
        if (item.type === 'choice' && /^[A-D]$/.test(String(item.answer || ''))) {
          var answerIndex = item.answer.charCodeAt(0) - 65;
          if (item.options && item.options[answerIndex] !== undefined) {
            answerOption = '. ' + item.options[answerIndex];
          }
        }

        parts.push('**' + number + '. ' + (item.q || '') + '**');
        (item.options || []).forEach(function (option, optionIndex) {
          parts.push('- ' + String.fromCharCode(65 + optionIndex) + '. ' + option);
        });
        parts.push('');
        parts.push('**答案：' + answerText + answerOption + '**');
        parts.push('');
        parts.push('解析：' + (item.analysis || '对照知识点内容理解。'));
        parts.push('');
      });
    }

    if (shortList.length) {
      shortList.forEach(function (item, index) {
        var number = item.number || (choiceList.length + index + 1);
        parts.push('**' + number + '. ' + (item.q || '') + '**');
        parts.push('');
        parts.push('参考答案要点：');
        String(item.answer || '').split('；').filter(Boolean).forEach(function (point) {
          parts.push('- ' + point);
        });
        parts.push('');
      });
    }

    return parts.join('\n');
  }

  function buildQuestionExplanation(question, options) {
    var item = question || {};
    var opts = options || {};
    var number = item.number || opts.number || 1;
    var userAnswer = String(opts.userAnswer || '').toUpperCase();
    var parts = [];

    parts.push('## 第 ' + number + ' 题 · 解析');
    parts.push('');
    if (item.q) {
      parts.push('**' + item.q + '**');
      parts.push('');
    }

    if (item.type === 'short') {
      parts.push('### 参考答案要点');
      String(item.answer || '').split('；').filter(Boolean).forEach(function (point) {
        parts.push('- ' + point);
      });
      parts.push('');
      if (item.analysis) {
        parts.push('### 解析');
        parts.push(item.analysis);
        parts.push('');
      }
    } else {
      (item.options || []).forEach(function (option, index) {
        var letter = String.fromCharCode(65 + index);
        var marks = [];
        if (item.answer === letter) marks.push('正确答案');
        if (userAnswer === letter) marks.push('你选的');
        parts.push('- ' + letter + '. ' + option + (marks.length ? ' ← ' + marks.join(' / ') : ''));
      });
      parts.push('');

      parts.push('### 正确答案');
      if (item.type === 'judge') {
        parts.push('**' + (item.answer === 'A' ? '正确' : '错误') + '**');
      } else {
        var index = /^[A-D]$/.test(String(item.answer || '')) ? item.answer.charCodeAt(0) - 65 : -1;
        var answerText = item.options && item.options[index] !== undefined ? item.options[index] : '';
        parts.push('**' + item.answer + (answerText ? '. ' + answerText : '') + '**');
      }
      parts.push('');

      if (userAnswer) {
        parts.push('### 你的选择');
        parts.push('- 你选：**' + userAnswer + '**');
        parts.push('- 判断：**' + (userAnswer === item.answer ? '正确' : '错误') + '**');
        parts.push('');
      }

      parts.push('### 为什么');
      parts.push(item.analysis || '结合题干限定词与选项差异判断。');
      parts.push('');

      var others = [];
      (item.options || []).forEach(function (option, optionIndex) {
        var letter = String.fromCharCode(65 + optionIndex);
        if (letter !== item.answer) others.push(letter + '. ' + option);
      });
      if (others.length) {
        parts.push('### 其他选项');
        parts.push('> ' + others.join('；') + '。这些选项与正确答案不符，对照上面的解析理解即可。');
        parts.push('');
      }
    }

    parts.push('### 下一步');
    parts.push('> 需要的话我可以再出 2 道同类题。');
    return parts.join('\n');
  }

  function buildReplyResult(intentId, text, history, wrongItems, variant, knowledge, hideAnswers) {
    var topic = detectTopic(text);

    if (knowledge) {
      if (intentId === 'outline') {
        return { content: buildKnowledgeOutline(knowledge) };
      }
      if (intentId === 'quiz') {
        if (knowledge.customQuestions && knowledge.customQuestions.length) {
          var counts = requestedCounts(text);
          var customQuiz = buildQuizFromCustom(knowledge, variant, hideAnswers, counts.explicit ? counts : null);
          if (customQuiz) return customQuiz;
        }
if (!knowledge.topic || !BANK[knowledge.topic]) {
          var hasFields = Boolean(knowledge.definition) || (Array.isArray(knowledge.points) && knowledge.points.length > 0);
          var hint = hasFields
            ? '这个知识点还没有可用题目：模板生成未成功。请检查定义与要点，或补充同课程其他知识点作为干扰项。'
            : '这个知识点还没有题目，也缺少定义与要点，无法自动生成。请先在知识库补充定义或要点。';
          return {
            content: '## 这个知识点还没有题目\n\n> 「' + (knowledge.course || '自定义') + ' · ' + (knowledge.chapter ? knowledge.chapter + ' · ' : '') + (knowledge.title || '知识点') + '」' + hint,
            questions: []
          };
        }
        return buildQuizResult(text, knowledge.topic, variant, hideAnswers);
      }
    }

    if (intentId === 'quiz') return buildQuizResult(text, topic, variant, hideAnswers);
    if (intentId === 'wrong') return { content: buildWrong(text, topic) };
    if (intentId === 'compare') return { content: buildCompare(text) };
    if (intentId === 'wrongbook') {
      return {
        content: '## 错题本已独立\n\n> 错题本不再通过对话整理。点页头「错题本」查看全部错题；在题目下方点「加入错题本」即可收集。'
      };
    }
    return { content: buildOutline(text, topic) };
  }


  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function abortError() {
    try {
      return new DOMException('Aborted', 'AbortError');
    } catch (error) {
      var fallback = new Error('Aborted');
      fallback.name = 'AbortError';
      return fallback;
    }
  }

  function isAbort(error) {
    return Boolean(error) && (error.name === 'AbortError' || error.code === 20);
  }

  function resolveEndpoint() {
    if (CONFIG.endpoint) return CONFIG.endpoint;
    if (CONFIG.autoEndpoint === false) return '';
    if (remoteState.autoDisabled) {
      if (Date.now() < remoteState.retryAt) return '';
      remoteState.autoDisabled = false;
      remoteState.retryAt = 0;
    }
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
      return '/api/chat';
    }
    return '';
  }

  function isRemote() {
    return Boolean(resolveEndpoint());
  }

  function chunkText(text, size) {
    var chunks = [];
    var current = '';
    String(text).split('').forEach(function (char) {
      current += char;
      if (current.length >= size || /[。！？；\n]/.test(char)) {
        chunks.push(current);
        current = '';
      }
    });
    if (current) chunks.push(current);
    return chunks;
  }

  function extractQuizPayload(content) {
    var source = String(content || '');
    var match = source.match(/<quiz>([\s\S]*?)<\/quiz>/i);
    if (!match) match = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!match) return null;
    try {
      return JSON.parse(match[1].trim());
    } catch (error) {
      return null;
    }
  }

  function detectQuizKind(text) {
    return /(自测卷|自测题|一套题|考卷|试卷)/.test(String(text || '')) ? 'paper' : 'practice';
  }

  function normalizeQuizPayload(payload, hideAnswers, quizKind) {
    var data = payload && typeof payload === 'object' ? payload : {};
    var list = Array.isArray(data.questions) ? data.questions : [];
    var questions = [];

    list.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var q = String(item.q || item.question || '')
        .replace(/\r?\n+/g, ' ')
        .replace(/\*\*|__|~~|`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!q) return;

      var type = String(item.type || 'choice').toLowerCase();
      if (type === 'single' || type === 'radio') type = 'choice';
      if (type === 'boolean') type = 'judge';
      if (type === 'essay' || type === 'answer') type = 'short';

      var options = Array.isArray(item.options) ? item.options.map(function (option) {
        return String(option || '')
          .replace(/\r?\n+/g, ' ')
          .replace(/\*\*|__|~~|`/g, '')
          .trim();
      }).filter(Boolean) : [];
      if (type === 'judge' && options.length !== 2) options = ['正确', '错误'];
      if (type === 'short') options = [];
      if (type !== 'short' && options.length < 2) type = 'short';

      var answer = String(item.answer || item.correct || '').trim();
      if (!answer && type !== 'short') return;

      questions.push({
        number: questions.length + 1,
        type: type,
        q: q,
        options: options,
        answer: answer,
        analysis: String(item.analysis || item.explain || '').trim()
      });
    });

    if (!questions.length) return null;

    var title = String(data.quizTitle || data.title || '').trim();
    var kind = quizKind === 'paper' ? 'paper' : 'practice';
    return {
      questions: questions,
      quizTitle: title,
      quizKind: kind,
      content: renderQuizMarkdown(questions, Boolean(hideAnswers), title, kind)
    };
  }

  function renderQuizMarkdown(questions, hideAnswers, title, quizKind) {
    var parts = [];
    parts.push('# ' + (quizKind === 'paper' ? '自测卷' : '练习题') + (title ? ' · ' + title : ''));
    parts.push('');

    questions.forEach(function (question) {
      parts.push('**' + question.number + '. ' + question.q + '**');
      if (question.options.length) {
        question.options.forEach(function (option, index) {
          var prefix = /^[A-D][.、]/.test(option) ? '' : String.fromCharCode(65 + index) + '. ';
          parts.push('- ' + prefix + option);
        });
      }
      parts.push('');
    });

    if (!hideAnswers) {
      parts.push('---');
      parts.push('');
      parts.push('## 参考答案与详细解析');
      parts.push('');
      questions.forEach(function (question) {
        parts.push('**第 ' + question.number + ' 题答案：' + question.answer + '**');
        if (question.analysis) parts.push(question.analysis);
        parts.push('');
      });
    }

    return parts.join('\n').trim();
  }

  function createSseParser(onDelta) {
    var buffer = '';
    return function push(chunk) {
      buffer += chunk;
      var parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop();
      parts.forEach(function (part) {
        var dataLines = String(part).split(/\r?\n/).filter(function (line) {
          return line.indexOf('data:') === 0;
        }).map(function (line) {
          return line.slice(5).trim();
        });
        var payload = dataLines.join('\n').trim();
        if (!payload || payload === '[DONE]') return;
        try {
          var data = JSON.parse(payload);
          var delta = '';
          if (typeof data.delta === 'string') delta = data.delta;
          else if (typeof data.content === 'string') delta = data.content;
          else if (data.choices && data.choices[0]) {
            var choice = data.choices[0];
            if (choice.delta && typeof choice.delta.content === 'string') delta = choice.delta.content;
            else if (typeof choice.text === 'string') delta = choice.text;
          }
          if (delta) onDelta(delta);
        } catch (error) {
        }
      });
    };
  }

  async function streamRemote(text, step, options, onDelta) {
    var opts = options || {};
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, CONFIG.timeout);
    var firstTokenTimedOut = false;
    var firstTokenTimer = setTimeout(function () {
      if (!content) {
        firstTokenTimedOut = true;
        controller.abort();
      }
    }, 10000);
    var abortUpstream = function () {
      controller.abort();
    };
    var content = '';
    var emitted = false;

    if (opts.signal) {
      if (opts.signal.aborted) {
        clearTimeout(timer);
        throw abortError();
      }
      opts.signal.addEventListener('abort', abortUpstream);
    }

    try {
      var headers = { 'Content-Type': 'application/json' };
      if (CONFIG.clientToken) headers['X-Client-Token'] = CONFIG.clientToken;

      var response = await fetch(resolveEndpoint(), {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: CONFIG.model,
          message: text,
          intent: step.id,
          history: opts.history || [],
          wrongItems: opts.wrongItems || [],
          variant: opts.variant || 0,
          regenerate: Boolean(opts.variant),
          knowledge: opts.knowledge || null,
          hideAnswers: Boolean(opts.hideAnswers),
          system: SYSTEM_PROMPT,
          stream: CONFIG.stream !== false && !opts.silent
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        var httpError = new Error('HTTP ' + response.status);
        httpError.status = response.status;
        throw httpError;
      }

      var contentType = String(response.headers.get('content-type') || '');

      if (!response.body || contentType.indexOf('text/event-stream') === -1) {
        var data = await response.json();
        content = String(data.content || data.reply || (data.data && data.data.content) || '');
        clearTimeout(firstTokenTimer);
        if (!content) throw new Error('empty content');
        var plainChunks = chunkText(content, 6);
        for (var i = 0; i < plainChunks.length; i += 1) {
          if (opts.signal && opts.signal.aborted) throw abortError();
          emitted = true;
          if (!opts.silent) onDelta(plainChunks[i]);
          await delay(10);
        }
        return { content: content, source: 'remote' };
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var parse = createSseParser(function (delta) {
        content += delta;
        emitted = true;
        clearTimeout(firstTokenTimer);
        if (!opts.silent) onDelta(delta);
      });

      while (true) {
        var result = await reader.read();
        if (result.done) break;
        parse(decoder.decode(result.value, { stream: true }));
      }
      parse('\n\n');

      if (!content) throw new Error('empty content');
      return { content: content, source: 'remote' };
    } catch (error) {
      var failure = error;
      if (firstTokenTimedOut) {
        failure = new Error('first_token_timeout');
        failure.name = 'TimeoutError';
        failure.code = 'timeout';
        failure.isTimeout = true;
        failure.firstToken = true;
      } else if (error.name === 'AbortError' && !(opts.signal && opts.signal.aborted)) {
        failure = new Error('timeout');
        failure.name = 'TimeoutError';
        failure.code = 'timeout';
        failure.isTimeout = true;
      }
      failure.partial = content;
      failure.emitted = emitted;
      throw failure;
    } finally {
      clearTimeout(timer);
      clearTimeout(firstTokenTimer);
      if (opts.signal) opts.signal.removeEventListener('abort', abortUpstream);
    }
  }

  async function streamLocal(step, text, options, onDelta) {
    var opts = options || {};
    var result = buildReplyResult(step.id, text, opts.history || [], opts.wrongItems || [], opts.variant || 0, opts.knowledge || null, Boolean(opts.hideAnswers));
    var content = result.content;

    if (opts.lowConfidence) {
      content = '> 我不太确定你想做哪一类，先按考点整理了一版；如果不对，可以说「出题 / 解析 / 对比 / 错题本」。\n\n' + content;
    }

    var chunks = chunkText(content, 8);
    for (var i = 0; i < chunks.length; i += 1) {
      if (opts.signal && opts.signal.aborted) throw abortError();
      await delay(6 + Math.random() * 8);
      onDelta(chunks[i]);
    }

    return {
      content: content,
      questions: result.questions || null,
      canRegenerate: result.canRegenerate !== false,
      source: 'local'
    };
  }

  async function streamCustom(prompt, options, onDelta) {
    var opts = options || {};
    var notify = typeof onDelta === 'function' ? onDelta : function () {};
    var step = { id: opts.intent || 'answers', label: opts.label || '答案解析' };

    if (opts.forceRemote) {
      remoteState.autoDisabled = false;
      remoteState.retryAt = 0;
    }
    if (!resolveEndpoint() && !opts.forceRemote) return null;

    try {
      var remote = await streamRemote(prompt, step, Object.assign({}, opts, {
        silent: Boolean(opts.silent)
      }), notify);
      return { content: remote.content, source: 'remote' };
    } catch (error) {
      if (isAbort(error) || error.isTimeout) throw error;
      if (!CONFIG.endpoint) {
        remoteState.autoDisabled = true;
        remoteState.retryAt = Date.now() + 30000;
      }
      return null;
    }
  }

  function classifyError(error) {
    if (!error) {
      return { code: 'unknown', title: '请求失败', detail: '已先用离线内容，可稍后重试。', retryable: true };
    }
    if (error.isTimeout || error.code === 'timeout') {
      return { code: 'timeout', title: '暂时加载失败', detail: '稍后再试。', retryable: true };
    }
    var status = Number(error.status) || 0;
    if (status === 401 || status === 403) {
      return { code: 'auth', title: '访问凭证无效', detail: '请检查服务端的 CLIENT_TOKEN 或密钥配置。', retryable: false };
    }
    if (status === 429) {
      return { code: 'rate', title: '请求过于频繁', detail: '稍等一会儿再试。', retryable: true };
    }
    if (status === 503) {
      return { code: 'unconfigured', title: '模型服务未配置', detail: '当前使用离线内容。', retryable: false };
    }
    if (status >= 500) {
      return { code: 'server', title: '模型服务异常', detail: '服务端返回错误，已先用离线内容。', retryable: true };
    }
    if (error.name === 'TypeError') {
      return { code: 'network', title: '网络连接失败', detail: '检查网络或接口地址后重试。', retryable: true };
    }
    return { code: 'unknown', title: '请求失败', detail: '已先用离线内容，可稍后重试。', retryable: true };
  }

  async function fetchRemoteQuiz(text, step, opts) {
    for (var attempt = 0; attempt < 2; attempt += 1) {
      try {
        var remote = await streamRemote(
          text,
          step,
          Object.assign({}, opts, { silent: true }),
          function () {}
        );
        var normalized = normalizeQuizPayload(extractQuizPayload(remote.content), opts.hideAnswers, detectQuizKind(text));
        if (normalized) return normalized;
      } catch (error) {
        if (isAbort(error) || error.isTimeout) throw error;
      }
    }
    return null;
  }

  async function streamStep(step, text, options, onDelta) {
    var opts = options || {};
    var notify = typeof onDelta === 'function' ? onDelta : function () {};
    var lowConfidence = Boolean(opts.lowConfidence);

    if (opts.forceRemote) remoteState.autoDisabled = false;

    if ((resolveEndpoint() || opts.forceRemote) && !opts.forceLocal) {
      try {
        var quizMode = step.id === 'quiz';

        if (quizMode) {
          notify('> 正在生成题目，请稍候…\n\n');
          var normalized = await fetchRemoteQuiz(text, step, opts);
          if (normalized) {
            var quizChunks = chunkText(normalized.content, 8);
            for (var ci = 0; ci < quizChunks.length; ci += 1) {
              notify(quizChunks[ci]);
              await delay(8);
            }
            return {
              intent: step.id,
              label: step.label,
              content: normalized.content,
              questions: normalized.questions,
              quizTitle: normalized.quizTitle,
              quizKind: normalized.quizKind,
              canRegenerate: true,
              source: 'remote',
              error: null
            };
          }
          throw new Error('quiz format');
        }

        var remote = await streamRemote(text, step, opts, notify);
        var inferredPayload = extractQuizPayload(remote.content);
        var inferred = inferredPayload ? normalizeQuizPayload(inferredPayload, opts.hideAnswers, detectQuizKind(text)) : null;
        if (inferred) {
          return {
            intent: 'quiz',
            label: inferred.quizKind === 'paper' ? '自测卷' : '练习题',
            content: inferred.content,
            questions: inferred.questions,
            quizTitle: inferred.quizTitle,
            quizKind: inferred.quizKind,
            canRegenerate: true,
            source: 'remote',
            error: null
          };
        }
        return {
          intent: step.id,
          label: step.label,
          content: remote.content,
          questions: null,
          canRegenerate: true,
          source: 'remote',
          error: null
        };
      } catch (error) {
        if (isAbort(error)) throw error;

        if (error.isTimeout) {
          return {
            intent: step.id,
            label: step.label,
            content: '> 暂时加载失败，稍后再试。',
            questions: [],
            canRegenerate: true,
            source: 'timeout',
            error: null
          };
        }

        var info = classifyError(error);

        if (!CONFIG.endpoint) {
          remoteState.autoDisabled = true;
          remoteState.retryAt = Date.now() + 30000;
        }

        if (error.emitted && error.partial) {
          return {
            intent: step.id,
            label: step.label,
            content: error.partial,
            questions: null,
            canRegenerate: true,
            source: 'remote-partial',
            error: info
          };
        }

        var fallback = await streamLocal(step, text, Object.assign({}, opts, {
          lowConfidence: lowConfidence
        }), notify);
        if (step.id === 'quiz' && fallback.content) {
          fallback.content = '> 本地兜底：模型暂不可用，以下内容来自本地题库。\n\n' + fallback.content;
        }
        return {
          intent: step.id,
          label: step.label,
          content: fallback.content,
          questions: fallback.questions,
          canRegenerate: fallback.canRegenerate !== false,
          source: 'fallback',
          error: info
        };
      }
    }

    var local = await streamLocal(step, text, opts, notify);
    return {
      intent: step.id,
      label: step.label,
      content: local.content,
      questions: local.questions,
      canRegenerate: local.canRegenerate !== false,
      source: 'local',
      error: null
    };
  }

  function plannedSteps(text, options) {
    var opts = options || {};
    var plan = opts.plan || analyzeIntent(text);

    if (opts.intent) {
      return {
        plan: plan,
        steps: [{ id: opts.intent.id, label: opts.intent.label }]
      };
    }

    if (resolveEndpoint()) {
      return { plan: plan, steps: [plan.primary] };
    }

    return { plan: plan, steps: plan.steps };
  }

  async function respondAll(text, options) {
    var opts = options || {};
    var planned = plannedSteps(text, opts);
    var results = [];
    var started = Date.now();

    for (var i = 0; i < planned.steps.length; i += 1) {
      var step = planned.steps[i];
      var low = planned.plan.confidence === 'low' && step.id === 'outline' && !resolveEndpoint();
      var result = await streamStep(step, text, Object.assign({}, opts, {
        plan: planned.plan,
        lowConfidence: low
      }), function () {});
      results.push(result);
    }

    return {
      results: results,
      plan: planned.plan,
      elapsed: Date.now() - started
    };
  }

  async function respond(text, options) {
    var opts = options || {};
    var output = await respondAll(text, opts);
    var results = output.results;
    var first = results[0];

    return {
      intent: first.intent,
      label: first.label,
      content: results.map(function (item) {
        return item.content;
      }).join('\n\n---\n\n'),
      questions: first.questions || null,
      results: results,
      confidence: output.plan.confidence,
      elapsed: output.elapsed,
      source: first.source
    };
  }

  function formatDateTime(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function exportTranscript(messages) {
    var lines = ['# 复习对话记录', '', '- 导出时间：' + formatDateTime(new Date()), '- 消息数：' + (messages ? messages.length : 0), ''];

    (messages || []).forEach(function (msg) {
      lines.push('---');
      lines.push('');
      if (msg.role === 'user') {
        lines.push('**我** · ' + (msg.time || ''));
      } else {
        lines.push('**复习助教** · ' + (msg.label || '复习建议') + ' · ' + (msg.time || ''));
      }
      lines.push('');
      lines.push(msg.content || '');
      lines.push('');
    });

    return lines.join('\n');
  }

  global.ReviewAssistant = {
    config: CONFIG,
    systemPrompt: SYSTEM_PROMPT,
    analyzeIntent: analyzeIntent,
    plan: analyzeIntent,
    detectIntent: detectIntent,
    detectTopic: detectTopic,
    isRemote: isRemote,
    enableRemote: function () {
      remoteState.autoDisabled = false;
      remoteState.retryAt = 0;
    },
    streamStep: streamStep,
    streamCustom: streamCustom,
    extractQuizPayload: extractQuizPayload,
    normalizeQuizPayload: normalizeQuizPayload,
    detectQuizKind: detectQuizKind,
    respondAll: respondAll,
    respond: respond,
    exportTranscript: exportTranscript,
    buildAnswerSheet: buildAnswerSheet,
    buildQuestionExplanation: buildQuestionExplanation
  };
})(window);