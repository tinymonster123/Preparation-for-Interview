/**
 * 内存泄漏场景 2：闭包泄漏
 *
 * 问题：闭包引用了外部大对象，导致大对象无法被 GC
 * 面试关键词：闭包、作用域链、意外引用
 */

const { printMemory, createMemoryTracker } = require('./utils');
const track = createMemoryTracker();

// ========== 泄漏代码 ==========
const thunks = [];

function createHandler() {
  // 这个大对象本应在函数执行完后被回收
  // 用纯 JS 对象（而非 Buffer），这样内存分配在 V8 堆内，heapUsed 会明显上涨
  const hugeData = new Array(50000).fill('A'.repeat(20)); // ~1MB 纯 JS 字符串数组

  // 注意：是否会“保留 hugeData”取决于返回的闭包是否真的捕获(引用)了它。
  // 这里用 unused 指向 hugeData，并在 handler 中显式引用 unused，确保形成强引用链：
  // handler(闭包) -> createHandler 的词法环境 -> unused -> hugeData
  const unused = hugeData;

  return function handler() {
    // 显式触发捕获：哪怕不做任何事，只要引用了 unused，就会让它所在的词法环境被保留
    // 进而使 hugeData 无法被 GC 回收（只要 handler 仍被外部数组持有）
    void unused;
    return 'handled';
  };
}

// ========== 模拟 ==========
console.log('=== 场景2: 闭包泄漏 ===\n');
console.log('闭包通过作用域链持有了大对象的引用，阻止 GC 回收\n');

let count = 0;
const interval = setInterval(() => {
  for (let i = 0; i < 50; i++) {
    thunks.push(createHandler());
  }
  count++;
  printMemory(`第 ${count} 轮 (累计 ${thunks.length} 个闭包)`);
  track(`第${count}轮 x${thunks.length}`);

  if (count >= 10) {
    clearInterval(interval);
    console.log('\n💡 修复方案：');
    console.log('  1. 不要在闭包的作用域中保留不需要的大对象引用');
    console.log('  2. 用完后手动置 null: unused = null');
    console.log('  3. 把大数据处理和闭包创建分到不同的函数作用域');
  }
}, 500);
