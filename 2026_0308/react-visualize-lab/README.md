# React 高阶特性可视化实验室

> 配合 [react-advanced-features.md](../react-advanced-features.md) 文章使用，通过 5 个交互实验直观理解 Fiber、并发调度、Suspense 的底层原理。

## 启动

```bash
cd 2026_0308/react-visualize-lab
npm install
npm run dev
```

打开 http://localhost:5173，顶部 Tab 切换实验。

---

## 实验 1：渲染顺序（对应文章 1.3「两阶段渲染」）

**验证目标**：beginWork 向下遍历 → completeWork 向上回溯 → commit 三阶段的执行顺序。

**步骤**：

1. 打开浏览器控制台 (F12 → Console)
2. 页面加载后观察初始 mount 的 log：
   - 蓝色 = render 阶段（beginWork，从 App 一路向下到叶子节点）
   - 橙色 = useLayoutEffect（commit 同步阶段，从子到父）
   - 绿色 = useEffect（浏览器绘制后异步执行）
3. 点击「触发更新」按钮（会自动 clear 控制台）
4. 观察更新时的 log 顺序：
   - 红色 cleanup 先执行（旧 effect 清理）
   - 然后是新的 render → layout → passive

**预期结果**：

```
[render] App          ← beginWork 从根向下
[render] Header       ← 第一个子节点
[render] Content      ← 兄弟节点
[render] Item-A       ← Content 的子节点
[render] Item-B       ← 兄弟
[render] Item-C       ← 兄弟
[render] Footer       ← Content 的兄弟
                      ← completeWork 从叶子向上（无 log，但此时 DOM 已创建）
[useLayoutEffect] Header    ← commit layout 阶段（同步，浏览器还没绘制）
[useLayoutEffect] Item-A
...
[useLayoutEffect] Footer
                      ← 浏览器绘制
[useEffect] Header          ← passive effect（异步，绘制后）
[useEffect] Item-A
...
[useEffect] Footer
```

**对应源码**：`performUnitOfWork()` → `beginWork()` → `completeUnitOfWork()` → `commitRoot()`

---

## 实验 2：Diff 算法（对应文章 1.4「reconcileChildFibers」）

**验证目标**：理解两轮 Diff 和 `lastPlacedIndex` 优化——为什么「末尾移到开头」代价高。

**步骤**：

1. 页面显示初始列表 `[A, B, C, D]`
2. 依次点击以下按钮，观察右侧 Diff 分析面板：

| 操作 | 预期 DOM 操作 | 原因 |
|---|---|---|
| 末尾→开头 `[D,A,B,C]` | A,B,C 都移动 (3次) | D 的旧 idx=3 成为 lastPlacedIndex，A(0),B(1),C(2) 都 < 3 |
| 开头→末尾 `[B,C,D,A]` | 只移动 A (1次) | B(1),C(2),D(3) 递增不用动，只有 A(0) < lastPlaced(3) |
| 翻转 `[D,C,B,A]` | C,B,A 都移动 (3次) | D 不动，其余全部 < lastPlaced |
| 中间插入 `[A,B,E,C,D]` | 创建 E (1次) | 第一轮 A,B 匹配，E 不在旧列表中 → 新建 |
| 删除中间 `[A,D]` | 删除 B,C (2次) | B,C 在 Map 中未被匹配 → 删除 |

3. 观察左侧列表：绿色闪烁边框 = 新创建的 DOM 节点，无闪烁 = 复用的旧节点

**关键结论**：列表操作时，把元素往后移比往前移代价低。这就是为什么 React 文档强调 key 的重要性。

**对应源码**：`reconcileChildrenArray()` 的两轮算法 + `placeChild()` 中的 `lastPlacedIndex` 判断

---

## 实验 3：并发调度与时间切片（对应文章 2.4-2.5「shouldYieldToHost」）

**验证目标**：同步渲染 vs useTransition 的帧级别差异。

**步骤**：

1. **同步模式**：选择「同步模式」Tab → 快速输入文字 → 感受输入框卡顿
2. **并发模式**：选择「并发模式」Tab → 快速输入文字 → 输入流畅，列表延迟更新
3. **用 Performance 面板验证**：
   - 打开 Chrome DevTools → Performance
   - 点击录制按钮
   - 在同步模式下输入 3-4 个字符
   - 停止录制
   - 在 Main Thread 火焰图中找到长任务（红色三角标记）
4. 重复第 3 步，但在并发模式下录制
   - 观察：长任务被切成多个 ~5ms 的小块
   - 小块之间有空隙 = 浏览器有时间处理绘制和用户输入
