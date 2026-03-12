# 小红书面试题 — 详细解答

---

### 1. 描述项目 DDD 架构（使用 DDD 架构需要注意的点）

#### 架构描述

我在海螺 AI 项目中，基于 DDD 分层架构重构了模型切换功能。系统严格划分为四层：

```
┌──────────────────────────────────────────────────┐
│  UI 层 (ModelSelector.tsx)                        │  模板化映射渲染，Apollo 下发什么就渲染什么
├──────────────────────────────────────────────────┤
│  应用层 (useModelSwitch Hook)                     │  中枢编排：收集上下文 → 调 Adapter → 调 Bridge
├──────────────────────────────────────────────────┤
│  领域层 (Adapter + Strategy)                      │  纯函数，零副作用，输入上下文 → 输出 Effect 意图
├──────────────────────────────────────────────────┤
│  基础设施层 (Bridge + Apollo)                     │  执行副作用：弹窗、dispatch、API 调用
└──────────────────────────────────────────────────┘
```

**核心数据流：**

```
用户点击切换模型
  → useModelSwitch 收集当前状态构建 SwitchContext
  → Adapter 遍历所有 Strategy，产出 Effect[] 意图清单
  → Bridge 逐个执行 Effect（弹窗确认、状态清理等）
  → 全部成功 → dispatch(setCurrentModel(id))
```

**领域层设计（核心）：**

```ts
// 契约定义
interface SwitchContext {
  fromModel: string;
  toModel: { id: string; supportsCamera: boolean; supportsMultiImage: boolean };
  hasActiveCamera: boolean;
  currentImages: string[];
}

type Effect =
  | { type: 'CONFIRM_CLEAR_CAMERA'; message: string }
  | { type: 'CLEAR_END_FRAME' }
  | { type: 'CONFIRM_KEEP_FIRST_IMAGE'; message: string };

// 策略文件 — 独立、可插拔
const cameraStrategy = {
  shouldApply: (ctx) => ctx.hasActiveCamera && !ctx.toModel.supportsCamera,
  getEffects: () => [{ type: 'CONFIRM_CLEAR_CAMERA', message: '目标模型不支持运镜，是否继续？' }]
};

// Adapter — 纯函数，遍历策略收集意图
function getSwitchEffects(context: SwitchContext): Effect[] {
  return strategies
    .filter(s => s.shouldApply(context))
    .flatMap(s => s.getEffects());
}
```

#### 使用 DDD 架构需要注意的点

**1. 领域层必须保持纯粹 — 这是 DDD 的生命线**

领域层（Adapter + Strategy）**绝对不能**引入任何外部依赖：不能 import React、不能 import antd Modal、不能 import Redux dispatch。它只是一个"输入上下文 → 输出意图"的纯函数。

> 为什么？因为这是 100% 单测覆盖的根本前提。纯函数不需要 mock 任何东西，直接断言返回值。一旦引入副作用，测试成本指数级上升。

**2. 防止"领域泄露" — 副作用收口到基础设施层**

所有"脏活累活"（弹窗、dispatch、API 调用、埋点）必须统一收口到 Bridge 层。好处是：
- 统一加日志 / 错误处理 / 埋点
- Effect 类型是枚举的，新增操作必须在 Bridge 注册 handler，不会有野生 dispatch 散落各处
- Bridge 的测试也简单：mock dispatch，验证调用参数即可

**3. 异步竞态的防御 — 快照版本号机制**

由于 Adapter（决策）和 Bridge（执行）之间存在时间差（比如 Bridge 在 `await Modal.confirm()` 等用户点击），这期间外部状态可能变化（如 Apollo 热推送模型下线）。解决方案：

```ts
async function executeEffects(effects, snapshotVersion) {
  for (const effect of effects) {
    if (effect.type === 'CONFIRM') {
      const isOk = await Modal.confirm(...);
      if (!isOk) return false;
      // 醒来后检查：世界是否变了？
      if (store.getState().apolloVersion !== snapshotVersion) {
        message.warning('底层配置已更新，请重新操作');
        return false;  // 中断过期事务
      }
    }
    // ... 执行副作用
  }
  return true;
}
```

