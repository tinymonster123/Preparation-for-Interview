# 面试问题二：Node.js 内存泄漏与 GC

面试官问的是 Node.js 场景。内存泄漏几乎只涉及**堆（Heap）**，不涉及栈（Stack）。

### 为什么只关心堆，不关心栈？

#### 栈内存（Stack）
- 存储**基本类型值**（number, string, boolean, null, undefined, symbol, bigint）和**函数调用帧**（局部变量的引用、返回地址）
- **自动管理**：函数执行完毕，栈帧弹出，内存立即释放
- 大小固定、生命周期确定
- **不可能泄漏**——函数一返回就没了

#### 堆内存（Heap）
- 存储**对象、数组、Buffer、闭包**等引用类型
- 由 **GC（垃圾回收器）** 管理，只有当对象没有任何引用指向它时才会被回收
- **泄漏就发生在这里**——某个对象本该没人用了，但还有引用指着它，GC 不敢回收

```js
let a = 42;           // 栈上，函数结束自动释放，不会泄漏
let obj = { x: 1 };   // obj 这个引用在栈上，但 {x:1} 这个对象在堆上
```

当函数返回时：
- `a` → 栈帧弹出，没了
- `obj` 引用 → 栈帧弹出，没了
- `{x: 1}` 对象 → 如果没有其他引用指向它，GC 会回收；**如果被全局变量/闭包/事件监听器引用着，就泄漏了**

泄漏的本质是：**堆上的对象还被某条引用链连着，GC 认为它还"有用"，不回收。**

```
栈 (Stack)                    堆 (Heap)
┌──────────────┐
│ main()       │
│  globalArr ──────────────> [ ───, ───, ─── ]
│              │               │     │     │
├──────────────┤               ▼     ▼     ▼
│ processReq() │            {100KB} {100KB} {100KB}
│  bigPayload ────────────> {100KB}  ← 函数返回后这个引用断了
│              │             但如果 push 到 globalArr 里，
└──────────────┘             堆上的对象就永远有引用，不会被回收
                             ↑ 这就是内存泄漏
```

唯一的例外是**栈溢出（Stack Overflow）**，但那是递归太深导致的崩溃，不是"泄漏"，是两个不同的问题。

### 5 种常见的内存泄漏场景

| # | 场景 | 说明 |
|---|------|------|
| 1 | **全局变量无限增长** | 数据挂在全局对象上，永远不会被 GC 回收 |
| 2 | **闭包持有大对象引用** | 闭包通过作用域链引用了外部大对象，阻止 GC |
| 3 | **EventEmitter 监听器未移除** | 反复 on() 注册但从不 off()，监听器和它引用的上下文不断累积 |
| 4 | **setInterval/setTimeout 未清除** | 定时器回调持有引用，定时器不清除则引用永远存在 |
| 5 | **缓存无上限无淘汰策略** | 用 Map/Object 做缓存但不设大小限制，随数据增长无限膨胀 |

实战示例代码见 `./node-memory-leak-lab/` 目录。

### Follow up: 如何排查内存泄漏？

排查泄漏的核心是**对比**：看什么在涨、什么没被回收、谁在持有引用。

#### 方法 1：观察 `process.memoryUsage()` 趋势

```js
// 启动时加 --expose-gc，强制 GC 后看"真实底线"
setInterval(() => {
  if (global.gc) global.gc();
  const mem = process.memoryUsage();
  console.log(`heapUsed: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
}, 5000);
```

单看一次数字没意义，关键看**GC 后的谷底是否持续上升**：

```
时间点1 (GC后): heapUsed 20MB
时间点2 (GC后): heapUsed 25MB  ← 谷底在涨
时间点3 (GC后): heapUsed 31MB  ← 持续涨 = 泄漏
```

不同指标涨，说明不同类型的泄漏：

| 场景 | 涨的指标 |
|------|---------|
| JS 对象泄漏（数组、闭包、Map） | `heapUsed` 涨 |
| Buffer / native 泄漏 | `external` 涨，`heapUsed` 几乎不动 |
| 都有 | `rss` 涨最快（它是总和） |

**rss 是最"诚实"的指标**——不管泄漏在哪一层都会涨。先看 rss 判断有没有泄漏，再看 heapUsed 和 external 判断泄漏类型。

> 这一步只能告诉你**"有没有泄漏"**，不能告诉你**"泄漏在哪"**。定位泄漏需要用下面的 Heap Snapshot 或 Allocation 工具。

#### 方法 2：Chrome DevTools 对比 Heap Snapshot（推荐，定位泄漏用）

```bash
node --inspect --expose-gc server.js
```

1. Chrome 打开 `chrome://inspect` → 点击 "inspect" 连接
2. 进入 **Memory** 标签
3. **Take Heap Snapshot**（拍第一次快照）
4. 模拟压力请求
5. **Take Heap Snapshot**（拍第二次快照）
6. 选择第二次快照 → 视图切换为 **Comparison** 模式
7. 按 **Size Delta** 或 **# Delta** 降序排序
8. 找到增长最大的对象 → 点进去看 **Retainers**（谁持有了它的引用）→ 定位泄漏源

