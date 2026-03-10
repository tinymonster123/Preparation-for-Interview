# React 高阶特性：从源码角度的深度解析

> 基于 React 19 源码（`packages/react-reconciler/src/`），从 Fiber 架构、并发调度、异步渲染三个维度进行源码级剖析。

---

## 一、React 的渲染原理

### 1.1 Fiber 架构：核心数据结构

React 的渲染核心是 **Fiber 架构**。每个 React 元素（组件、DOM 节点、文本）都对应一个 `FiberNode`，定义在 `ReactFiber.js` 中。

#### FiberNode 关键字段

```ts
function FiberNode(tag, pendingProps, key, mode) {
  // === 静态数据 ===
  this.tag = tag;              // 组件类型标识：FunctionComponent(0), ClassComponent(1), HostRoot(3), HostComponent(5)...
  this.key = key;              // diff 时用于识别子节点身份
  this.elementType = null;     // React 元素的原始类型
  this.type = null;            // 解析后的组件类型（函数/类/字符串标签）
  this.stateNode = null;       // 关联实例：HostComponent -> DOM 节点，ClassComponent -> 类实例，HostRoot -> FiberRootNode

  // === 树结构（链表指针） ===
  this.return = null;          // 父 Fiber（命名为 return 是因为处理完当前节点后会"返回"父节点）
  this.child = null;           // 第一个子 Fiber
  this.sibling = null;         // 下一个兄弟 Fiber
  this.index = 0;              // 在兄弟节点中的位置索引

  // === 工作单元 / 状态 ===
  this.pendingProps = pendingProps;  // 即将应用的新 props
  this.memoizedProps = null;         // 上次渲染完成时的 props
  this.memoizedState = null;         // 上次渲染的 state（函数组件中是 hooks 链表头）
  this.updateQueue = null;           // 状态更新队列

  // === 副作用 ===
  this.flags = NoFlags;              // 当前节点的副作用标记（Placement, Update, Deletion 等）
  this.subtreeFlags = NoFlags;       // 子树副作用的并集（允许 commit 阶段跳过无副作用的子树）
  this.deletions = null;             // 需要删除的子 Fiber 数组

  // === 优先级 ===
  this.lanes = NoLanes;              // 32 位掩码，当前节点待处理的优先级
  this.childLanes = NoLanes;         // 子树待处理优先级的并集

  // === 双缓冲 ===
  this.alternate = null;             // 指向另一棵树中的对应 Fiber
}
```

#### 树结构的设计哲学

React **不使用传统的 children 数组**，而是用 `child`、`sibling`、`return` 三个指针组成单链表树。这个设计的关键好处是：**可以在任意节点暂停和恢复遍历**——当前位置就是 `workInProgress` 指针，不需要递归调用栈。

```
        App
       /
     div
    /
  span → p → a
```

### 1.2 双缓冲：Current 树与 WorkInProgress 树

React 同时维护两棵 Fiber 树（**双缓冲技术**）：

| 树 | 作用 |
|---|---|
| **Current 树** | 已经渲染到屏幕上的树，`FiberRootNode.current` 指向其根节点 |
| **WorkInProgress（WIP）树** | render 阶段正在构建的树，通过 `alternate` 字段与 Current 树互相引用 |

```
FiberRootNode.current  ──→  HostRoot Fiber (current)
                                 ↕ alternate
                             HostRoot Fiber (workInProgress)
```

`createWorkInProgress(current, pendingProps)` 函数（`ReactFiber.js`）负责创建或复用 WIP 节点：

```js
// 简化逻辑
function createWorkInProgress(current, pendingProps) {
  let workInProgress = current.alternate;
  if (workInProgress === null) {
    // 首次：创建新 Fiber 并建立双向链接
    workInProgress = createFiber(current.tag, pendingProps, current.key, current.mode);
    workInProgress.alternate = current;
    current.alternate = workInProgress;
  } else {
    // 复用：重置字段，避免内存分配
    workInProgress.pendingProps = pendingProps;
    workInProgress.flags = NoFlags;
    workInProgress.subtreeFlags = NoFlags;
    workInProgress.deletions = null;
  }
  return workInProgress;
}
```

Commit 阶段结束后，执行 `root.current = finishedWork`，WIP 树变为新的 Current 树，旧的 Current 树在下次渲染时被复用为 WIP 树。

### 1.3 两阶段渲染过程

#### 阶段一：Reconciliation（协调 / render 阶段）

**可中断**。入口是 `renderRootSync()` 或 `renderRootConcurrent()`（`ReactFiberWorkLoop.js`）。

**工作循环：**