**4. 避免过度设计 — DDD 不是银弹**

- 简单的 CRUD 页面不需要 DDD，用传统组件化就够了
- DDD 适合**业务规则复杂、变化频繁**的场景（如模型切换涉及十几种校验规则，且模型迭代极快）
- 分层带来的代码量增加是客观代价，需要权衡 ROI

**5. 依赖倒置原则 — 内层不能依赖外层**

```
UI 层 → 应用层 → 领域层    ✅ 依赖方向
领域层 → 基础设施层         ❌ 绝对禁止
```

领域层通过定义 Effect 接口（契约），让基础设施层去实现。这就是"依赖倒置"——领域层定义规则，基础设施层实现细节。

---

### 2. 对象池的使用

#### 背景与痛点

在 Agent Canvas 无限画布中，用户不断新增 Node 并与每个 Node 对话，页面出现严重卡顿，帧率跌破 30FPS。通过 Chrome DevTools 排查发现两个问题：

1. **`new Image()` 导致主线程同步解码阻塞**
2. **频繁创建/销毁图片节点引发密集的锯齿状 GC（垃圾回收）抖动**

#### 对象池设计

对象池分为**两个维度**：

**维度一：容器层池化（减少 GC 触发频率）**

复用的是 PixiJS 侧的 `Sprite` 实例和业务包装对象，而不是 `ImageBitmap` 本身（ImageBitmap 是不可变资源，无法修改像素复用）。

```ts
class SpritePool {
  private pool: Sprite[] = [];

  acquire(): Sprite {
    return this.pool.pop() ?? new Sprite();  // 有则复用，无则创建
  }

  release(sprite: Sprite): void {
    sprite.texture = Texture.EMPTY;  // 清理纹理引用
    // 关键：主动释放底层资源
    if (sprite.bitmap) {
      sprite.bitmap.close();         // 绕过 GC，瞬间释放 C++ 层像素内存
    }
    this.pool.push(sprite);
  }
}
```

减少 `new` 关键字的调用 → 减轻 V8 的 Minor GC 压力。

**维度二：底层资源的主动释放（根治 GC 抖动的关键）**

```ts
// 当节点移出视口 → 不等 GC，直接释放
bitmap.close();          // 释放 C++ 层的图像像素内存
texture.destroy(true);   // 释放 GPU 显存
```

`ImageBitmap.close()` 绕过 JS 垃圾回收器，瞬间释放底层 C++ 图像内存。对比 `new Image()`：`img.src = ''` 只是 hint，底层像素数据只能等 GC 来回收。

#### 配合 rAF 时间切片调度

解码完成的图片不直接上屏，而是进入 rAF 调度队列：

```ts
function scheduleTextureUpload(queue: ImageBitmap[]) {
  requestAnimationFrame(() => {
    const frameStart = performance.now();

    while (queue.length > 0 && performance.now() - frameStart < 5) {
      const bitmap = queue.shift()!;

      // 存活校验：节点是否还在视口内？
      if (!isNodeVisible(bitmap.nodeId)) {
        bitmap.close();  // 已滚出视口 → 跳过上传，直接释放
        continue;
      }

      gl.texImage2D(..., bitmap);  // 真正的 GPU 上传（同步阻塞点）
    }

    if (queue.length > 0) {
      scheduleTextureUpload(queue);  // 还有剩余 → 下一帧继续
    }
  });
}
```

每帧只允许 5ms 用于纹理上传，保证 60FPS。

#### 为什么用 `createImageBitmap` 而不是 `new Image()`？

| | `new Image()` | `createImageBitmap` |
|---|---|---|
| 加载 | 异步 | 异步 |
| 解码 | **不可控**，可能在 `texImage2D` 时同步解码 | **保证在后台线程完成**，resolve 时像素已就绪 |
| 内存释放 | 无主动机制，依赖 GC | `bitmap.close()` 主动释放 C++ 层内存 |
| `texImage2D` 开销 | 解码 + 上传 | 纯上传（无解码开销） |

