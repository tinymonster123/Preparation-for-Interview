# React 源码自问自答

---

## Session 1：Fiber 遍历机制

### Q1: workLoopConcurrent 为什么用 while 循环而不用递归？workInProgress 是全局变量吗？

### 验证：workInProgress 确实是模块级变量

在 React 源码 `ReactFiberWorkLoop.js` 中，`workInProgress` 是一个**模块作用域的可变变量**（module-scoped mutable variable），不是函数内的局部变量：

```js
// ReactFiberWorkLoop.js 模块顶层
let workInProgress = null;
let workInProgressRoot = null;
let workInProgressRootRenderLanes = NoLanes;
```

它的生命周期：
1. **初始化**：`prepareFreshStack(root, lanes)` 中设置 `workInProgress = createWorkInProgress(root.current, null)`
2. **遍历中更新**：`performUnitOfWork` 中不断修改 `workInProgress = next`（子节点）或 `workInProgress = sibling`（兄弟）或 `workInProgress = returnFiber`（父节点）
3. **完成后重置**：`commitRootImpl` 中 `workInProgress = null`

### 为什么不用递归？

核心原因：**递归的执行状态在 JS 调用栈中，你无法控制；while 的执行状态在你自己的变量中，你可以随时暂停。**

对比：

```
递归方案：
  renderNode(App)
    → renderNode(div)      ← 调用栈第 2 层
      → renderNode(span)   ← 调用栈第 3 层
        → ...               ← 无法在这里暂停，调用栈是引擎管理的

while 方案：
  workInProgress = App   → performUnitOfWork → workInProgress = div
  workInProgress = div   → performUnitOfWork → workInProgress = span
  workInProgress = span  → shouldYield() === true → 跳出 while
  // workInProgress 仍然指向 span，下次从 span 继续
```

这就是 Fiber 架构的核心设计动机：**把递归的树遍历改造成可中断的迭代遍历**。

### 为什么用 child/sibling/return 三指针而不用 children 数组？

因为三指针让 `performUnitOfWork` 内部不需要任何循环或递归来"选择下一个节点"，每一步都是 O(1) 的指针赋值：

```js
// 伪代码：performUnitOfWork 的导航逻辑
const next = beginWork(workInProgress);  // 返回第一个 child
if (next !== null) {
  workInProgress = next;                 // 有 child → 向下（child 指针）
} else {
  // completeUnitOfWork：
  if (fiber.sibling !== null) {
    workInProgress = fiber.sibling;      // 有兄弟 → 横移（sibling 指针）
  } else {
    workInProgress = fiber.return;       // 无兄弟 → 向上（return 指针）
  }
}
```

如果用 `children` 数组，你还需要一个 index 变量来记录"当前遍历到第几个子节点"，复杂度更高。三指针把树结构扁平化成了一条链路，遍历变成了"沿着链路走"。

### 总结

| 方案 | 状态存储 | 可中断 | 恢复方式 |
|---|---|---|---|
| 递归 | JS 调用栈（引擎管理） | 不可以 | 无法恢复 |
| while + 全局指针 | 模块变量 `workInProgress`（自己管理） | 可以 | 下次进入 while 时从指针位置继续 |

这就是 React 16 从 Stack Reconciler 重写为 Fiber Reconciler 的根本原因：**把引擎控制的递归调用栈，替换为自己控制的 Fiber 链表 + 全局指针。**

### Q2: completeUnitOfWork 中，completeWork 为什么放在 do 循环首行？

疑问：`completeWork(completedWork)` 不应该在判断 sibling/child 条件之后吗？

答案：**进入 `completeUnitOfWork` 时，条件已经在上层判断过了。**

```js
function performUnitOfWork(unitOfWork) {
  const next = beginWork(unitOfWork);
  if (next === null) {
    // ← 走到这里 = 已经确认没有 child
    // ← 所以这个节点可以 complete
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}
```

do...while 循环中每一轮的逻辑：
- **首次进入**：`performUnitOfWork` 已确认没有 child → 可以 complete
- **循环上楼后**：当前节点没有 sibling → 说明父节点的所有子节点都完成了 → 父节点也可以 complete

能执行到 `completeWork(x)` 这一行本身就是条件成立的证明，不需要再判断。

### Q3: completeUnitOfWork 中 workInProgress 和 completedWork 如何变化？

两个变量的角色：
- `completedWork` = 当前实际在处理的节点
- `workInProgress` = 模块级指针，告诉 workLoop 下一步去哪

向上回溯时两者**始终同步**（指向同一节点）。唯一分叉的时刻是发现兄弟节点时：

```js
if (completedWork.sibling !== null) {
  workInProgress = completedWork.sibling;  // 导航牌指向兄弟
  return;  // 跳出函数，让 workLoop 对兄弟执行 beginWork
}
completedWork = completedWork.return;  // 没兄弟 → 两个变量一起上楼
workInProgress = completedWork;
```

以 `App → div → [span, p]` 为例：

```
completeUnitOfWork(span):
  completeWork(span) → span.sibling = p → workInProgress = p → return
  （回到 workLoop → beginWork(p) → completeUnitOfWork(p)）

completeUnitOfWork(p):
  第1轮: completeWork(p) → 没 sibling → completedWork = div, wip = div
  第2轮: completeWork(div) → 没 sibling → completedWork = App, wip = App
  第3轮: completeWork(App) → 没 sibling → completedWork = null, wip = null
  → while 条件 false → 结束 → workLoop 也结束 → render 阶段完成
```

---

## Session 2：beginWork vs completeWork 的职责分工