##### Comparison 视图的关键列

| 列名 | 含义 |
|------|------|
| **# New** | 快照2比快照1多出来的对象数量 |
| **# Deleted** | 被回收掉的对象数量 |
| **# Delta** | 净增量 = New - Deleted，**正数 = 泄漏嫌疑** |
| **Size Delta** | 内存大小的净增量 |

- **Delta 正数** → 只增不减 → 泄漏嫌疑，点开看 Retainers
- **Delta 负数** → 被正常回收 → 没泄漏，忽略（如 `HTTPServerAsyncResource` 负数是正常的请求回收）

##### Shallow Size vs Retained Size

| | Shallow Size | Retained Size |
|--|-------------|---------------|
| 含义 | 对象**自身**占的内存 | 对象被回收后能**释放的总内存** |
| 包含范围 | 只算自己那一层 | 自己 + 所有只被它引用的子对象 |

举例：一个 `requestLogs` 数组的 Shallow Size 可能只有几 KB（指针列表），但 Retained Size 是几十 MB（因为它持有 500 个大对象 + 所有字符串 + 所有 Buffer）。

**排查泄漏看 Retained Size**——它回答的是"删掉这个引用能释放多少内存"。

```
Shallow Size → "这个对象本身多大"    → 理解对象结构
Retained Size → "删掉它能省多少内存" → 排查泄漏，选这个
```

##### Retainers 怎么读

Retainers 是**从下往上**读的引用链：

```
Object @123456          ← 泄漏的对象
  └─ [123] in (array)   ← 它是某个数组的第 123 个元素
       └─ requestLogs   ← 那个数组就是 requestLogs ← 泄漏根因！
```

#### 方法 3：Allocation Sampling（定位"哪个函数分配了最多内存"）

1. DevTools → Memory → 选 **Allocation sampling**
2. 点 **Start**
3. 执行压测
4. 点 **Stop**

默认是 Chart（树状调用栈）视图，需要层层展开 `emit → onconnection → ...` 直到看到自己的代码文件名。

**切到 Heavy (Bottom Up)** 视图更高效——直接按"谁分配的内存最多"排序，能直接看到 `Buffer.alloc`、`Array.push`、`Map.set` 等具体分配点和对应的文件行号。

#### 方法 4：Allocation instrumentation on timeline（看"什么时候分配的、有没有被回收"）

1. DevTools → Memory → 选 **Allocation instrumentation on timeline**
2. 点 **Start**
3. 执行压测
4. 点 **Stop**

时间轴上的柱子：
- **蓝色** = 分配了但**没被回收** → 泄漏嫌疑
- **灰色** = 分配了但已被 GC 回收 → 正常

拖选蓝色区域，下方会显示该时间段内分配的对象。点击具体对象，查看 Retainers 追溯泄漏源。

#### 方法 5：v8.writeHeapSnapshot()（无需实时连接 DevTools）

```js
const v8 = require('v8');
const snap = v8.writeHeapSnapshot(); // 生成 .heapsnapshot 文件
```

生成的文件可以之后在 Chrome DevTools Memory 标签中 Load 进去，用上述 Comparison / Retainers 方法分析。适合不方便实时 `--inspect` 的场景（如 CI、容器环境）。

#### 三种方法的对比总结