---

### 3. 流式处理时出现了竞态

**场景：** 一个正在流式输出的卡片（对话 A），用户点了刷新（重新生成），产生了新的流式卡片（对话 B）。如何正确渲染？

#### 方案一：消息 ID 标识（面试官认可）

每次流式请求分配唯一 `messageId`（或 `requestId`）。前端维护"当前活跃的 messageId"，收到流式数据时先校验 ID：

```ts
let activeMessageId: string | null = null;

function onRefresh(cardId: string) {
  // 1. 生成新的 messageId
  activeMessageId = generateUUID();

  // 2. 中止旧的流式连接
  abortControllerRef.current?.abort();
  abortControllerRef.current = new AbortController();

  // 3. 发起新请求，携带 messageId
  startStreaming(cardId, activeMessageId, abortControllerRef.current.signal);
}

function onStreamChunk(chunk: StreamChunk) {
  // 校验：只渲染当前活跃的消息
  if (chunk.messageId !== activeMessageId) {
    return;  // 丢弃过期的流式数据
  }
  appendToCard(chunk.cardId, chunk.content);
}
```

#### 方案二：状态机（个人观点，面试官认可）

为每个卡片维护一个状态机，状态流转控制渲染行为：

```
IDLE → STREAMING → COMPLETED
        ↓ (刷新)
      ABORTING → IDLE → STREAMING (新的)
```

```ts
type CardState = 'idle' | 'streaming' | 'aborting' | 'completed';

function handleRefresh(cardId: string) {
  const card = getCard(cardId);

  if (card.state === 'streaming') {
    card.state = 'aborting';      // 标记为中止中
    card.abortController.abort(); // 中止旧连接
    card.content = '';            // 清空旧内容
    card.state = 'idle';          // 回到初始状态
  }

  // 开始新的流式
  card.state = 'streaming';
  card.messageId = generateUUID();
  startStreaming(cardId, card.messageId);
}
```

#### 方案三：消息体设计（面试官补充）

后端在流式消息体中包含足够的上下文信息，让前端无需额外维护状态也能正确处理：

```ts
interface StreamMessage {
  type: 'chunk' | 'start' | 'end' | 'abort';
  cardId: string;
  messageId: string;      // 唯一标识本次对话
  sequence: number;        // 序列号，保证顺序
  parentMessageId?: string; // 关联上一轮对话（用于刷新场景）
  content: string;
}
```

收到 `start` 类型的消息时，如果该 card 已有活跃的流式 → 自动中止旧的。`sequence` 保证乱序到达的 chunk 能正确排列。`parentMessageId` 让前端知道这是"刷新"产生的新对话。

#### 综合最佳实践

三个方案不是互斥的，实际项目中**组合使用**：
- **消息 ID** 解决"识别身份"
- **状态机** 解决"控制流转"
- **消息体** 解决"前后端协议"

---

### 4. AI Coding 的基本流程

#### 概述

AI Coding 的核心是一个 **"理解需求 → 检索上下文 → 生成代码 → 验证修正"** 的循环。

```
用户输入自然语言指令
  → 意图识别（NLU）
  → 上下文收集（代码库检索、文件读取、符号解析）
  → Prompt 构建（系统提示 + 用户指令 + 代码上下文）
  → LLM 推理生成代码
  → 代码应用（Diff / 文件写入）
  → 验证（lint、类型检查、测试、用户确认）
  → 反馈循环（失败则修正重试）
```

#### 关键环节

**1. 上下文收集（Context Retrieval）**

这是 AI Coding 质量的核心瓶颈。常见策略：

- **文件级上下文**：读取当前文件、相关文件（import 链）
- **符号级上下文**：LSP 提供的类型定义、函数签名、引用关系
- **语义搜索**：对代码库建立向量索引，通过 embedding 检索语义相关的代码片段
- **AST 解析**：抽取函数签名、类结构等结构化信息，减少 token 消耗