```js
// 同步模式：一口气跑完
function workLoopSync() {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}

// 并发模式：每处理一个 Fiber 检查是否需要让出
function workLoopConcurrent() {
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}
```

**`performUnitOfWork` — 单个工作单元的处理：**

```js
function performUnitOfWork(unitOfWork) {
  const current = unitOfWork.alternate;
  // 向下：beginWork 返回第一个子节点
  const next = beginWork(current, unitOfWork, renderLanes);
  unitOfWork.memoizedProps = unitOfWork.pendingProps;

  if (next === null) {
    // 叶子节点：向上回溯
    completeUnitOfWork(unitOfWork);
  } else {
    // 有子节点：继续向下
    workInProgress = next;
  }
}
```

#### `beginWork` — 向下阶段（`ReactFiberBeginWork.js`）

对每个 Fiber 节点"进入"时调用，职责：

1. **判断是否需要更新**：比较 `current.memoizedProps` 与 `pendingProps`，检查 lanes
2. **无更新 → bailout**：调用 `bailoutOnAlreadyFinishedWork()`，但如果 `childLanes` 有待处理的工作，仍会继续遍历子节点
3. **有更新 → 计算新子节点**：调用组件函数 / render 方法
4. **Diff**：调用 `reconcileChildren()` 对比新旧子节点，生成新的子 Fiber

核心是一个大的 switch 语句：

```js
switch (workInProgress.tag) {
  case FunctionComponent:
    return updateFunctionComponent(current, workInProgress, ...);
    // 内部调用 renderWithHooks() → 执行函数组件 → 运行所有 hooks
  case ClassComponent:
    return updateClassComponent(current, workInProgress, ...);
  case HostComponent:     // <div>, <span> 等
    return updateHostComponent(current, workInProgress, ...);
  case HostRoot:
    return updateHostRoot(current, workInProgress, ...);
  case MemoComponent:
    return updateMemoComponent(current, workInProgress, ...);
  case SuspenseComponent:
    return updateSuspenseComponent(current, workInProgress, ...);
  // ... Fragment, ContextProvider, ForwardRef, LazyComponent 等
}
```

#### `completeWork` — 向上阶段（`ReactFiberCompleteWork.js`）

当 `beginWork` 返回 null（叶子节点）时，`completeUnitOfWork` 开始向上回溯：

```js
function completeUnitOfWork(unitOfWork) {
  let completedWork = unitOfWork;
  do {
    completeWork(current, completedWork, renderLanes);

    // 向上冒泡 subtreeFlags（关键优化）
    // returnFiber.subtreeFlags |= completedWork.subtreeFlags | completedWork.flags

    if (completedWork.sibling !== null) {
      workInProgress = completedWork.sibling;
      return;  // 处理兄弟节点（进入下一个 beginWork）
    }
    completedWork = completedWork.return;  // 回到父节点
    workInProgress = completedWork;
  } while (completedWork !== null);
}
```

`completeWork` 的核心职责：
- **HostComponent**：mount 时创建真实 DOM 节点（`createInstance()`）；update 时收集变化的 props（`diffProperties()`），存入 `updateQueue`
- **HostText**：创建或更新文本节点
- **冒泡 `subtreeFlags`**：让 commit 阶段知道哪些子树有副作用需要处理

#### 遍历顺序示例

```
树结构: App → div → [span, p]

beginWork(App)
  beginWork(div)
    beginWork(span)     ← 叶子
    completeWork(span)  ← 完成 span，移动到兄弟
    beginWork(p)        ← 叶子
    completeWork(p)     ← 完成 p，无兄弟，向上
  completeWork(div)     ← 完成 div，无兄弟，向上
completeWork(App)       ← 完成 App
```

#### 阶段二：Commit（提交阶段）

**同步、不可中断。** 入口是 `commitRoot()` → `commitRootImpl()`（`ReactFiberWorkLoop.js`）。

分为三个子阶段：

**子阶段 1：`commitBeforeMutationEffects`（DOM 变更前）**
- 读取 DOM 状态（如 `getSnapshotBeforeUpdate()`）
- 不做任何 DOM 变更

**子阶段 2：`commitMutationEffects`（DOM 变更）**
- 执行 DOM 插入、更新、删除
- 执行 `useInsertionEffect` 的 cleanup 和 setup
- 执行 `useLayoutEffect` 的 cleanup

**关键时刻 — 树交换：**
```js
root.current = finishedWork;
// 在 mutation 和 layout 之间执行
// componentWillUnmount 看到旧树，componentDidMount 看到新树
```

**子阶段 3：`commitLayoutEffects`（布局）**
- 执行 `componentDidMount` / `componentDidUpdate`
- 执行 `useLayoutEffect` 的 setup
- 挂载 refs

