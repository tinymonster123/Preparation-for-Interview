/**
 * 内存泄漏场景 4：定时器泄漏
 *
 * 问题：setInterval/setTimeout 持有的回调和引用永远不会被回收
 * 面试关键词：setInterval、clearInterval、定时器引用
 */

const { printMemory } = require('./utils');

// ========== 泄漏代码 ==========
const activeTimers = [];

function startPolling() {
  const bigData = Buffer.alloc(1024 * 100, 'C'); // 100KB

  // 创建定时器但从不清除
  const timer = setInterval(() => {
    // 回调引用了 bigData，bigData 永远不会被回收
    void bigData;
  }, 60000); // 每分钟执行一次

  // 即使我们不保存 timer 引用，定时器本身也会阻止 GC
  // 这里保存只是为了演示
  activeTimers.push(timer);
}

// ========== 模拟 ==========
console.log('=== 场景4: 定时器泄漏 ===\n');
console.log('setInterval 创建后从不 clearInterval，回调持有的引用无法回收\n');

let count = 0;
const interval = setInterval(() => {
  for (let i = 0; i < 50; i++) {
    startPolling();
  }
  count++;
  printMemory(`第 ${count} 轮 (活跃定时器: ${activeTimers.length})`);

  if (count >= 10) {
    clearInterval(interval);
    // 清理演示用的定时器
    activeTimers.forEach(t => clearInterval(t));
    console.log('\n💡 修复方案：');
    console.log('  1. 不用时一定调用 clearInterval / clearTimeout');
    console.log('  2. 组件/连接销毁时清理所有定时器');
    console.log('  3. 使用 AbortController 或统一的生命周期管理');
  }
}, 500);