**2. Prompt 工程**

```
System Prompt: 你是一个代码助手，遵循项目的编码规范...
Context: [相关代码片段、类型定义、项目规范]
User: 实现一个用户登录功能，要求...
```

**3. 代码生成与应用**

- 流式输出：LLM 逐 token 生成，前端实时展示
- Diff 应用：生成的代码以 diff 形式展示，用户 review 后应用
- Tool Use / Function Calling：LLM 调用工具（读文件、写文件、执行命令）实现 Agentic 工作流

**4. 验证闭环**

- 自动运行 lint / type check / test
- 失败 → 将错误信息反馈给 LLM → 自动修正 → 重试
- 人工确认 → 接受或拒绝修改

---

### 5. 如何配合 AI 使用同事的自定义 npm 包

**场景：** 同事在另一个仓库维护了一个自定义 npm 包，我需要让 AI 理解并正确使用它。

#### 方案一：提供类型定义（最核心）

AI 最擅长消费的是 **TypeScript 类型定义**。确保 npm 包导出了 `.d.ts` 文件：

```ts
// 将包的类型定义喂给 AI
// 方式 1：项目中安装了这个包，AI 自动从 node_modules 读取 .d.ts
npm install @company/custom-sdk

// 方式 2：手动提供类型定义文件给 AI 作为上下文
// "请阅读这个类型定义文件，然后帮我使用这个 SDK 实现..."
```

#### 方案二：提供文档 / README

将包的 README、API 文档、使用示例作为上下文提供给 AI：

```
@docs/custom-sdk.md
请基于这个 SDK 的文档，帮我实现用户数据同步功能
```

#### 方案三：提供示例代码

让 AI 学习同事已有的使用范例：

```
以下是同事在项目 A 中使用 @company/custom-sdk 的示例代码：
[粘贴示例代码]
请参考这种用法，在我的项目中实现类似功能
```

#### 方案四：项目级配置（CLAUDE.md / .cursorrules）

在项目根目录配置 AI 规则文件，持久化对自定义包的说明：

```markdown
# CLAUDE.md

## 自定义依赖说明
- `@company/custom-sdk`：内部数据同步 SDK
  - 核心 API：`syncData(config)`, `subscribe(event, handler)`
  - 注意事项：必须先调用 `init()` 初始化，支持的事件类型见 types.ts
  - 仓库地址：git@github.com:company/custom-sdk.git
```

#### 方案五：MCP（Model Context Protocol）

如果公司基建支持，可以搭建 MCP Server 直接对接内部 npm registry 的文档系统，让 AI 实时查询包的 API 文档和类型。

#### 实际工作流建议

优先级排序：**类型定义 > 示例代码 > 文档 > 项目配置**。类型定义是 AI 最容易消费且最准确的上下文形式。

---

## 二、八股

### 1. 常用性能优化的手段

从**加载阶段**和**运行时阶段**两个维度系统整理：

#### 加载阶段优化

**网络层：**
- DNS 预解析：`<link rel="dns-prefetch" href="//api.example.com">`
- 预连接：`<link rel="preconnect" href="https://cdn.example.com">`
- HTTP/2 多路复用 / HTTP/3 QUIC（0-RTT 连接复用）
- CDN 加速：静态资源就近分发
- Gzip / Brotli 压缩：文本资源减少 65-70% 体积
- HTTP 缓存：`Cache-Control`、`ETag`、`Last-Modified` 协商缓存

**资源层：**
- 代码分割（Code Splitting）：路由级 / 组件级拆包
- 懒加载（Lazy Loading）：`React.lazy()` + `Suspense`、动态 `import()`
- Tree Shaking：消除未引用代码（依赖 ESM 静态分析）
- 图片优化：WebP/AVIF 格式、响应式图片（`srcset`）、懒加载（`loading="lazy"`）
- 字体优化：`font-display: swap`、子集化、`preload` 关键字体
- 资源预加载：`<link rel="preload">`、`<link rel="prefetch">`

