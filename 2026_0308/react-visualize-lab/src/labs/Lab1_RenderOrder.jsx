/**
 * 实验 1：渲染顺序可视化
 *
 * 目标：理解 Fiber 树的遍历顺序
 *   beginWork 向下 → completeWork 向上 → commit 阶段（layout → passive）
 *
 * 操作步骤：
 *   1. 打开浏览器控制台
 *   2. 观察初始 mount 的 log 顺序
 *   3. 点击 "触发更新" 按钮，观察 update 时的 log 顺序
 *   4. 对照下方的 Fiber 树结构图理解
 */
import { useState, useEffect, useLayoutEffect } from 'react';

// 颜色标记
const COLORS = {
  render: '#2196F3',     // 蓝色 = render 阶段 (beginWork)
  layout: '#FF9800',     // 橙色 = layout 阶段 (同步，commitLayoutEffects)
  passive: '#4CAF50',    // 绿色 = passive 阶段 (异步，flushPassiveEffects)
  cleanup: '#f44336',    // 红色 = cleanup
};

function log(phase, component, color) {
  console.log(
    `%c[${phase}] ${component}`,
    `color: ${color}; font-weight: bold; font-size: 13px;`
  );
}

// ─── 组件树 ───
// App → div → [Header, Content(→ [Item, Item, Item]), Footer]
//
// Fiber 链表结构：
//   App
//    └─child─→ div
//                └─child─→ Header ─sibling─→ Content ─sibling─→ Footer
//                                              └─child─→ Item1 ─sibling─→ Item2 ─sibling─→ Item3

function Item({ name }) {
  log('render (beginWork)', name, COLORS.render);

  useLayoutEffect(() => {
    log('useLayoutEffect setup', name, COLORS.layout);
    return () => log('useLayoutEffect cleanup', name, COLORS.cleanup);
  });

  useEffect(() => {
    log('useEffect setup', name, COLORS.passive);
    return () => log('useEffect cleanup', name, COLORS.cleanup);
  });

  return <li style={styles.item}>{name}</li>;
}

function Header({ count }) {
  log('render (beginWork)', 'Header', COLORS.render);

  useLayoutEffect(() => {
    log('useLayoutEffect setup', 'Header', COLORS.layout);
    return () => log('useLayoutEffect cleanup', 'Header', COLORS.cleanup);
  });

  useEffect(() => {
    log('useEffect setup', 'Header', COLORS.passive);
    return () => log('useEffect cleanup', 'Header', COLORS.cleanup);
  });

  return <h3 style={styles.header}>Header (渲染次数: {count})</h3>;
}

function Content({ count }) {
  log('render (beginWork)', 'Content', COLORS.render);

  useLayoutEffect(() => {
    log('useLayoutEffect setup', 'Content', COLORS.layout);
    return () => log('useLayoutEffect cleanup', 'Content', COLORS.cleanup);
  });

  useEffect(() => {
    log('useEffect setup', 'Content', COLORS.passive);
    return () => log('useEffect cleanup', 'Content', COLORS.cleanup);
  });

  return (
    <ul style={styles.content}>
      <Item name={`Item-A (第${count}次)`} />
      <Item name={`Item-B (第${count}次)`} />
      <Item name={`Item-C (第${count}次)`} />
    </ul>
  );
}

function Footer() {
  log('render (beginWork)', 'Footer', COLORS.render);

  useLayoutEffect(() => {
    log('useLayoutEffect setup', 'Footer', COLORS.layout);
    return () => log('useLayoutEffect cleanup', 'Footer', COLORS.cleanup);
  });

  useEffect(() => {
    log('useEffect setup', 'Footer', COLORS.passive);
    return () => log('useEffect cleanup', 'Footer', COLORS.cleanup);
  });

  return <p style={styles.footer}>Footer</p>;
}

export default function Lab1_RenderOrder() {
  const [count, setCount] = useState(0);

  log('render (beginWork)', 'App', COLORS.render);

  const handleClick = () => {
    console.clear();
    console.log('%c═══ 触发更新 ═══', 'font-size: 16px; color: #9C27B0;');
    setCount(c => c + 1);
  };

  return (
    <div style={styles.container}>
      <h2>实验 1：渲染顺序可视化</h2>

      <div style={styles.instructions}>
        <p><strong>打开浏览器控制台 (F12)</strong> 观察彩色 log：</p>
        <ul>
          <li><span style={{ color: COLORS.render }}>蓝色</span> = render 阶段 (beginWork 向下遍历)</li>
          <li><span style={{ color: COLORS.layout }}>橙色</span> = useLayoutEffect (commit 同步阶段)</li>
          <li><span style={{ color: COLORS.passive }}>绿色</span> = useEffect (浏览器绘制后异步执行)</li>
          <li><span style={{ color: COLORS.cleanup }}>红色</span> = cleanup (更新时先执行)</li>
        </ul>
      </div>

      <button onClick={handleClick} style={styles.button}>
        触发更新 (第 {count} 次)
      </button>

      <div style={styles.treeBox}>
        <pre style={styles.tree}>{`
Fiber 树结构 & 遍历顺序:

beginWork(App)           ← 1. 向下
  beginWork(div)         ← 2.
    beginWork(Header)    ← 3. 叶子
    completeWork(Header) ← 4. 向上，移到兄弟
    beginWork(Content)   ← 5. 兄弟
      beginWork(Item-A)  ← 6. 叶子
      completeWork(A)    ← 7.
      beginWork(Item-B)  ← 8. 兄弟
      completeWork(B)    ← 9.
      beginWork(Item-C)  ← 10.
      completeWork(C)    ← 11. 无兄弟，向上
    completeWork(Content)← 12. 回到父
    beginWork(Footer)    ← 13. 兄弟
    completeWork(Footer) ← 14. 向上
  completeWork(div)      ← 15.
completeWork(App)        ← 16.

─── Commit 阶段 ───
commitLayoutEffects:     ← 同步！从子到父
  Header.useLayoutEffect
  Item-A.useLayoutEffect
  ...
  Footer.useLayoutEffect

─── 浏览器绘制 ───

flushPassiveEffects:     ← 异步！绘制后
  Header.useEffect
  Item-A.useEffect
  ...
  Footer.useEffect
        `}</pre>
      </div>

      <div style={styles.componentArea}>
        <Header count={count} />
        <Content count={count} />
        <Footer />
      </div>
    </div>
  );
}

const styles = {
  container: { padding: 20, maxWidth: 800, margin: '0 auto' },
  instructions: { background: '#f5f5f5', padding: 16, borderRadius: 8, marginBottom: 16 },
  button: { padding: '12px 24px', fontSize: 16, cursor: 'pointer', background: '#2196F3', color: '#fff', border: 'none', borderRadius: 6 },
  treeBox: { background: '#1e1e1e', borderRadius: 8, margin: '16px 0', overflow: 'auto' },
  tree: { color: '#d4d4d4', fontSize: 13, lineHeight: 1.6, padding: 16, margin: 0 },
  componentArea: { border: '2px dashed #ccc', padding: 16, borderRadius: 8, marginTop: 16 },
  header: { background: '#e3f2fd', padding: 8, borderRadius: 4 },
  content: { background: '#fff3e0', padding: 8, borderRadius: 4, listStyle: 'none' },
  item: { padding: 4, margin: '4px 0', background: '#fff8e1', borderRadius: 4 },
  footer: { background: '#e8f5e9', padding: 8, borderRadius: 4 },
};