| 方法 | 回答的问题 | 适用场景 |
|------|-----------|---------|
| `process.memoryUsage()` | 有没有泄漏？涨的是哪一层？ | 快速判断，生产监控 |
| Heap Snapshot Comparison | 前后多了什么对象？谁持有它？ | **最常用**，精确定位泄漏源 |
| Allocation Sampling | 哪个函数分配了最多内存？ | 知道有泄漏但不知道哪段代码造成的 |
| Allocation Timeline | 什么时候分配的？一直没回收？ | 追踪分配时机和回收情况 |
| v8.writeHeapSnapshot() | 同 Snapshot，但离线分析 | 无法实时 inspect 的环境 |

### 深入理解 process.memoryUsage() 的四个指标

Node.js 本质上和浏览器一样使用了 **V8 引擎**来解析和执行 JavaScript，但宿主环境不同：

```
Chrome 浏览器                    Node.js
┌─────────────────┐        ┌─────────────────┐
│  V8 引擎         │        │  V8 引擎         │  ← 同一个 JS 引擎
│  (解析/执行 JS)   │        │  (解析/执行 JS)   │
├─────────────────┤        ├─────────────────┤
│  Blink (渲染)    │        │  libuv (事件循环) │  ← 不同的宿主环境
│  Web APIs        │        │  C++ Bindings    │
│  DOM / BOM       │        │  fs/net/crypto…  │
└─────────────────┘        └─────────────────┘
```

Node.js = **V8** + **libuv** + **C++ Bindings**。V8 只负责 JS 的解析执行和堆内存管理，其他能力（文件、网络、Buffer 等）由 C++ 层提供。

`process.memoryUsage()` 返回四个指标：

| 指标 | 含义 | 谁管的 |
|------|------|--------|
| **rss** | 进程占用的总物理内存（包含一切） | 操作系统 |
| **heapTotal** | V8 堆的总分配空间 | V8 |
| **heapUsed** | V8 堆中实际使用的部分 | V8 |
| **external** | V8 管理的 JS 对象绑定的 C++ 原生内存（如 Buffer） | C++ 层 |

#### 为什么场景 1 中 heapUsed 几乎没涨？

场景 1 的实际输出：
```
第 1 轮:  Heap Used: 3.63 MB | External: 6.19 MB
第 10 轮: Heap Used: 3.69 MB | External: 50.13 MB
                     ↑ 几乎没涨       ↑ 涨了 ~44MB
```

因为 `Buffer.alloc()` 的实际数据**不在 V8 堆上**，而是 C++ 层通过 `malloc` 分配的原生内存。V8 堆上只存了一个很小的 Buffer 对象（包含指针、长度等元信息），实际数据在 external 中。

```
RSS (进程总内存 ≈ 92MB)
┌─────────────────────────────────────────────────┐
│  V8 Heap (~6MB)        External (~50MB)          │
│  ┌──────────┐          ┌─────────────────────┐   │
│  │ heapUsed │          │ Buffer 实际数据       │   │
│  │ ~3.6MB   │          │ 500个 × 100KB        │   │
│  │ (Buffer  │ ──指针──>│ = ~48.8MB            │   │
│  │  引用)   │          │                      │   │
│  └──────────┘          └─────────────────────┘   │
│                                                   │
│  Node.js 运行时 + libuv + 代码段 (~36MB 基础开销)  │
└─────────────────────────────────────────────────┘
```

RSS 初始的 ~42MB 是 Node.js 进程的基础开销（V8 引擎本身、libuv、内置模块的 C++ 代码、栈空间等），所以 RSS = 基础开销 (~42MB) + 泄漏的 Buffer (~50MB) ≈ 92MB。

如果想看到 heapUsed 增长，应该泄漏纯 JS 对象而非 Buffer：

```js
// Buffer → 涨 external
const bigPayload = Buffer.alloc(1024 * 100, 'x');

// 纯 JS 对象 → 涨 heapUsed
const bigPayload = new Array(10000).fill({ key: 'value' });
```

> 排查泄漏时不能只看 heapUsed，还要关注 external 和 rss。Buffer 泄漏只会体现在 external 和 rss 上，heapUsed 可能看起来很正常。

### 面试回答总结