**异步副作用（Passive Effects）：**
- `useEffect` 的 cleanup 和 setup 在浏览器绘制后异步执行（`flushPassiveEffects()`）

### 1.4 Diff 算法：`reconcileChildFibers`

入口在 `ReactChildFiber.js`：

```js
function reconcileChildren(current, workInProgress, nextChildren, renderLanes) {
  if (current === null) {
    // 首次 mount：不追踪副作用
    workInProgress.child = mountChildFibers(workInProgress, null, nextChildren, renderLanes);
  } else {
    // 更新：追踪 Placement / Deletion 副作用
    workInProgress.child = reconcileChildFibers(workInProgress, current.child, nextChildren, renderLanes);
  }
}
```

两者由同一个工厂函数 `ChildReconciler(shouldTrackSideEffects)` 生成。

#### 三大启发式假设（O(n) 复杂度的基础）

1. **不同类型产生不同树**：`<div>` 变成 `<span>`，整个子树销毁重建
2. **兄弟节点通过 key 识别**：key 让 React 跨渲染匹配子节点
3. **只 Diff 同层级子节点**：跨层级移动会被视为删除+新建

#### 单元素 Diff：`reconcileSingleElement`

```js
function reconcileSingleElement(returnFiber, currentFirstChild, element, lanes) {
  let child = currentFirstChild;
  while (child !== null) {
    if (child.key === element.key) {
      if (child.elementType === element.type) {
        // key 和 type 都匹配 → 复用，删除剩余兄弟
        deleteRemainingChildren(returnFiber, child.sibling);
        const existing = useFiber(child, element.props);
        existing.return = returnFiber;
        return existing;
      }
      // key 匹配但 type 不同 → 删除所有旧子节点，跳出创建新节点
      deleteRemainingChildren(returnFiber, child);
      break;
    }
    // key 不匹配 → 仅删除当前子节点，继续检查兄弟
    deleteChild(returnFiber, child);
    child = child.sibling;
  }
  // 无可复用节点 → 创建新 Fiber
  const created = createFiberFromElement(element, returnFiber.mode, lanes);
  created.return = returnFiber;
  return created;
}
```

#### 多元素 Diff：`reconcileChildrenArray`（两轮算法）

**第一轮：线性扫描**

同时遍历旧 Fiber 链表和新 children 数组：

```js
for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
  const newFiber = updateSlot(returnFiber, oldFiber, newChildren[newIdx], lanes);
  if (newFiber === null) {
    break;  // key 不匹配 → 发现了位置变化，跳出第一轮
  }
  // 追踪 lastPlacedIndex，判断是否需要 DOM 移动
  lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
  oldFiber = oldFiber.sibling;
}
```

**边界情况处理：**
- 新 children 遍历完了 → `deleteRemainingChildren()` 删除剩余旧节点
- 旧 Fiber 遍历完了 → 为剩余新 children 创建新节点

**第二轮：Map 查找**

如果两边都有剩余，用旧 Fiber 的 key/index 建立 Map：

```js
const existingChildren = mapRemainingChildren(returnFiber, oldFiber);
// Map<key|index, Fiber>

for (; newIdx < newChildren.length; newIdx++) {
  const newFiber = updateFromMap(existingChildren, returnFiber, newIdx, newChildren[newIdx], lanes);
  if (newFiber !== null) {
    // 如果复用了旧节点，从 Map 中删除
    existingChildren.delete(newFiber.key ?? newIdx);
    lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
  }
}
// 删除 Map 中剩余的旧节点
existingChildren.forEach(child => deleteChild(returnFiber, child));
```

**`lastPlacedIndex` 优化**：React 只向前移动节点。维护"最后一个不需要移动的旧节点索引"，任何旧索引 < `lastPlacedIndex` 的节点都需要 DOM 移动（标记 `Placement`）。

> 这就是为什么把**最后一个元素移到最前面**代价高（所有其他元素都需要移动），而把**第一个元素移到最后面**代价低。

---

## 二、React 的并发机制

### 2.1 Lane 模型：二进制优先级系统

React 18 用 **31 位二进制掩码**（Lanes）替代了旧的 Expiration Time 模型。定义在 `ReactFiberLane.js` 中。

#### Lane 常量