5. **useDeferredValue**：选择第三个 Tab，观察 `input` 和 `deferredInput` 的值差异

**Performance 面板中你应该看到的**：

```
同步模式:
[======================== 500ms ========================]  ← 一个长任务，输入卡死

并发模式:
[==5ms==] gap [==5ms==] gap [==5ms==] gap [==5ms==]  ← 多个小块
           ↑           ↑
     浏览器绘制    可以响应新输入
```

**对应源码**：`workLoopConcurrent` 中的 `shouldYield()` 检查 + Scheduler 的 `frameInterval = 5ms`

---

## 实验 4：Suspense 机制（对应文章 3.1-3.5「异步渲染」）

**验证目标**：Suspense 的 "抛出 Promise" 模式和两遍渲染。

### Demo 1：基础 Suspense

**步骤**：

1. 打开控制台
2. 点击「加载数据」按钮
3. 观察控制台 log 顺序：

```
═══ 触发 Suspense ═══
[render] DataDisplay — 尝试获取数据...    ← 第一遍渲染
                                          ← fetchWithDelay() 抛出 Promise
[fallback] 显示 Loading: "基础数据"       ← Suspense 捕获 Promise，渲染 fallback

(等待 2 秒...)

[render] DataDisplay — 尝试获取数据...    ← Promise resolve → React 重新渲染
[render] DataDisplay — 数据已就绪 ✓       ← 这次 cache 命中，正常返回
```

4. 调整延迟滑块，观察不同等待时间的表现
5. 多次点击可能触发随机错误 → 观察 ErrorBoundary 如何捕获

### Demo 2：嵌套 Suspense

**步骤**：

1. 点击「加载数据」
2. 观察两个 Suspense 边界的独立行为：
   - 外层数据 1s 后加载完成 → 外层内容显示，内层仍显示 fallback
   - 内层数据 3s 后加载完成 → 内层 fallback 替换为真实内容
3. 内层 Suspense 不会影响外层已经显示的内容

### Demo 3：use() Hook

**步骤**：

1. 点击「创建 Promise 并用 use() 读取」
2. 观察控制台：`use()` 检查 Promise 状态 → pending 时 suspend → fulfilled 时返回值
3. 注意和 Demo 1 的区别：use() 直接接收 Promise 对象，不需要手动写 throw 逻辑

**对应源码**：`throwException()` → `ShouldCapture` → `unwindWork()` → `DidCapture` → 第二遍 `beginWork`

---

## 实验 5：Lane 优先级（对应文章 2.1「Lane 模型」）

**验证目标**：不同事件类型对应不同 Lane，高优先级可以打断低优先级。

**步骤**：

1. 点击「高优先级 (SyncLane)」→ 观察左侧 Lane 图表中 SyncLane 高亮
2. 点击「低优先级 (TransitionLane)」→ TransitionLanes 高亮，列表慢慢渲染
3. 点击「同时触发两个优先级」→ 观察：
   - 同步计数**立即**变化（SyncLane 先 commit）
   - Transition 计数**稍后**变化（TransitionLane 被调度到后面）
   - 右侧时间线显示两个事件的先后关系
4. 快速交替点击高/低优先级按钮，观察高优先级如何插队

**右侧时间线中你应该看到**：

```
+0ms   Click → setSyncCount     Lane: SyncLane         调度: ImmediatePriority
+1ms   startTransition → setList Lane: TransitionLane   调度: NormalPriority
```

**对应源码**：`requestUpdateLane()` 根据事件类型 / transition 上下文分配 Lane → `ensureRootIsScheduled()` 比较优先级决定是否取消旧任务

---

## 推荐学习路线

```
Day 1: 实验 1 + 实验 2
  ├── 跑完实验，建立"渲染就是树的遍历"的直觉
  └── 回读文章第一章：FiberNode 字段、双缓冲、两阶段渲染、Diff 算法

Day 2: 实验 3 + 实验 5
  ├── 用 Performance 面板亲眼看到时间切片
  ├── 理解 Lane 位掩码为什么用二进制
  └── 回读文章第二章：Lane 模型、ensureRootIsScheduled、Scheduler

Day 3: 实验 4
  ├── 理解 Suspense 的 throw/catch/re-render 模式
  ├── 理解 use() 与 await 的本质区别
  └── 回读文章第三章：throwException、两遍渲染、React.lazy、use()
```

核心原则：**先在浏览器里"看到"它发生，再回去读源码理解"为什么"。**