> "排查内存泄漏的核心思路是**对比**：在不同时间点拍 Heap Snapshot，对比哪些对象在增长、通过 Retainers 找到是谁持有了它们的引用，然后针对性修复。常见原因是全局变量无限增长、闭包意外持有引用、事件监听器忘记移除、定时器忘记清除、缓存无淘汰策略。内存泄漏只涉及堆内存，栈内存是自动管理的，函数返回栈帧就弹出了，不存在泄漏问题。另外排查时不能只看 heapUsed，Node.js 中 Buffer 的实际数据在 C++ 层分配，体现在 external 和 rss 中。"

### V8 的 GC 算法

V8 将堆分为**新生代（Young Generation）**和**老生代（Old Generation）**两个区域，分别用不同的算法回收。

#### 新生代：Scavenge（复制算法）

新生代空间小（默认 1~8MB），存放生命周期短的对象。

```
新生代
┌──────────────────┬──────────────────┐
│    From 空间      │     To 空间       │
│  (正在使用)        │   (空闲)          │
│                   │                   │
│  [obj1] [obj2]    │                   │
│  [obj3] [obj4]    │                   │
└──────────────────┴──────────────────┘
```

回收过程：
1. 从 GC Root 出发，标记 From 空间中所有**可达**的对象
2. 把存活的对象**复制**到 To 空间（同时整理内存，消除碎片）
3. From 和 To 角色**互换**
4. 原来 From 空间中没被复制的对象就被丢弃了

```
GC 后：
┌──────────────────┬──────────────────┐
│    To → 变成 From │   From → 变成 To  │
│                   │  [obj1] [obj3]    │  ← 存活的被复制过来
│                   │  (紧凑排列)        │
└──────────────────┴──────────────────┘
obj2, obj4 不可达 → 直接丢弃，不需要逐个释放
```

**优点**：速度快，适合"朝生夕灭"的短命对象（大部分 JS 对象都是）
**缺点**：空间利用率只有 50%（总有一半是空闲的 To 空间）

#### 晋升（Promotion）

如果一个对象在新生代中经历了**两次 Scavenge 还活着**，V8 认为它是"长寿对象"，会将它**晋升到老生代**。

#### 老生代：Mark-Sweep + Mark-Compact

老生代空间大（默认 ~1.4GB），存放长寿对象。

**Mark-Sweep（标记清除）**：
1. **标记阶段**：从 GC Root 出发，递归遍历并标记所有可达对象
2. **清除阶段**：遍历整个老生代，回收未被标记的对象

```
标记前：  [alive] [dead] [alive] [dead] [dead] [alive]
标记后：  [alive]  ___   [alive]  ___    ___   [alive]
                   ↑ 被回收       ↑ 被回收  ↑ 被回收
```

**问题**：清除后内存中出现很多不连续的空洞（碎片），大对象可能找不到连续空间来分配。

**Mark-Compact（标记整理）**：
在 Mark-Sweep 的基础上增加一步——把存活对象向内存一端移动，消除碎片：

```
Mark-Sweep 后：  [alive] ___ [alive] ___ ___ [alive]   ← 有碎片
Mark-Compact 后：[alive][alive][alive] ___________      ← 紧凑排列
```

**Mark-Compact 比 Mark-Sweep 慢**（需要移动对象、更新指针），所以 V8 不是每次都做 Compact，只在碎片严重时才触发。

#### 三种算法对比

| | Scavenge | Mark-Sweep | Mark-Compact |
|--|---------|------------|-------------|
| 用于 | 新生代 | 老生代 | 老生代（碎片严重时） |
| 策略 | 复制存活对象 | 标记可达，清除不可达 | 标记 + 移动整理 |
| 速度 | 最快 | 中等 | 最慢 |
| 碎片 | 无（复制时自动整理） | 有 | 无 |
| 空间代价 | 50% 浪费（From/To） | 无额外空间 | 无额外空间 |

#### 增量标记与并发 GC

老生代的 Mark 阶段如果一次做完，会导致**长时间停顿（Stop-the-World）**。V8 的优化：

- **增量标记（Incremental Marking）**：把标记工作拆成小块，穿插在 JS 执行之间，避免长停顿
- **并发标记（Concurrent Marking）**：标记工作放到后台线程，主线程继续跑 JS
- **并发清除（Concurrent Sweeping）**：清除也在后台线程做

> 面试简答："V8 新生代用 Scavenge 复制算法，快但费空间；老生代用 Mark-Sweep 标记清除，碎片严重时用 Mark-Compact 标记整理。为了减少停顿，V8 还做了增量标记和并发 GC。"