```js
// 位越低 → 优先级越高
const NoLane =                        0b0000000000000000000000000000000;
const SyncHydrationLane =             0b0000000000000000000000000000001;  // 同步 hydration
const SyncLane =                      0b0000000000000000000000000000010;  // 同步（离散事件如 click）
const InputContinuousHydrationLane =  0b0000000000000000000000000000100;
const InputContinuousLane =           0b0000000000000000000000000001000;  // 连续输入（如 mousemove）
const DefaultHydrationLane =          0b0000000000000000000000000010000;
const DefaultLane =                   0b0000000000000000000000000100000;  // 默认优先级
const TransitionHydrationLane =       0b0000000000000000000000001000000;
const TransitionLanes =               0b0000000001111111111111110000000;  // 16 条 Transition 车道
const RetryLanes =                    0b0000111110000000000000000000000;  // 5 条重试车道
const IdleLane =                      0b0100000000000000000000000000000;  // 空闲
const OffscreenLane =                 0b1000000000000000000000000000000;  // 离屏渲染
```

#### 为什么用位掩码？

所有操作都是 O(1) 的位运算：

```js
mergeLanes(a, b)           →  a | b              // 合并优先级
includesSomeLane(a, b)     →  (a & b) !== 0      // 检测重叠
removeLanes(set, subset)   →  set & ~subset       // 移除优先级
getHighestPriorityLane(l)  →  l & -l              // 取最低位（最高优先级）
```

两个更新若处于同一 Lane，会被**批量处理**到同一次 render 中。

#### 三层优先级映射

```
Lane Priority          →  Event Priority              →  Scheduler Priority
(reconciler 内部)           (事件分类)                      (实际调度)
─────────────────────────────────────────────────────────────────────
SyncLane               →  DiscreteEventPriority        →  ImmediatePriority (1)
InputContinuousLane    →  ContinuousEventPriority      →  UserBlockingPriority (2)
DefaultLane            →  DefaultEventPriority         →  NormalPriority (3)
IdleLane               →  IdleEventPriority            →  IdlePriority (5)
```

#### 饥饿保护

React 追踪每个 Lane 的等待时长。如果低优先级 Lane 长时间未被处理，会被提升为 `SyncLane` 强制执行，防止无限饥饿。

### 2.2 调度核心：`ensureRootIsScheduled`

定义在 `ReactFiberWorkLoop.js`，是连接 React 协调器和 Scheduler 的桥梁。

```
setState()
  → scheduleUpdateOnFiber()
    → markRootUpdated(root, lane)  // 在 root.pendingLanes 中设置对应位
    → ensureRootIsScheduled(root)
```

**执行流程：**

```js
function ensureRootIsScheduled(root) {
  // 1. 获取最高优先级的待处理 Lane
  const nextLanes = getNextLanes(root, wipLanes);
  if (nextLanes === NoLanes) {
    // 无待处理工作 → 取消现有回调
    cancelCallback(existingCallbackNode);
    return;
  }

  // 2. Lane → Scheduler 优先级
  const schedulerPriorityLevel = lanesToEventPriority(nextLanes);

  // 3. 如果优先级没变，复用现有任务
  if (existingCallbackPriority === newCallbackPriority) return;

  // 4. 优先级变了 → 取消旧任务，调度新任务
  cancelCallback(existingCallbackNode);
  const newCallbackNode = scheduleCallback(
    schedulerPriorityLevel,
    performConcurrentWorkOnRoot.bind(null, root)
  );
  root.callbackNode = newCallbackNode;
  root.callbackPriority = newCallbackPriority;
}
```

#### React 19 微任务优化

React 19 中 `ensureRootIsScheduled` 使用 `queueMicrotask()` 延迟调度决策。`processRootScheduleInMicrotask` 在微任务中遍历所有待调度的 root，然后统一调度。这就是**自动批处理**的实现基础——即使跨 Promise 和 setTimeout 的 setState 也会被批处理。

### 2.3 Scheduler 包：时间切片引擎

独立包 `packages/scheduler/src/forks/Scheduler.js`，约 700 行代码。

#### 优先级与超时

```js
ImmediatePriority  = 1   // 超时: -1（已过期，立即执行）
UserBlockingPriority = 2  // 超时: 250ms
NormalPriority     = 3    // 超时: 5000ms
LowPriority        = 4    // 超时: 10000ms
IdlePriority       = 5    // 超时: maxSigned31BitInt（几乎不过期）
```

#### 数据结构：最小堆

```
taskQueue   — 就绪任务，按 expirationTime 排序（小顶堆）
timerQueue  — 延迟任务，按 startTime 排序（小顶堆）
```

实现在 `SchedulerMinHeap.js`：基于数组的 `push`、`pop`、`peek` 操作。

#### `unstable_scheduleCallback` — 任务调度入口

