/**
 * 内存泄漏实时监控仪表盘
 *
 * 用 blessed-contrib 在终端里画出实时折线图 + 数据表格，
 * 直观地看到 heapUsed / external / rss 随时间的变化趋势。
 *
 * 用法：node --expose-gc 08-dashboard.js
 * 按 q 或 Esc 或 Ctrl-C 退出
 */

const blessed = require('blessed');
const contrib = require('blessed-contrib');

// ===================== 终端 UI 布局 =====================

const screen = blessed.screen({ smartCSR: true });
screen.title = 'Node.js Memory Leak Dashboard';

const grid = new contrib.grid({ rows: 12, cols: 12, screen });

// 上半部分：折线图
const line = grid.set(0, 0, 7, 12, contrib.line, {
  label: ' Memory Trend (MB) ',
  showLegend: true,
  legend: { width: 20 },
  xLabelPadding: 3,
  wholeNumbersOnly: false,
  style: { line: 'yellow', text: 'white', baseline: 'white' },
});

// 左下：实时数据表
const table = grid.set(7, 0, 5, 6, contrib.table, {
  label: ' Current Memory ',
  keys: true,
  columnWidth: [14, 12],
  columnSpacing: 2,
  fg: 'green',
});

// 右下：日志
const log = grid.set(7, 6, 5, 6, contrib.log, {
  label: ' Event Log ',
  fg: 'cyan',
  tags: true,
});

// 退出快捷键
screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

// ===================== 泄漏模拟 =====================

const leakedObjects = [];

function simulateLeak() {
  // 每轮往数组里塞入 50 个大 JS 对象，永远不释放
  for (let i = 0; i < 50; i++) {
    leakedObjects.push({
      data: new Array(5000).fill('leak-' + Date.now()),
      timestamp: Date.now(),
    });
  }
}

// ===================== 数据采集 + 渲染 =====================

const MAX_POINTS = 60; // 折线图最多显示 60 个采样点
const heapData = { title: 'heapUsed', x: [], y: [], style: { line: 'red' } };
const extData  = { title: 'external',  x: [], y: [], style: { line: 'yellow' } };
const rssData  = { title: 'rss',       x: [], y: [], style: { line: 'cyan' } };

let tick = 0;

function sample() {
  if (global.gc) global.gc(); // 先 GC，看"真实底线"

  const mem = process.memoryUsage();
  const heapMB = +(mem.heapUsed / 1024 / 1024).toFixed(1);
  const extMB  = +(mem.external  / 1024 / 1024).toFixed(1);
  const rssMB  = +(mem.rss       / 1024 / 1024).toFixed(1);
  const totalMB = +(mem.heapTotal / 1024 / 1024).toFixed(1);

  tick++;
  const label = `${tick}s`;

  // 追加数据点（超出范围则 shift）
  [heapData, extData, rssData].forEach((s) => {
    if (s.x.length >= MAX_POINTS) { s.x.shift(); s.y.shift(); }
  });
  heapData.x.push(label); heapData.y.push(heapMB);
  extData.x.push(label);  extData.y.push(extMB);
  rssData.x.push(label);  rssData.y.push(rssMB);

  // 更新折线图
  line.setData([heapData, extData, rssData]);

  // 更新表格
  table.setData({
    headers: ['Metric', 'Value'],
    data: [
      ['heapUsed',  heapMB + ' MB'],
      ['heapTotal', totalMB + ' MB'],
      ['external',  extMB + ' MB'],
      ['rss',       rssMB + ' MB'],
      ['leaked #',  leakedObjects.length.toString()],
      ['tick',      tick + 's'],
    ],
  });

  screen.render();
}

// ===================== 主循环 =====================

log.log('Dashboard started. Press q / Esc to quit.');
log.log('Simulating closure leak every 1s...');
log.log('');

setInterval(() => {
  simulateLeak();
  sample();

  // 每 5 轮打一条日志
  if (tick % 5 === 0) {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
    log.log(`[${tick}s] leaked ${leakedObjects.length} objs, heap ${heapMB}MB`);
  }
}, 1000);

// 初始采样
sample();