### WeakRef / WeakMap / FinalizationRegistry

这三个 API 都和 GC 有关，核心思想是**不阻止对象被回收**。

#### WeakMap

最常用。key 必须是对象，且是**弱引用**——不会阻止 key 被 GC 回收：

```js
const cache = new WeakMap();

function process(obj) {
  if (cache.has(obj)) return cache.get(obj);
  const result = expensiveCompute(obj);
  cache.set(obj, result);  // obj 被回收时，这个条目自动消失
  return result;
}
```

**对比 Map 的泄漏问题**：

```js
// Map → 泄漏：key 是强引用，即使外部不再需要 obj，Map 也不让它被回收
const cache = new Map();
cache.set(obj, result);  // obj 永远不会被 GC

// WeakMap → 不泄漏：key 是弱引用，外部没有其他引用时 obj 可被 GC
const cache = new WeakMap();
cache.set(obj, result);  // 外部引用消失后，obj 和 result 都会被 GC
```

**典型场景**：
- 给 DOM 元素附加额外数据（元素被移除时数据自动清理）
- 对象级缓存（对象不用了缓存自动失效）
- 私有数据存储

#### WeakRef

创建对对象的弱引用，不阻止 GC，但可以在对象还活着时访问它：

```js
let target = { data: 'important' };
const ref = new WeakRef(target);

// 之后
const obj = ref.deref();  // 如果 target 还活着返回它，被 GC 了返回 undefined
if (obj) {
  console.log(obj.data);
} else {
  console.log('对象已被回收');
}
```

**注意**：不要在关键业务逻辑中依赖 `deref()` 的结果，因为 GC 时机不确定。主要用于缓存场景。

#### FinalizationRegistry

对象被 GC 回收时收到通知，用于清理外部资源：

```js
const registry = new FinalizationRegistry((heldValue) => {
  console.log(`对象被回收了，清理资源: ${heldValue}`);
  // 比如关闭文件句柄、释放 native 资源
});

let obj = { data: 'something' };
registry.register(obj, 'my-resource-id');  // 注册监听

obj = null;  // 移除引用，GC 时会触发回调
```

**实际用途**：Node.js 内部用这个来清理 native addon 的 C++ 资源。业务代码中很少直接用。

#### 三者关系

```
WeakMap    → "我想缓存数据，但不想阻止 key 被回收"
WeakRef    → "我想引用一个对象，但不想阻止它被回收"
Finalization → "对象被回收时通知我，我好清理外部资源"
```

### 生产环境内存监控（不能用 --inspect）

生产环境不能开 `--inspect`（安全风险 + 性能影响），常用方案：

#### 方案 1：定时上报 process.memoryUsage()

最简单，在应用中定时采集指标并发送到监控平台：

```js
setInterval(() => {
  const mem = process.memoryUsage();
  // 上报到 Prometheus / Grafana / 自建监控
  metrics.gauge('node_heap_used', mem.heapUsed);
  metrics.gauge('node_rss', mem.rss);
  metrics.gauge('node_external', mem.external);
}, 10000);
```

配合告警规则：如果 heapUsed 持续 10 分钟只涨不降，触发告警。

#### 方案 2：v8.writeHeapSnapshot() 按需触发

在代码中预埋触发条件，内存超阈值时自动生成快照：

```js
const v8 = require('v8');

setInterval(() => {
  const mem = process.memoryUsage();
  if (mem.heapUsed > 500 * 1024 * 1024) {  // 超过 500MB
    const filename = v8.writeHeapSnapshot();
    console.log(`Heap snapshot written to ${filename}`);
    // 上传到 S3 / OSS，之后下载用 Chrome DevTools 分析
  }
}, 30000);
```

也可以通过 HTTP 端点或 Unix Signal 触发：

```js
process.on('SIGUSR2', () => {
  const filename = v8.writeHeapSnapshot();
  console.log(`Heap snapshot: ${filename}`);
});
// 触发：kill -USR2 <pid>
```

#### 方案 3：Prometheus + Grafana

业界最常用的开源方案：

```
Node.js 应用 → prom-client（采集指标）→ Prometheus（存储）→ Grafana（可视化 + 告警）
```