```js
function unstable_scheduleCallback(priorityLevel, callback, options) {
  const currentTime = getCurrentTime();
  const startTime = options?.delay ? currentTime + options.delay : currentTime;
  const timeout = timeoutForPriorityLevel(priorityLevel);
  const expirationTime = startTime + timeout;

  const newTask = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime,
    expirationTime,
    sortIndex: -1,
  };

  if (startTime > currentTime) {
    // 延迟任务 → 入 timerQueue
    newTask.sortIndex = startTime;
    push(timerQueue, newTask);
    requestHostTimeout(handleTimeout, startTime - currentTime);
  } else {
    // 就绪任务 → 入 taskQueue
    newTask.sortIndex = expirationTime;
    push(taskQueue, newTask);
    requestHostCallback(flushWork);
  }
  return newTask;
}
```

#### MessageChannel：时间切片的底层机制

```js
const channel = new MessageChannel();
const port = channel.port2;
channel.port1.onmessage = performWorkUntilDeadline;

// 调度下一个时间片
schedulePerformWorkUntilDeadline = () => {
  port.postMessage(null);
};
```

> 为什么用 `MessageChannel` 而不是 `setTimeout`？因为 `setTimeout(fn, 0)` 在嵌套 5 层后有 4ms 最小延迟限制，而 `MessageChannel` 作为宏任务没有这个限制。

#### Scheduler 工作循环

```js
function workLoop(hasTimeRemaining, initialTime) {
  let currentTime = initialTime;
  advanceTimers(currentTime);  // 将到期的 timerQueue 任务转移到 taskQueue
  currentTask = peek(taskQueue);

  while (currentTask !== null) {
    if (currentTask.expirationTime > currentTime
        && (!hasTimeRemaining || shouldYieldToHost())) {
      break;  // 时间片用尽且任务未过期 → 让出
    }

    const callback = currentTask.callback;
    if (typeof callback === 'function') {
      currentTask.callback = null;
      const continuationCallback = callback(currentTask.expirationTime <= currentTime);

      if (typeof continuationCallback === 'function') {
        // 任务未完成 → 保留在队列中，替换回调为续接函数
        currentTask.callback = continuationCallback;
      } else {
        if (currentTask === peek(taskQueue)) pop(taskQueue);
      }
    } else {
      pop(taskQueue);
    }

    advanceTimers(currentTime);
    currentTask = peek(taskQueue);
  }

  return currentTask !== null;  // 是否还有更多工作
}
```

**关键设计：续接函数（continuation）。** 如果 `callback` 返回一个函数，任务**不会**被弹出队列，而是用返回的函数替换回调。这就是 `performConcurrentWorkOnRoot` 被中断后能恢复的机制。

### 2.4 `shouldYieldToHost`：协作式让出

```js
function shouldYieldToHost() {
  const timeElapsed = getCurrentTime() - startTime;
  if (timeElapsed < frameInterval) {  // frameInterval = 5ms
    return false;   // 还有时间，继续
  }
  return true;      // 5ms 用完，让出给浏览器
}
```

- `startTime` 在每次 `performWorkUntilDeadline` 开始时设置
- 默认时间片 **5ms**（Transition 优先级工作可能使用 25ms 以减少开销）
- 让出后浏览器可以处理绘制、输入事件等

### 2.5 并发渲染的完整流程

```
用户点击按钮
  → 事件处理器中 setState()
  → requestUpdateLane(fiber) → 返回 SyncLane（click 是离散事件）
  → scheduleUpdateOnFiber(fiber, lane)
  → markRootUpdated(root, lane)        // root.pendingLanes |= lane
  → ensureRootIsScheduled(root)
     → getNextLanes() → 取最高优先级 Lane
     → lanesToEventPriority() → 映射到 Scheduler 优先级
     → scheduleCallback(priority, performConcurrentWorkOnRoot)
        → 创建 task 推入 taskQueue（最小堆）
        → port.postMessage(null)  // 通过 MessageChannel 调度
  → 浏览器让出，MessageChannel 触发
  → performWorkUntilDeadline()
     → Scheduler workLoop 处理任务
        → performConcurrentWorkOnRoot(root)
           → shouldTimeSlice? → renderRootConcurrent / renderRootSync
              → workLoopConcurrent: while(wip && !shouldYield()) performUnitOfWork
              → shouldYield() 返回 true → 中断，返回续接函数
           → 渲染完成 → commitRoot()
```

### 2.6 `useTransition` 与 `startTransition`

定义在 `ReactFiberHooks.js`。

#### 内部结构

```js
function mountTransition() {
  const [isPending, setPending] = mountState(false);
  const start = startTransition.bind(null, setPending);
  const hook = mountWorkInProgressHook();
  hook.memoizedState = start;
  return [isPending, start];
}
```

#### 两阶段 setState 模式

调用 `startTransition(callback)` 时：

**阶段 1 — 同步设置 `isPending = true`：**
- `ReactCurrentBatchConfig.transition` 此时为 null
- `setPending(true)` 以 `SyncLane` 优先级分发
- 用户立即看到 pending 状态

