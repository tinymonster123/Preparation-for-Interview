/**
 * 内存泄漏场景 3：EventEmitter 监听器泄漏
 *
 * 问题：反复添加事件监听器但从不移除
 * 面试关键词：EventEmitter、addEventListener、removeListener
 */

const { printMemory } = require('./utils');
const EventEmitter = require('events');

// ========== 泄漏代码 ==========
const emitter = new EventEmitter();
// 提高上限，否则 Node.js 默认会在 11 个时警告
emitter.setMaxListeners(0);

function simulateConnection() {
  // 模拟：每次连接都注册一个监听器，但断开连接时忘记移除
  const bigContext = Buffer.alloc(1024 * 50, 'B'); // 50KB 上下文

  emitter.on('data', function onData() {
    // 这个回调持有 bigContext 引用
    void bigContext;
  });

  // 忘记在 "断开连接" 时调用 emitter.removeListener('data', onData)
}

// ========== 模拟 ==========
console.log('=== 场景3: EventEmitter 监听器泄漏 ===\n');
console.log('每次连接添加监听器，断开时忘记移除\n');

let count = 0;
const interval = setInterval(() => {
  for (let i = 0; i < 100; i++) {
    simulateConnection();
  }
  count++;
  printMemory(`第 ${count} 轮 (监听器数: ${emitter.listenerCount('data')})`);

  if (count >= 10) {
    clearInterval(interval);
    console.log('\n💡 修复方案：');
    console.log('  1. 配对使用 on/off (addListener/removeListener)');
    console.log('  2. 使用 once() 代替 on()（如果只需要触发一次）');
    console.log('  3. 在对象销毁/断开时 removeAllListeners()');
    console.log('  4. 保持默认 maxListeners=10 来尽早发现问题');
  }
}, 500);
