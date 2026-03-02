/**
 * 场景 7：使用 v8.writeHeapSnapshot() 生成堆快照文件
 *
 * 不需要 Chrome DevTools 也能排查！
 * 生成的 .heapsnapshot 文件可以后续在 Chrome DevTools 中加载分析
 */

const v8 = require('v8');
const path = require('path');
const { printMemory } = require('./utils');

// 泄漏代码
const leaked = [];

function leak() {
  leaked.push(Buffer.alloc(1024 * 100, 'Z'));
}

console.log('=== 场景7: 使用 Heap Snapshot 文件排查 ===\n');

// 第一次快照：泄漏前
if (global.gc) global.gc();
const snap1 = v8.writeHeapSnapshot();
console.log(`快照 1 (泄漏前): ${path.basename(snap1)}`);
printMemory('泄漏前');

// 制造泄漏
for (let i = 0; i < 200; i++) {
  leak();
}

// 第二次快照：泄漏后
if (global.gc) global.gc();
const snap2 = v8.writeHeapSnapshot();
console.log(`\n快照 2 (泄漏后): ${path.basename(snap2)}`);
printMemory('泄漏后');

console.log('\n📋 分析步骤：');
console.log('  1. 打开 Chrome DevTools -> Memory 标签');
console.log('  2. 点击 "Load" 按钮，先加载快照 1');
console.log('  3. 再加载快照 2');
console.log('  4. 选择快照 2，切换到 "Comparison" 视图');
console.log('  5. 和快照 1 对比，按 "Size Delta" 排序');
console.log('  6. 找到 Buffer/ArrayBuffer 大幅增长 → 定位泄漏源');
console.log(`\n生成的文件：\n  ${snap1}\n  ${snap2}`);
