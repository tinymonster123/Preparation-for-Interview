/**
 * 工具函数
 */

function formatMemory(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function printMemory(label = '') {
  const mem = process.memoryUsage();
  console.log(
    `  [${label}] RSS: ${formatMemory(mem.rss)} | ` +
    `Heap Used: ${formatMemory(mem.heapUsed)} | ` +
    `Heap Total: ${formatMemory(mem.heapTotal)} | ` +
    `External: ${formatMemory(mem.external)}`
  );
}

/**
 * 可视化内存追踪器
 * 在终端用 ASCII 柱状图展示 heapUsed 的增长趋势
 */
function createMemoryTracker() {
  const history = [];        // 记录每次采样的 heapUsed (MB)
  const BAR_MAX_WIDTH = 40;  // 柱子最大字符宽度

  return function track(label = '') {
    if (global.gc) global.gc(); // 如果有 --expose-gc，先 GC 再采样，看"真实底线"

    const mem = process.memoryUsage();
    const heapMB = mem.heapUsed / 1024 / 1024;
    const rssMB = mem.rss / 1024 / 1024;
    const extMB = mem.external / 1024 / 1024;
    history.push(heapMB);

    // 动态计算柱子比例：以历史最大值撑满 BAR_MAX_WIDTH
    const maxMB = Math.max(...history);
    const scale = maxMB > 0 ? BAR_MAX_WIDTH / maxMB : 1;

    const barLen = Math.round(heapMB * scale);
    const bar = '\x1b[31m' + '█'.repeat(barLen) + '\x1b[0m' +
                '░'.repeat(BAR_MAX_WIDTH - barLen);

    const delta = history.length >= 2
      ? heapMB - history[history.length - 2]
      : 0;
    const deltaStr = delta >= 0
      ? `\x1b[31m+${delta.toFixed(1)}MB\x1b[0m`
      : `\x1b[32m${delta.toFixed(1)}MB\x1b[0m`;

    console.log(
      `  ${label.padEnd(20)} ${bar} ${heapMB.toFixed(1).padStart(6)}MB (${deltaStr}) | RSS ${rssMB.toFixed(1)}MB | Ext ${extMB.toFixed(1)}MB`
    );
  };
}

module.exports = { formatMemory, printMemory, createMemoryTracker };
