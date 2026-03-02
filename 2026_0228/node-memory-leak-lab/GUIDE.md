# Node.js 内存泄漏排查实战

## 面试回答框架

### 一、哪些场景会造成内存泄漏？

| 场景 | 文件 | 运行 |
|------|------|------|
| 1. 全局变量无限增长 | `01-global-variable.js` | `npm run leak1` |
| 2. 闭包持有大对象引用 | `02-closure.js` | `npm run leak2` |
| 3. EventEmitter 监听器未移除 | `03-event-listener.js` | `npm run leak3` |
| 4. setInterval/setTimeout 未清除 | `04-timer.js` | `npm run leak4` |
| 5. 缓存无上限无淘汰 | `05-cache-no-limit.js` | `npm run leak5` |

### 二、如何排查内存泄漏？

#### 方法 1：观察 `process.memoryUsage()`
```js
setInterval(() => {
  const mem = process.memoryUsage();
  console.log(`heapUsed: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
}, 5000);
```
如果 `heapUsed` 持续上升不回落，大概率有泄漏。

#### 方法 2：Chrome DevTools（推荐）
```bash
# 启动带 inspect 的服务
node --inspect --expose-gc 06-server-leak.js
```
1. Chrome 打开 `chrome://inspect`
2. 点击 "inspect" 连接
3. 进入 **Memory** 标签
4. **Take Heap Snapshot**（拍第一次快照）
5. 模拟压力/请求
6. **Take Heap Snapshot**（拍第二次快照）
7. 选择第二次快照 → **Comparison** 模式 → 按 **Size Delta** 排序
8. 找到增长最大的对象 → 点进去看 **Retainers**（谁持有了它的引用）

#### 方法 3：v8.writeHeapSnapshot()（无需 DevTools 实时连接）
```bash
node --expose-gc 07-heapdump-demo.js
```
生成 `.heapsnapshot` 文件，之后拿到 Chrome DevTools 中加载分析。

#### 方法 4：Timeline/Allocation 记录
在 DevTools Memory 中选择 **Allocation instrumentation on timeline**，实时观察每次内存分配来自哪段代码。

### 三、实战演练

**最推荐的实操练习：**

```bash
# 终端 1: 启动泄漏服务
node --inspect --expose-gc 06-server-leak.js

# 终端 2: 压测
for i in $(seq 1 500); do curl -s http://localhost:3000/api/data > /dev/null; done

# 终端 2: 查看内存
curl http://localhost:3000/memory | jq .

# 再压测一次，再看内存，观察持续增长
for i in $(seq 1 500); do curl -s http://localhost:3000/api/data > /dev/null; done
curl http://localhost:3000/memory | jq .
```

然后对比运行修复版 `06-server-fixed.js`，观察内存是否稳定。

### 四、面试金句

> "排查内存泄漏的核心思路是**对比**：在不同时间点拍 Heap Snapshot，对比哪些对象在增长、是谁持有了它们的引用（Retainers），然后针对性地修复。常见原因是全局变量无限增长、闭包意外持有引用、事件监听器忘记移除、定时器忘记清除、缓存无淘汰策略。"