**构建层：**
- 压缩 JS/CSS（Terser、cssnano）
- 提取公共依赖（SplitChunksPlugin）
- 持久化缓存：文件名带 content hash，配合长期 `Cache-Control`

#### 运行时优化

**渲染层：**
- 减少重排重绘：批量 DOM 操作、使用 `transform` 代替 `top/left`、`will-change` 提示
- 虚拟列表：大数据列表只渲染可视区域（`react-virtualized`、`react-window`）
- CSS 动画优先于 JS 动画（GPU 加速）
- `requestAnimationFrame` 替代 `setTimeout` 做动画
- 离屏 Canvas / Web Worker 处理 CPU 密集任务

**React 层：**
- `React.memo` / `useMemo` / `useCallback` 避免不必要的重渲染
- 合理拆分组件粒度，缩小重渲染范围
- `useTransition` 标记低优先级更新
- 虚拟化长列表
- 避免在 render 中创建新对象/函数

**内存层：**
- 及时清理定时器、事件监听、订阅
- 对象池复用（减少 GC 压力）
- `WeakMap` / `WeakRef` 避免内存泄漏
- `ImageBitmap.close()` 等主动释放底层资源

---

### 2. 懒加载是不是从代码路径的角度来优化的？原生 main.js 入口的懒加载实现

#### 懒加载的本质

是的，懒加载本质上是一种**代码路径优化**——通过改变代码的加载路径和时机，使初始加载只包含用户当前需要的代码，将其余代码推迟到需要时再加载。

核心思想：**把"一次性加载全部代码"变为"按需、分批加载代码"。**

#### 原生 JS 的懒加载实现

在没有框架和打包工具的原生环境中，懒加载主要依赖以下手段：

**方式一：动态 `<script>` 注入**

最原始的懒加载——需要时手动创建 `<script>` 标签插入 DOM：

```js
// main.js — 入口文件
document.getElementById('heavy-btn').addEventListener('click', () => {
  // 点击时才加载 heavy-module.js
  const script = document.createElement('script');
  script.src = './heavy-module.js';
  script.onload = () => {
    // heavy-module.js 加载并执行完毕后，全局变量可用
    window.HeavyModule.init();
  };
  document.head.appendChild(script);
});
```

缺点：需要手动管理全局变量、加载状态、错误处理，代码不够声明式。

**方式二：原生动态 `import()`（ES2020）**

浏览器原生支持的标准方案，`import()` 返回一个 Promise：

```html
<script type="module">
  // main.js — 顶层只加载核心代码
  import { renderHeader } from './header.js';
  renderHeader();

  // 懒加载：用户滚动到底部时才加载评论模块
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      // 动态 import() — 浏览器此时才发起网络请求
      import('./comments.js').then(({ renderComments }) => {
        renderComments();
      });
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById('comments-placeholder'));
</script>
```

关键点：
- `import()` 是**运行时执行的表达式**，不是编译期声明
- 浏览器遇到 `import()` 时才发起 HTTP 请求加载对应模块
- 文件扩展名**必须写全**（`.js`），浏览器不会自动补全
- 返回 Promise，天然支持 async/await

**方式三：`<script>` 标签的 `defer` / `async` 属性**

严格来说这不是"懒加载"，而是**加载时机优化**：

```html
<!-- defer：不阻塞 HTML 解析，DOM 构建完成后按顺序执行 -->
<script src="main.js" defer></script>

<!-- async：不阻塞 HTML 解析，下载完成后立即执行（不保证顺序） -->
<script src="analytics.js" async></script>
```

---

### 3. 框架中懒加载实现

#### React 中的懒加载

**`React.lazy()` + `Suspense`：**

```tsx
import { lazy, Suspense } from 'react';

// 路由级懒加载
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));

function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}
```

**`React.lazy` 的内部原理（源码级）：**

定义在 `packages/react/src/ReactLazy.js`，本质是一个状态机：