**阶段 2 — 以 Transition 优先级执行回调：**
- `ReactCurrentBatchConfig.transition` 设为非空对象
- 回调中的 `setState` 调用 `requestUpdateLane()`，检测到 transition 上下文 → 返回 `TransitionLane`
- `setPending(false)` 也以 `TransitionLane` 分发
- 恢复 `ReactCurrentBatchConfig.transition`

```js
function requestUpdateLane(fiber) {
  const transition = requestCurrentTransition();
  if (transition !== null) {
    return requestTransitionLane();  // 从 16 条 TransitionLane 中轮询分配
  }
  // 否则根据事件类型返回对应 Lane
}
```

#### 为什么 Transition 可以被中断？

`TransitionLane`（第 7-22 位）优先级低于 `SyncLane`（第 1 位）和 `InputContinuousLane`（第 3 位）。当 Transition 渲染进行中时，如果用户输入触发了更高优先级的更新，`ensureRootIsScheduled` 会取消当前的 Transition 渲染，优先处理高优先级更新。

---

## 三、React 的异步渲染

### 3.1 Suspense 机制："抛出 Promise"模式

#### `throwException` — 核心捕获逻辑

定义在 `ReactFiberThrow.js`。当组件在 render 阶段抛出异常时：

```js
function throwException(root, returnFiber, sourceFiber, value, rootRenderLanes) {
  // 1. 标记源 Fiber 为未完成
  sourceFiber.flags |= Incomplete;

  // 2. 判断抛出的值是否是 thenable（Promise）
  if (typeof value === 'object' && value !== null && typeof value.then === 'function') {
    const wakeable = value;

    // 3. 向上找最近的 Suspense 边界
    const suspenseBoundary = getNearestSuspenseBoundaryToCapture(returnFiber);

    if (suspenseBoundary !== null) {
      // 4. 标记 Suspense 边界需要捕获
      suspenseBoundary.flags |= ShouldCapture;

      // 5. 挂载监听器
      attachPingListener(root, wakeable, rootRenderLanes);
      attachRetryListener(suspenseBoundary, root, wakeable, rootRenderLanes);
      return;
    }
  }
  // 否则作为普通错误处理 → Error Boundary
}
```

#### 两遍渲染技术

**第一遍（尝试渲染内容）：** React 正常渲染 Suspense 内的子组件。子组件抛出 Promise → 异常向上传播。

**回退阶段（Unwind）：** `completeUnitOfWork()` 处理未完成的 Fiber。从抛出异常的组件到 Suspense 边界的所有 Fiber 标记为 `Incomplete`。到达 Suspense 边界时，`unwindWork()`（`ReactFiberUnwindWork.js`）转换标志：

```js
// unwindWork 中
if (flags & ShouldCapture) {
  workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
  return workInProgress;  // 返回 Suspense fiber 本身，重新进入 beginWork
}
```

**第二遍（渲染 fallback）：** 工作循环对 Suspense fiber 重新执行 `beginWork`。在 `updateSuspenseComponent()` 中：

```js
const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;
if (didSuspend) {
  showFallback = true;                    // 这次渲染 fallback
  workInProgress.flags &= ~DidCapture;    // 清除标志，为下次尝试做准备
}
```

### 3.2 Suspense 边界的内部结构

#### Fiber 类型

```js
// ReactWorkTags.js
SuspenseComponent  = 13
OffscreenComponent = 22
```

#### 内部 Fiber 树结构

Suspense 不直接持有子节点，而是包裹在 `OffscreenComponent` 中：

**显示内容时：**
```
Suspense
  └── OffscreenComponent (mode: "visible")
        └── [primary children]     ← 实际内容
```

**显示 fallback 时：**
```
Suspense
  ├── OffscreenComponent (mode: "hidden")   ← 内容被隐藏但保留在树中
  │     └── [primary children]
  └── Fragment
        └── [fallback children]    ← 加载指示器
```

> **关键设计**：主内容在 fallback 显示期间**不会被卸载**，只是 OffscreenComponent 切换为 hidden 模式。这保留了组件状态（hooks、refs），Promise resolve 后可以无缝恢复。

### 3.3 Promise 追踪与重试

#### `attachPingListener` — 并发模式恢复

```js
function attachPingListener(root, wakeable, lanes) {
  let pingCache = root.pingCache;
  let threadIDs;
  if (pingCache === null) {
    pingCache = root.pingCache = new WeakMap();
    threadIDs = new Set();
    pingCache.set(wakeable, threadIDs);
  } else {
    threadIDs = pingCache.get(wakeable);
    if (threadIDs === undefined) {
      threadIDs = new Set();
      pingCache.set(wakeable, threadIDs);
    }
  }

  if (!threadIDs.has(lanes)) {
    threadIDs.add(lanes);
    const ping = pingSuspendedRoot.bind(null, root, wakeable, lanes);
    wakeable.then(ping, ping);  // resolve 和 reject 都触发
  }
}
```