### Q4: 为什么 beginWork 功能这么多，而 completeWork 相对简单？

因为它们做的是完全不同的两件事：

```
beginWork  = "计算"：这个组件应该渲染出什么子节点？（大脑）
completeWork = "收集"：这个节点的 DOM 该怎么处理？（手脚）
```

beginWork 功能多是因为**所有组件类型的差异都集中在这里**：

| 组件类型 | beginWork 干什么 | completeWork 干什么 |
|---|---|---|
| FunctionComponent | 执行函数 + hooks + Diff | 无 |
| ClassComponent | 调用 render() + 生命周期 + Diff | 无 |
| HostComponent | 从 props 取 children + Diff | 创建/更新 DOM 节点 |
| SuspenseComponent | 判断是否 suspend + 切换 fallback | 控制显隐 |
| MemoComponent | 浅比较 props 决定跳过 + Diff | 无 |

beginWork 承载四大职责：
1. **bailout 优化**（props 没变？lanes 没命中？→ 跳过）
2. **执行组件逻辑**（函数组件的 hooks、类组件的生命周期）
3. **Diff 算法**（reconcileChildren）
4. **返回 child**（决定遍历下一步去哪）

completeWork 基本只关心 HostComponent 的 DOM 操作 + 冒泡 subtreeFlags。

### Q5: render 阶段操作的是真实 DOM 还是虚拟 DOM？

**render 阶段不操作真实 DOM。** 更准确地说，React 里没有独立的"虚拟 DOM"，Fiber 树本身就是虚拟 DOM。

```
早期说法（React 15）：虚拟 DOM = JS 对象树，描述 UI 长什么样
现在（React 16+）：  Fiber 树 = 那棵 JS 对象树 + 调度信息（lanes、flags、alternate...）
```

render 阶段的 completeWork 只做准备工作：

```
mount 时 → document.createElement('div') 创建 DOM 节点
           存到 fiber.stateNode，但不插入页面

update 时 → diffProperties() 算出变化
            存到 fiber.updateQueue，不修改 DOM
            给 fiber.flags 标记 Update
```

commit 阶段才读标记操作真实 DOM：

```
flags 有 Placement → parentNode.appendChild(fiber.stateNode)  插入
flags 有 Update    → el.className = 'active'                  修改
flags 有 Deletion  → parentNode.removeChild(...)              删除
```

**这就是 render 阶段可以中断的根本原因**——只操作内存中的 Fiber 节点，没碰真实 DOM，中断了用户也看不出来。commit 阶段不可中断，因为改了一半 DOM 用户会看到不一致的界面。

面试表述：「Fiber 就是虚拟 DOM 的升级版，多了可中断调度的能力。」

### Q6: StrictMode 是通过 beginWork 的 switch case 处理的吗？

**不是。** StrictMode 和普通组件的处理方式完全不同。

#### 两套机制的区别

```
普通组件（div, App...）→ 靠 fiber.tag 区分 → beginWork 的 switch case 处理
StrictMode             → 靠 fiber.mode 位掩码 → 向下继承 → 在各执行点检查
```

#### fiber.tag vs fiber.mode

React 有两个不同的标识系统：

- `fiber.tag`（ReactWorkTags.js）：组件**类型**，决定 beginWork 怎么处理

  ```js
  FunctionComponent = 0
  ClassComponent = 1
  HostRoot = 3
  HostComponent = 5
  Mode = 8            // ← StrictMode 的 tag 是这个
  ```

- `fiber.mode`（ReactTypeOfMode.js）：**模式位掩码**，向下继承给所有子孙

  ```js
  NoMode =         0b0000000
  StrictMode =     0b0000001   // ← 这个位
  ConcurrentMode = 0b0000010
  ProfileMode =    0b0000100
  ```

#### 处理流程

```
<StrictMode>
  <App />
</StrictMode>
```

1. **创建 Fiber 时**：识别 `REACT_STRICT_MODE_TYPE` → 创建 `tag = Mode` 的 Fiber → 在 `fiber.mode` 上设置 `StrictMode` 位

2. **beginWork 时**：

   ```js
   switch (workInProgress.tag) {
     case Mode:
       return updateMode(current, workInProgress, renderLanes);
       // updateMode 几乎什么都不做，和 Fragment 一样
       // 只是 reconcileChildren，然后透传
   }
   ```

3. **关键：mode 向下继承**

   ```js
   // 创建子 Fiber 时
   childFiber.mode = parentFiber.mode;  // 位掩码直接继承
   ```

   所以 `<StrictMode>` 下面所有子孙 Fiber 的 `mode` 都带有 `StrictMode` 位。

4. **真正生效的地方**——散落在各处的 mode 检查：

   ```js
   // renderWithHooks 中（执行函数组件时）
   if (workInProgress.mode & StrictMode) {
     Component(props);  // 第一次执行（丢弃结果）
     Component(props);  // 第二次执行（使用结果）
   }

   // commitHookEffectListMount 中（执行 useEffect 时）
   if (fiber.mode & StrictMode) {
     // setup → cleanup → 再 setup（检测 effect 是否正确清理）
   }
   ```

#### 总结

StrictMode 在 beginWork 里有一个 `case Mode`，但那个 case **几乎是空的**（和 Fragment 一样透传）。它真正的工作方式是：通过 `fiber.mode` 位掩码向下继承，在 `renderWithHooks`、`commitEffects` 等具体执行点检查这个位，触发双重执行和废弃 API 警告。**它是一个全局开关，不是一个需要特殊渲染的组件。**
