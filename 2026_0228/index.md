# 2026.2.27 的面试——九坤投资 Converge AI

开始暑期久违的面了一场，我也看出了自己的面试状态有点问题。从这家顶级量化公司创办的 AI 公司中我也看到了九坤对实习生的要求——1.重基础 2.知道如何解决问题
面试官最初和我说面试不超过 30 分钟并且只会做题，我狗屎的面试表现只让面试官面了两个问题：

## 面试问题一：用 React 写一个每秒减 1 的倒计时，并且到 0 时结束（可以用搜索引擎，不可以用 AI）

使用 `npx create vite@latest` 进行初始化

### Follow up: 打开 main.tsx 看看其中的 StrictMode, 解决了什么问题？

我只是简答地回答了在严格模式下，像 useEffect 会渲染两次。（没有答到点，为后续埋下伏笔）

### 我的初始版本

```tsx
function App() {
  const [count, setCount] = useState(100)
  useEffect(() => {
    if (count === 0) return
    setTimeout(() => {
      setCount(prev => prev - 1)
    },1000)
  },[count])
  return (
    <div>
      count is {count}
    </div>
  )
}
```

但是这份代码从视觉上来看会有问题
![alt text](<CleanShot 2026-02-28 at 23.46.27.gif>)

刷新之后, 100 直接变成了 98 跳过了 99 ！

面试官开始引导，我也很快发现这是 StrictMode 的问题，我删了 StrictMode 的组件，从视觉上解决了这个问题。这也暴露了我对 StrictMode 理解不深刻，对 React 渲染机制的理解留于概念。

### Follow up: 不删除 StrictMode 的情况下，应该怎么去解决这个问题呢？

可惜学艺不精，只能投降，我也向面试官求教。他也直接指出给 useEffect 添加清除器 cleanup 就好了。

```tsx
function App() {
  const [count, setCount] = useState(100)
  useEffect(() => {
    if (count === 0) return
    const discount = setTimeout(() => {
      setCount(prev => prev - 1)
    },1000)

    return () => clearTimeout(discount)
  },[count])
  return (
    <div>
      count is {count}
    </div>
  )
}
```

根据[官方文档](https://react.dev/reference/react/StrictMode)

Strict Mode enables the following development-only behaviors:
严格模式启用以下仅限开发使用的行为：

- Your components will re-render an extra time to find bugs caused by impure rendering.
- 您的组件将额外重新渲染一次 ，以查找由不纯渲染引起的错误。
- Your components will re-run Effects an extra time to find bugs caused by missing Effect cleanup.
- 您的组件将额外重新运行一次效果， 以查找因缺少效果清理而导致的错误。
- Your components will re-run refs callbacks an extra time to find bugs caused by missing ref cleanup.
- 您的组件将额外重新运行一次 refs 回调， 以查找因缺少 ref 清理而导致的错误。
- Your components will be checked for usage of deprecated APIs.
- 系统将检查您的组件是否使用了已弃用的 API。


理解现象前，先把基本顺序对齐。

一次典型的更新（忽略 Suspense/并发打断等复杂情况）可以拆成三段：

1. **Render 阶段**：调用组件函数，读取 state，计算 JSX（纯计算）
2. **Commit 阶段**：把这次 render 的结果真正写进 DOM
3. **Effect 阶段**：在 commit 之后运行 `useEffect` 回调（也称 passive effects）

更新时还有一个关键点：

- 对同一个 effect：**先执行上一次的 cleanup，再执行这一次的 effect**

总的来说如下：

> **render（算）→ commit（改 DOM）→ cleanup（清上次）→ effect（跑本次）**

React 18 在 **开发环境** 的 StrictMode 下，会对“挂载相关副作用”做一次压力测试：

- **mount → effect → cleanup → mount → effect**

这意味着：

- 组件“看起来像挂载了两次”
- `useEffect` 在初次挂载时也会“看起来跑了两次”


> 这不是生产环境行为；生产环境不会做这次压力测试。


### 为什么没有 cleanup 时会出现 “100 → 98”？

根因：你创建了两个定时器

在 StrictMode 的流程里：

1. 第一次 mount：effect 运行，创建 `timeout#1`
2. 模拟卸载：如果**没有 cleanup**，`timeout#1` 不会被取消
3. 第二次 mount：effect 再运行，创建 `timeout#2`
4. 1 秒后：`timeout#1` 和 `timeout#2` 都触发，各执行一次 `setCount(...)`

于是同一秒内发生了两次递减，最终从 100 变成 98。

我对其的理解是因为 React 的批次处理。其中 batching 的角色：不是“让它变 98”，而是“让你只看到一次提交”

React 18 有**自动批处理**：同一个 tick 内多次 setState 可能会被合并成一次 commit。

所以看到的 UI 可能像“直接跳到 98”。

更准确的描述是：

- **两次 state 更新都发生了**
- **React 把它们批处理到一次渲染提交里**

### 其他坑点：函数式更新

`setCount(prev => prev - 1)` 为什么比 `setCount(count - 1)` 更可靠？

这是“闭包 + 多次更新”问题。定时器回调会捕获创建那一刻的 `count`。

- `setCount(count - 1)` 依赖闭包里的 `count`（可能过期）
- `setCount(prev => prev - 1)` 不依赖闭包，它的 `prev` 永远是 React 内部当前最新 state

经典例子（同一事件里连续更新两次）：

```tsx
// 可能只 +1（两次都用同一个旧 count）
setCount(count + 1)
setCount(count + 1)

// 一定 +2（每次都基于最新 prev）
setCount((prev) => prev + 1)
setCount((prev) => prev + 1)
```

因此：

- **函数式更新能累积多次更新**
- **闭包值更新可能覆盖成同一个结果，导致丢更新**


### 自我反思
面试官还和我提到了可以用 setInterval 来进行实现。
两者在浏览器层面语义不同：

- `setTimeout`：一次性触发
- `setInterval`：周期性触发

但在 React 中，写法是否“稳定”更多取决于：

- effect 是否会反复创建/清理定时器
- 回调是否依赖闭包旧值
- 是否在 StrictMode 下能正确清理

这是最典型的 interval 版本：

```tsx
useEffect(() => {
  let intervalId: number | undefined

  intervalId = window.setInterval(() => {
    setCount((prev) => {
      if (prev <= 1) {
        if (intervalId !== undefined) window.clearInterval(intervalId)
        return 0
      }
      return prev - 1
    })
  }, 1000)

  return () => {
    if (intervalId !== undefined) window.clearInterval(intervalId)
  }
}, [])
```
解析这段代码：

- `useEffect([])` 只在 mount 后运行一次，用来**安装** interval
- interval 回调里用 `prev`，不受闭包旧值影响
- `prev <= 1` 时清掉 interval，保证不会变负数
- cleanup 里清理 interval：
  - 组件卸载时防泄漏
  - StrictMode 压力测试时防止叠加多个 interval

这其中和 setTimeout 的写法一个明显的区别是，useEffect 的第二个参数没有对 count 进行监听，只在挂载时被执行一次。
真正每秒触发回调的是浏览器的事件循环（interval 自己在滴答）。React 并没有“每秒重新跑 effect”。



## 面试问题二：你知道什么会导致内存泄漏吗？

详见 [gc.md](./gc.md)——内存泄漏场景、排查方法、V8 GC 算法、WeakRef/WeakMap、生产监控方案。