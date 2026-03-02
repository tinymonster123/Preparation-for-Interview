/**
 * 场景 6 修复版：对比学习
 */

const http = require('http');
const { formatMemory } = require('./utils');
const EventEmitter = require('events');

// 修复 1：用有限长度的环形缓冲区代替无限数组
class RingBuffer {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.buffer = [];
    this.index = 0;
  }
  push(item) {
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(item);
    } else {
      this.buffer[this.index % this.maxSize] = item;
    }
    this.index++;
  }
  get length() { return this.buffer.length; }
}
const requestLogs = new RingBuffer(100); // 最多保留 100 条日志

// 修复 2：使用 once 或在请求结束时移除监听器
const bus = new EventEmitter();

// 修复 3：LRU 缓存
class LRUCache {
  constructor(max) { this.max = max; this.cache = new Map(); }
  get(k) {
    if (!this.cache.has(k)) return undefined;
    const v = this.cache.get(k);
    this.cache.delete(k);
    this.cache.set(k, v);
    return v;
  }
  set(k, v) {
    if (this.cache.has(k)) this.cache.delete(k);
    this.cache.set(k, v);
    if (this.cache.size > this.max) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }
  get size() { return this.cache.size; }
}
const responseCache = new LRUCache(50);

const server = http.createServer((req, res) => {
  // 修复 1：环形缓冲区，自动淘汰旧日志
  requestLogs.push({
    url: req.url,
    time: new Date().toISOString(),
  });

  // 修复 2：使用 once，触发后自动移除
  const handler = () => {};
  bus.once('notify', handler);
  // 或者在请求结束时手动移除：
  res.on('finish', () => bus.removeListener('notify', handler));

  if (req.url === '/api/data') {
    // 修复 3：用固定 key（如 URL），LRU 自动淘汰
    const key = req.url;
    const data = { result: 'ok', time: Date.now() };
    responseCache.set(key, data);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', cached: responseCache.size }));
  } else if (req.url === '/memory') {
    if (global.gc) global.gc();
    const mem = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      rss: formatMemory(mem.rss),
      heapUsed: formatMemory(mem.heapUsed),
      heapTotal: formatMemory(mem.heapTotal),
      requestLogs: requestLogs.length,
      listeners: bus.listenerCount('notify'),
      cacheSize: responseCache.size,
    }, null, 2));
  } else {
    res.writeHead(200);
    res.end('Fixed Server - No Memory Leaks\n');
  }
});

server.listen(3000, () => {
  console.log('=== 修复版 Server 已启动 ===');
  console.log('http://localhost:3000');
  console.log('\n对比 06-server-leak.js，观察 /memory 接口的内存变化');
});
