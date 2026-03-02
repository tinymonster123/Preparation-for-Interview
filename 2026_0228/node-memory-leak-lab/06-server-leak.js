/**
 * 场景 6：一个有内存泄漏的 HTTP Server（实战排查用）
 *
 * 运行方式：
 *   node --expose-gc 06-server-leak.js
 *   或用 Chrome DevTools 排查：
 *   node --inspect --expose-gc 06-server-leak.js
 *
 * 然后用 curl 或浏览器访问：
 *   curl http://localhost:3000/api/data
 *   curl http://localhost:3000/memory  （查看内存）
 *
 * 排查步骤：
 *   1. 打开 Chrome，访问 chrome://inspect
 *   2. 点击 "inspect" 连接到 Node 进程
 *   3. 进入 Memory 标签页
 *   4. 先拍一次 Heap Snapshot
 *   5. 用 ab 或 wrk 压测：ab -n 1000 -c 10 http://localhost:3000/api/data
 *   6. 再拍一次 Heap Snapshot
 *   7. 对比两次快照，找到增长最大的对象
 */

const http = require('http');
const { formatMemory } = require('./utils');

// ========== 故意埋入的 3 个内存泄漏 ==========

// 泄漏 1：全局请求日志，无限增长
const requestLogs = [];

// 泄漏 2：事件监听器
const EventEmitter = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(0);

// 泄漏 3：无上限缓存
const responseCache = new Map();

const server = http.createServer((req, res) => {
  // 泄漏 1：每个请求都记录到全局数组
  requestLogs.push({
    url: req.url,
    time: new Date().toISOString(),
    headers: { ...req.headers }, // 复制了整个 headers
    payload: Buffer.alloc(1024, 'X'), // 额外的 1KB 数据
  });

  // 泄漏 2：每个请求注册一个监听器但不移除
  bus.on('notify', function handler() {
    void req; // 持有整个 req 对象的引用
  });

  if (req.url === '/api/data') {
    const key = `${req.url}_${Date.now()}`;
    // 泄漏 3：用时间戳做 key，每次都不同，缓存无限增长
    const data = { result: 'ok', buffer: Buffer.alloc(512, 'Y') };
    responseCache.set(key, data);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', cached: responseCache.size }));
  } else if (req.url === '/memory') {
    if (global.gc) global.gc(); // 手动触发 GC
    const mem = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      rss: formatMemory(mem.rss),
      heapUsed: formatMemory(mem.heapUsed),
      heapTotal: formatMemory(mem.heapTotal),
      external: formatMemory(mem.external),
      requestLogs: requestLogs.length,
      listeners: bus.listenerCount('notify'),
      cacheSize: responseCache.size,
    }, null, 2));
  } else {
    res.writeHead(200);
    res.end('Node.js Memory Leak Lab Server\n\nEndpoints:\n  GET /api/data - trigger leaks\n  GET /memory   - check memory usage\n');
  }
});

server.listen(3000, () => {
  console.log('=== 内存泄漏 Server 已启动 ===');
  console.log('http://localhost:3000\n');
  console.log('排查步骤：');
  console.log('  1. node --inspect --expose-gc 06-server-leak.js');
  console.log('  2. 打开 Chrome -> chrome://inspect -> inspect');
  console.log('  3. Memory 标签 -> Take Heap Snapshot (第一次)');
  console.log('  4. 压测: for i in $(seq 1 500); do curl -s http://localhost:3000/api/data > /dev/null; done');
  console.log('  5. Memory 标签 -> Take Heap Snapshot (第二次)');
  console.log('  6. 选择 "Comparison" 模式对比两次快照');
  console.log('  7. 按 "Size Delta" 排序，找到泄漏源');
  console.log('\n查看内存: curl http://localhost:3000/memory');
});