```js
// lazy 返回一个特殊的元素对象
function lazy(ctor) {
  return {
    $$typeof: REACT_LAZY_TYPE,
    _payload: { _status: Uninitialized, _result: ctor },
    _init: lazyInitializer,
  };
}

// 状态机：Uninitialized(-1) → Pending(0) → Resolved(1) / Rejected(2)
function lazyInitializer(payload) {
  if (payload._status === Uninitialized) {
    const thenable = payload._result();     // 执行 () => import('./xxx')
    payload._status = Pending;
    payload._result = thenable;
    thenable.then(
      module => { payload._status = Resolved; payload._result = module; },
      error  => { payload._status = Rejected; payload._result = error; }
    );
  }
  if (payload._status === Resolved) return payload._result.default;
  throw payload._result;  // Pending → 抛出 Promise → 触发 Suspense 显示 fallback
}
```

核心流程：
1. 首次渲染调用 `_init()`，执行动态 `import()`
2. Promise 未 resolve → **抛出 Promise** → Suspense 捕获 → 显示 fallback
3. Promise resolve → 组件模块加载完成 → 重新渲染 → 显示真实组件

#### Vue 中的懒加载

```js
// Vue Router 路由级懒加载
const routes = [
  {
    path: '/dashboard',
    component: () => import('./views/Dashboard.vue')  // 动态 import
  }
];

// defineAsyncComponent 组件级懒加载
import { defineAsyncComponent } from 'vue';
const AsyncModal = defineAsyncComponent(() => import('./components/Modal.vue'));
```

#### 打包工具层面

无论 React 还是 Vue，懒加载最终依赖**打包工具的代码分割能力**：

- **Webpack**：遇到动态 `import()` 自动创建新 chunk，生成独立的 JS 文件
- **Vite/Rollup**：同理，动态 import 边界就是 chunk 分割点
- 打包工具还负责：chunk 的命名（hash）、公共依赖提取、预加载 hint 注入

---

### 4. 编译角度：import 路径全部已知，"import 写在顶部实现按需加载"的观点是否不成立？

这道题的核心是区分**静态 `import` 声明**和**动态 `import()` 表达式**。

#### 面试官的核心论点

> "编译器在解析 main.js 时，所有 `import` 路径都已知了，那么'import 写在顶部来实现路径解析按需加载'的说法是否不成立？"

#### 正确回答：这个观点确实不精确，需要区分两种 import

**静态 `import` 声明（编译时确定）：**

```js
import React from 'react';
import { Button } from 'antd';
import utils from './utils';
```

- 这些 `import` 在**编译阶段**就被解析完毕
- 打包工具通过 AST 分析，在构建时已经知道所有依赖路径
- **它们无法实现"按需加载"**——所有静态 import 的模块都会被打包进初始 bundle
- "写在文件顶部"只是 ESM 规范的语法要求（静态 import 必须在模块顶层），**与按需加载无关**

**动态 `import()` 表达式（运行时执行）：**

```js
// 这个 import() 是一个运行时表达式，编译器不会将其视为静态依赖
button.addEventListener('click', () => {
  import('./heavy-module.js').then(module => {
    module.doSomething();
  });
});
```

- 这是一个**运行时才执行的函数调用**，不是声明
- 编译器确实能看到这个路径字符串 `'./heavy-module.js'`，但它的处理方式完全不同：
  - **不会**把 `heavy-module.js` 打包进主 bundle
  - 而是将其**拆分为独立 chunk**（单独的 JS 文件）
  - 运行时执行到这行代码时，才通过网络请求加载该 chunk

#### 所以正确的理解是

```
静态 import（顶部声明）
  → 编译时全部解析 → 全部打入主 bundle → ❌ 不能实现按需加载

动态 import()（代码中任意位置）
  → 编译时识别为分割点 → 拆为独立 chunk → ✅ 运行时按需加载
```

"按需加载"的实现靠的是**动态 `import()` 造成的 chunk 分割**，而不是"把 import 写在文件顶部"。

#### 补充：Tree Shaking 与静态 import 的关系

虽然静态 `import` 不能实现"按需加载（延迟加载整个模块）"，但它能实现 **Tree Shaking（按需打包）**：