#### 重试流程

```
Promise resolve
  → ping 回调触发
  → pingSuspendedRoot(root, wakeable, lanes)
  → markRootPinged(root, lanes)        // 标记可以重试
  → ensureRootIsScheduled(root)        // 调度新 render
  → 新 render 中 updateSuspenseComponent() 看到没有 DidCapture
  → 渲染主内容（这次成功了）
  → fallback 被替换为真实内容
```

### 3.4 `React.lazy` 的内部实现

定义在 `packages/react/src/ReactLazy.js`。

```js
function lazy(ctor) {
  return {
    $$typeof: REACT_LAZY_TYPE,
    _payload: {
      _status: Uninitialized,  // -1
      _result: ctor,
    },
    _init: lazyInitializer,
  };
}
```

#### 状态机

```js
const Uninitialized = -1;
const Pending = 0;
const Resolved = 1;
const Rejected = 2;

function lazyInitializer(payload) {
  if (payload._status === Uninitialized) {
    const ctor = payload._result;
    const thenable = ctor();         // 执行 () => import('./Component')
    thenable.then(
      moduleObject => {
        if (payload._status === Pending || payload._status === Uninitialized) {
          payload._status = Resolved;
          payload._result = moduleObject;
        }
      },
      error => {
        if (payload._status === Pending || payload._status === Uninitialized) {
          payload._status = Rejected;
          payload._result = error;
        }
      }
    );
    if (payload._status === Uninitialized) {
      payload._status = Pending;
      payload._result = thenable;
    }
  }
  if (payload._status === Resolved) {
    return payload._result.default;  // 返回模块的 default 导出
  }
  throw payload._result;             // Pending → 抛出 Promise，触发 Suspense
}                                     // Rejected → 抛出 Error，触发 Error Boundary
```

### 3.5 `use()` Hook 的内部实现

定义在 `ReactFiberHooks.js`，是 React 19 引入的关键 Hook。

#### 类型分发

```js
function use(usable) {
  if (usable !== null && typeof usable === 'object') {
    if (typeof usable.then === 'function') {
      return useThenable(usable);        // Promise
    }
    if (usable.$$typeof === REACT_CONTEXT_TYPE) {
      return readContext(usable);         // Context
    }
  }
  throw new Error('An unsupported type was passed to use()');
}
```

#### `trackUsedThenable` — 核心逻辑

```js
function trackUsedThenable(thenableState, thenable, index) {
  // 1. 去重：如果同一位置已有 thenable，复用
  const previous = thenableState[index];
  if (previous !== undefined) {
    thenable = previous;
  } else {
    thenableState[index] = thenable;
  }

  // 2. 检查 Promise 状态（React 直接修改 Promise 对象，添加 status/value/reason 属性）
  switch (thenable.status) {
    case 'fulfilled':
      return thenable.value;             // 已解决 → 直接返回值
    case 'rejected':
      throw thenable.reason;             // 已拒绝 → 抛出错误
    default:
      // pending → 挂载 .then() 回调设置 status/value/reason
      if (typeof thenable.status !== 'string') {
        thenable.status = 'pending';
        thenable.then(
          fulfilledValue => {
            if (thenable.status === 'pending') {
              thenable.status = 'fulfilled';
              thenable.value = fulfilledValue;
            }
          },
          error => {
            if (thenable.status === 'pending') {
              thenable.status = 'rejected';
              thenable.reason = error;
            }
          }
        );
      }
      throw SuspenseException;           // 抛出特殊标记 → 触发 Suspense
  }
}
```

#### `use()` 与 `await` 的本质区别

| | `await` | `use()` |
|---|---|---|
| 恢复方式 | 在**同一位置**继续执行 | **整个组件从头重新渲染**，`use()` 返回 resolved 值 |
| 运行环境 | 异步函数 | React 组件（render 阶段） |
| 可条件调用 | 是 | 是（不像其他 hooks 依赖调用顺序） |

### 3.6 流式 SSR：`renderToPipeableStream` 与 Fizz

Fizz 是 React 的服务端渲染引擎，定义在 `packages/react-server/src/ReactFizzServer.js`。

#### 核心数据结构

**Request** — 顶层状态：
- `destination`：输出目标（Node.js stream）
- `pendingRootTasks`：未完成的根级任务
- `completedBoundaries`：已完成的 Suspense 边界
- `pingedTasks`：被唤醒的任务队列

