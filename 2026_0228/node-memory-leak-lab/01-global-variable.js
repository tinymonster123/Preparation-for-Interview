/**
 * 内存泄漏场景 1：全局变量泄漏
 *
 * 问题：数据被挂在全局对象上，永远不会被 GC 回收
 * 面试关键词：全局变量、意外的全局变量（忘记 var/let/const）
 */

const { printMemory } = require('./utils');

// ========== 泄漏代码 ==========
const leakedData = [];

function processRequest() {
  // 模拟每次请求往全局数组中 push 数据，但从不清理
  const bigPayload = Buffer.alloc(1024 * 100, 'x'); // 100KB
  leakedData.push(bigPayload);
}

// ========== 模拟持续请求 ==========
console.log('=== 场景1: 全局变量泄漏 ===\n');
console.log('每次 processRequest() 都往全局数组中 push 100KB 数据，从不清理\n');

let count = 0;
const interval = setInterval(() => {
  for (let i = 0; i < 50; i++) {
    processRequest();
  }
  count++;
  printMemory(`第 ${count} 轮 (累计 ${leakedData.length} 条)`);

  if (count >= 10) {
    clearInterval(interval);
    console.log('\n💡 修复方案：');
    console.log('  1. 避免使用全局变量存储请求数据');
    console.log('  2. 如果必须缓存，设置上限和淘汰策略');
    console.log('  3. 使用 WeakRef / WeakMap 让 GC 可以回收');
  }
}, 500);
