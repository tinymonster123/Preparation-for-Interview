/**
 * 内存泄漏场景 5：无限增长的缓存
 *
 * 问题：用 Map/Object 做缓存但没有设置大小上限和淘汰策略
 * 面试关键词：缓存淘汰、LRU、Map vs WeakMap
 */

const { printMemory } = require('./utils');

// ========== 泄漏代码 ==========
const cache = new Map();

function queryWithCache(userId) {
  if (cache.has(userId)) {
    return cache.get(userId);
  }
  // 模拟数据库查询结果
  const result = {
    id: userId,
    data: Buffer.alloc(1024 * 10, 'D'), // 10KB 的结果
    timestamp: Date.now(),
  };
  cache.set(userId, result);
  return result;
}

// ========== 模拟 ==========
console.log('=== 场景5: 无限增长的缓存 ===\n');
console.log('Map 做缓存但不设上限，随着用户增长缓存无限膨胀\n');

let count = 0;
let userId = 0;
const interval = setInterval(() => {
  // 每次模拟 500 个不同用户的请求
  for (let i = 0; i < 500; i++) {
    queryWithCache(`user_${userId++}`);
  }
  count++;
  printMemory(`第 ${count} 轮 (缓存大小: ${cache.size})`);

  if (count >= 10) {
    clearInterval(interval);
    console.log('\n💡 修复方案：');
    console.log('  1. 设置缓存上限，超出时用 LRU 策略淘汰');
    console.log('  2. 设置 TTL（过期时间），定期清理过期缓存');
    console.log('  3. 如果 key 是对象，考虑用 WeakMap（key 被 GC 时自动移除）');
    console.log('  4. 使用成熟的缓存库如 lru-cache');

    console.log('\n--- 演示修复：LRU 缓存 ---');
    demonstrateFix();
  }
}, 500);

function demonstrateFix() {
  // 简易 LRU 实现
  class LRUCache {
    constructor(maxSize) {
      this.maxSize = maxSize;
      this.cache = new Map();
    }
    get(key) {
      if (!this.cache.has(key)) return undefined;
      const value = this.cache.get(key);
      // 移到末尾（最近使用）
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    set(key, value) {
      if (this.cache.has(key)) this.cache.delete(key);
      this.cache.set(key, value);
      // 超过上限时删除最早的
      if (this.cache.size > this.maxSize) {
        const oldest = this.cache.keys().next().value;
        this.cache.delete(oldest);
      }
    }
  }

  const lru = new LRUCache(100); // 最多缓存 100 条
  for (let i = 0; i < 5000; i++) {
    lru.set(`user_${i}`, { data: Buffer.alloc(1024) });
  }
  console.log(`LRU 缓存写入 5000 条后，实际大小: ${lru.cache.size}`);
}