```js
import { debounce } from 'lodash-es';
// 只有 debounce 被打包，其余函数被 tree-shake 掉
```

这是因为 ESM 的静态结构让编译器能分析出哪些 export 被引用、哪些没有。但这是**构建时的体积优化**，不是**运行时的加载优化**。

#### 总结

| | 静态 `import` | 动态 `import()` |
|---|---|---|
| 解析时机 | 编译时 | 编译时识别路径，运行时执行加载 |
| 打包行为 | 打入主 bundle | 拆为独立 chunk |
| 按需加载 | ❌ 不支持 | ✅ 支持 |
| Tree Shaking | ✅ 支持 | ❌ 不支持（整个模块都会被打包到 chunk 中） |
| 语法位置 | 必须在模块顶层 | 任意位置（条件语句、事件回调中） |

---

### 5. HTML 在获取之前可以采用的优化手段

"获取之前"意味着优化发生在**浏览器拿到 HTML 文档之前**，核心目标：缩短从用户发起请求到收到首字节（TTFB）的时间。

#### 一、DNS 层

| 手段 | 原理 | 收益 |
|---|---|---|
| DNS 预解析 | `<link rel="dns-prefetch" href="//api.example.com">` 提前解析域名 | 节省 20-120ms |
| DNS 缓存 | 浏览器/OS 缓存已解析的 DNS 记录，后续请求跳过解析 | 避免重复 DNS 查询 |
| HSTS Preload | 域名硬编码进浏览器源码，首次访问也跳过 HTTP→HTTPS 重定向 | 消除 1 次重定向 |

#### 二、连接层

| 手段 | 原理 | 收益 |
|---|---|---|
| 预连接 | `<link rel="preconnect" href="https://cdn.example.com">` 提前完成 DNS + TCP + TLS | 节省 100-500ms |
| HTTP/2 多路复用 | 单 TCP 连接复用多个请求流，消除队头阻塞 | 减少连接建立开销 |
| HTTP/3 QUIC | 基于 UDP，0-RTT 连接恢复，消除 TCP 队头阻塞 | 首字节快 12.4%，连接建立快 33% |
| Keep-Alive | 复用 TCP 连接，避免重复握手 | 减少后续请求延迟 |

#### 三、服务端渲染策略

| 手段 | 原理 | TTFB |
|---|---|---|
| SSG（静态生成） | 构建时生成 HTML，部署到 CDN | 20-50ms |
| ISR（增量静态再生） | SSG + 按需重新生成 | 近似 SSG |
| Edge SSR | 在 CDN 边缘节点执行 SSR | 37-60ms（热启动） |
| SSR | 每次请求服务端生成 HTML | 100-900ms |

#### 四、CDN 层

- **边缘缓存**：HTML 缓存在距用户最近的 CDN 节点
- **CDN 回源优化**：CDN 与源站之间的长连接、路由优化
- **边缘计算**：Cloudflare Workers / Vercel Edge Functions 在边缘节点执行逻辑

#### 五、HTTP 缓存策略

- **强缓存**：`Cache-Control: max-age=3600` — 缓存期内直接从本地读取，不发请求
- **协商缓存**：`ETag` + `If-None-Match` / `Last-Modified` + `If-Modified-Since` → 服务端返回 `304 Not Modified`（不传输 body）
- **`stale-while-revalidate`**：先用旧缓存响应，后台静默更新
- **Service Worker**：拦截请求，从缓存直接返回 HTML（第二次访问起生效）

#### 六、协议层优化

- **减少重定向**：每次重定向增加一次完整往返（DNS + TCP + TLS + HTTP）
- **Gzip / Brotli 压缩**：减少 HTML 传输体积 65-70%
- **HTTP 103 Early Hints**：服务端在计算 HTML 期间，先发送 `103` 响应告知浏览器预加载关键资源

```
浏览器请求 → 服务端发送 103 Early Hints
               Link: </style.css>; rel=preload; as=style
             → 浏览器开始加载 style.css
             → 服务端发送 200 + HTML（此时 CSS 可能已下载完毕）
```