**Segment** — HTML 输出单元：
- `status`：`PENDING` / `COMPLETED` / `FLUSHED`
- `chunks`：HTML 字符串/buffer 数组

**SuspenseBoundary** — 边界分组：
- `completedSegments`：已完成的 Segment
- `fallbackAbortableTasks`：可取消的 fallback 任务

#### 流式渲染流程

```
1. Shell 渲染（同步）
   └── 渲染到第一个 <Suspense> 边界
   └── onShellReady 触发 → 开始向客户端发送 HTML

2. 边界 Suspend
   └── 遇到未 resolve 的 Promise
   └── 发送 fallback HTML 作为占位

3. Promise Resolve
   └── Fizz 渲染完成的内容到新 Segment
   └── 以 <script> 标签注入，替换 fallback

4. 客户端 Hydration
   └── 从 HTML 重建交互性
   └── 未完成的边界在客户端继续 Suspend
```

### 3.7 Server Components 与异步渲染

#### Flight 协议

Server Components 使用 **Flight 协议** 序列化：

| 文件 | 方向 |
|---|---|
| `ReactFlightServer.js` | Server → Client 编码 |
| `ReactFlightClient.js` | Client 解码 |

Flight 将 React 树序列化为流式文本格式，每一行/块代表已解析的组件树片段。

#### 异步 Server Components

```jsx
async function Note({ id }) {
  const note = await db.notes.get(id);  // 直接 await，不需要 useEffect
  return <p>{note.body}</p>;
}
```

Server Component await 时，Flight 输出一个 lazy 引用。Promise resolve 后，完成的数据块流式发送到客户端。客户端 `ReactFlightClient.js` 增量接收并通过标准 React 协调器将其渲染到 DOM。

#### Fizz vs Flight

| | Fizz | Flight |
|---|---|---|
| 输出 | **HTML 字符串** | **序列化的 React 树**（Flight payload） |
| 用途 | SSR（`renderToPipeableStream`） | RSC 通信 |
| 客户端处理 | Hydration | React 协调器渲染 |

Next.js 等框架**同时使用两者**：Flight 传输 RSC payload，Fizz 将 payload 渲染为初始 HTML。

#### 端到端流程：Server Components + Suspense + `use()`

```jsx
// Server Component：在服务端启动数据获取
async function Page() {
  const dataPromise = fetchData();     // 服务端开始 fetch
  return <ClientComponent data={dataPromise} />;
}

// Client Component：用 use() 读取服务端传来的 Promise
'use client';
function ClientComponent({ data }) {
  const resolved = use(data);          // Promise 未完成 → Suspense
  return <div>{resolved}</div>;        // Promise 完成 → 返回数据
}
```

Promise 通过 Flight 协议跨服务端/客户端边界序列化。客户端 `use()` 读取已解析的值或 suspend 直到流式数据块到达。

---

## 源码文件速查表

| 文件路径 | 核心内容 |
|---|---|
| `ReactFiber.js` | FiberNode 构造函数，`createWorkInProgress()` |
| `ReactFiberRoot.js` | FiberRootNode，`createFiberRoot()` |
| `ReactWorkTags.js` | Fiber 类型常量 |
| `ReactFiberFlags.js` | 副作用标志常量 |
| `ReactFiberLane.js` | Lane 常量与位操作工具函数 |
| `ReactFiberWorkLoop.js` | `workLoopSync/Concurrent`，`performUnitOfWork`，`commitRoot`，`ensureRootIsScheduled` |
| `ReactFiberBeginWork.js` | `beginWork()`，各种 `update***Component` |
| `ReactFiberCompleteWork.js` | `completeWork()`，DOM 创建与 prop diff |
| `ReactFiberCommitWork.js` | 三个 commit 子阶段 |
| `ReactChildFiber.js` | `reconcileChildFibers`，Diff 算法 |
| `ReactFiberHooks.js` | `renderWithHooks()`，所有 Hook 实现，`use()` |
| `ReactFiberThrow.js` | `throwException()`，Suspense 捕获逻辑 |
| `ReactFiberUnwindWork.js` | `unwindWork()`，`ShouldCapture → DidCapture` |
| `ReactLazy.js` | `lazy()`，`lazyInitializer()` |
| `Scheduler.js` | Scheduler 工作循环，时间切片，`shouldYieldToHost` |
| `SchedulerMinHeap.js` | 最小堆实现 |
| `ReactFizzServer.js` | Fizz SSR 引擎 |
| `ReactFlightServer.js` | Flight RSC 协议编码 |
| `ReactFlightClient.js` | Flight RSC 协议解码 |