```js
const client = require('prom-client');
client.collectDefaultMetrics();  // 自动采集 heapUsed、rss、eventLoopLag 等
```

Grafana 面板上可以看到 heapUsed 的趋势图，和我们在 blessed-contrib 仪表盘里看到的类似，但更适合生产长期监控。

#### 方案 4：Clinic.js（性能诊断工具包）

```bash
npx clinic doctor -- node server.js
```

自动采集 CPU、内存、事件循环延迟等指标，生成 HTML 报告，适合在预发布/测试环境做全面诊断。

#### 生产方案对比

| 方案 | 侵入性 | 适合场景 |
|------|--------|---------|
| process.memoryUsage() 上报 | 低 | 长期监控 + 告警 |
| v8.writeHeapSnapshot() 按需触发 | 中（生成快照时有短暂停顿） | 出问题后精确定位 |
| Prometheus + Grafana | 低 | 团队级长期监控 |
| Clinic.js | 高（需要用它的 wrapper 启动） | 测试/预发布环境诊断 |

### 深入理解：Native 内存泄漏与 GC 的被动性

以下基于 Node.js 官方的回复整理，解释了一个关键的反直觉现象：**heapUsed 很正常，但进程内存却疯涨**。

#### 问题：Buffer 泄漏时 heapUsed 为什么不涨？

```
你的代码不断创建 Buffer
       ↓
native 内存分配（C++ malloc）→ external / rss 涨
       ↓
V8 堆上只有小的 Buffer 引用对象 → heapUsed 几乎不涨
       ↓
heapUsed 很低 → V8 觉得"堆很空闲，不需要 GC"
       ↓
老生代 GC 很久不触发
       ↓
老生代里的 Buffer 引用对象一直不被扫描回收
       ↓
对应的 native 内存也一直不释放
       ↓
rss 持续增长直到 OOM Kill
```

这里有一条关键的依赖链：

```
Buffer 的 native 内存释放
  ← 依赖 V8 堆上 Buffer 引用对象被 GC 回收
    ← 依赖该对象不再被任何引用链持有（out-of-scope）
      ← 依赖 GC 扫描到老生代（对象可能已晋升）
        ← 依赖 V8 堆有内存压力来触发 GC
```

**GC 是被动的（reactive）**——只有在 V8 需要分配新的 JS 内存、发现堆空间不够时，才会触发 GC。如果 JS 堆本身压力很小（heapUsed 才 3MB），V8 就没有动力去做老生代 GC，那些晋升到老生代的 Buffer 引用对象就不会被扫描和回收，其背后的 native 内存也就一直占着。

这就是为什么 `--expose-gc` + `global.gc()` 强制 GC 在排查时很有用——它绕过了"等 V8 自己触发"的被动机制。

#### 问题：内存释放了为什么 RSS 不降？

> 进程 free() 的内存不一定还给操作系统。

```
进程 malloc(100MB)      → OS 分配 100MB 物理内存 → RSS = 100MB
进程 free(100MB)        → 进程把这 100MB 放到自己的 free list
                          → 留着下次 malloc 时复用
                          → RSS 仍然 ≈ 100MB（没还给 OS）
进程再 malloc(50MB)     → 直接从 free list 取，不需要向 OS 要
```

这是 glibc malloc 的行为：释放的内存优先留在进程内部的空闲链表（free list）上，方便下次分配时复用，而不是立即归还给操作系统。所以 **RSS 只升不降是正常现象**，不代表一定有泄漏。

判断是否泄漏的关键是看 RSS 是否**持续无上限增长**，而不是看它是否回落。

#### 问题：关闭 OOM Killer 能解决问题吗？

不能。泄漏是根因，关 OOM Killer 只会让内核在物理内存耗尽时随机杀掉其他进程，导致更不可控的故障。正确做法是找到泄漏源修复它。

#### 总结：rss 是最诚实的指标

| 现象 | 说明 |
|------|------|
| rss 持续涨，heapUsed 也涨 | JS 对象泄漏 |
| rss 持续涨，heapUsed 不涨，external 涨 | Buffer / native 内存泄漏 |
| rss 持续涨，heapUsed 和 external 都不涨 | 可能是 C++ addon 直接 malloc 的内存泄漏 |
| rss 涨后不降，但不再继续涨 | 正常，glibc 的 free list 行为 |