#### 七、浏览器导航优化

- **bfcache（前进/后退缓存）**：浏览器缓存整个页面快照（包含 JS 堆），前进/后退时**瞬间恢复**
  - 10-20% 的导航是前进/后退（移动端占 20%）
  - 注意避免 bfcache 杀手：`Cache-Control: no-store`、`unload` 事件监听器
- **Speculation Rules API**：现代版 prerender

```html
<script type="speculationrules">
{
  "prerender": [
    { "where": { "href_matches": "/product/*" }, "eagerness": "moderate" }
  ]
}
</script>
```
浏览器在隐藏标签页中**完整预渲染**目标页面（包括 JS 执行），用户点击时**瞬间激活**。

---

## 三、手撕

### 一维数组转树结构

#### 题目

```js
const list = [
  { label: '1', id: 1, parentId: 0 },
  { label: '2', id: 2, parentId: 0 },
  { label: '3', id: 3, parentId: 0 },
  { label: '1-1', id: 4, parentId: 1 },
  { label: '2-1', id: 5, parentId: 2 },
  { label: '3-1', id: 6, parentId: 3 },
  { label: '1-1-1', id: 7, parentId: 4 },
];
```

#### 最优解：O(n) 哈希表法

```js
function arrayToTree(list, rootParentId = 0) {
  const map = {};    // id → 节点引用
  const tree = [];

  // 第一遍：为每个节点建立映射，并初始化 children
  for (const item of list) {
    map[item.id] = { ...item, children: [] };
  }

  // 第二遍：根据 parentId 将节点挂到父节点的 children 下
  for (const item of list) {
    const node = map[item.id];
    if (item.parentId === rootParentId) {
      tree.push(node);           // 根节点直接入结果数组
    } else {
      map[item.parentId].children.push(node);  // 挂到父节点
    }
  }

  return tree;
}
```

**时间复杂度：O(n)**，两次遍历。
**空间复杂度：O(n)**，哈希表存储所有节点。

#### 进阶：一遍遍历 O(n)

如果面试官要求只遍历一次：

```js
function arrayToTree(list, rootParentId = 0) {
  const map = {};
  const tree = [];

  for (const item of list) {
    // 当前节点可能已经被子节点提前创建了（作为占位父节点）
    if (!map[item.id]) {
      map[item.id] = { children: [] };
    }
    // 填充当前节点的数据
    map[item.id] = { ...item, children: map[item.id].children };

    const node = map[item.id];

    if (item.parentId === rootParentId) {
      tree.push(node);
    } else {
      // 父节点可能还没遍历到 → 先创建占位
      if (!map[item.parentId]) {
        map[item.parentId] = { children: [] };
      }
      map[item.parentId].children.push(node);
    }
  }

  return tree;
}
```

**关键点**：利用对象引用的特性——即使父节点还没遍历到，先创建一个 `{ children: [] }` 占位，后续遍历到父节点时填充数据，之前建立的引用关系依然有效。

#### 输出结果

```js
[
  {
    label: '1', id: 1, parentId: 0,
    children: [
      {
        label: '1-1', id: 4, parentId: 1,
        children: [
          { label: '1-1-1', id: 7, parentId: 4, children: [] }
        ]
      }
    ]
  },
  {
    label: '2', id: 2, parentId: 0,
    children: [
      { label: '2-1', id: 5, parentId: 2, children: [] }
    ]
  },
  {
    label: '3', id: 3, parentId: 0,
    children: [
      { label: '3-1', id: 6, parentId: 3, children: [] }
    ]
  }
]
```

#### 面试加分点

1. **为什么不用递归？** 递归法（每次 `filter` 找子节点）时间复杂度是 O(n²)，大数据量下性能差。哈希表法 O(n) 是最优。
2. **一遍遍历的技巧**：利用 JS 对象是引用类型，先建占位后填充。
3. **边界处理**：可以补充对 `parentId` 指向不存在节点的容错处理（孤儿节点）。
