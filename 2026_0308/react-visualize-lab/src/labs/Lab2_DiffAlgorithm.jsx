/**
 * 实验 2：Diff 算法可视化
 *
 * 目标：理解 reconcileChildrenArray 的两轮算法和 lastPlacedIndex 优化
 *
 * 操作步骤：
 *   1. 点击不同的操作按钮，观察 DOM 变化
 *   2. 打开 Chrome DevTools → Elements，勾选 "Break on subtree modifications"
 *   3. 观察哪些 DOM 节点被移动/新建/删除
 *   4. 对照右侧的 Diff 分析理解 lastPlacedIndex 的工作原理
 */
import { useState, useRef, useEffect } from 'react';

// 随机颜色，帮助辨识 DOM 节点是否被复用
function getColor(key) {
  const colors = {
    A: '#e3f2fd', B: '#fff3e0', C: '#e8f5e9',
    D: '#fce4ec', E: '#f3e5f5', F: '#fff8e1',
  };
  return colors[key] || '#f5f5f5';
}

function TrackedItem({ id, onMount }) {
  const ref = useRef(null);
  const mountTimeRef = useRef(Date.now());

  useEffect(() => {
    // 新 mount 的节点闪烁绿色边框
    const el = ref.current;
    el.style.outline = '3px solid #4CAF50';
    el.style.outlineOffset = '2px';
    const timer = setTimeout(() => {
      el.style.outline = 'none';
    }, 1000);
    onMount?.(id);
    return () => clearTimeout(timer);
  }, []); // 空依赖 = 只在 mount 时触发

  const age = ((Date.now() - mountTimeRef.current) / 1000).toFixed(0);

  return (
    <div
      ref={ref}
      style={{
        ...styles.item,
        background: getColor(id),
      }}
    >
      <strong style={{ fontSize: 24 }}>{id}</strong>
      <span style={{ fontSize: 12, color: '#666' }}>
        (DOM 节点存活 {age}s)
      </span>
    </div>
  );
}

// Diff 分析器
function analyzeDiff(oldList, newList) {
  const steps = [];
  let lastPlacedIndex = 0;
  const oldMap = new Map(oldList.map((key, idx) => [key, idx]));
  let movedCount = 0;
  let createdCount = 0;
  let deletedCount = 0;

  // 第一轮：线性扫描
  steps.push({ type: 'phase', text: '=== 第一轮：线性扫描 ===' });
  let firstRoundBreak = -1;
  for (let i = 0; i < newList.length && i < oldList.length; i++) {
    if (newList[i] === oldList[i]) {
      steps.push({ type: 'match', text: `新[${i}]=${newList[i]} 匹配 旧[${i}]=${oldList[i]} ✓ 无需移动` });
      lastPlacedIndex = Math.max(lastPlacedIndex, i);
    } else if (oldMap.has(newList[i])) {
      steps.push({ type: 'break', text: `新[${i}]=${newList[i]} ≠ 旧[${i}]=${oldList[i]} → key 不匹配，跳出第一轮` });
      firstRoundBreak = i;
      break;
    } else {
      steps.push({ type: 'break', text: `新[${i}]=${newList[i]} 不在旧列表中 → 跳出第一轮` });
      firstRoundBreak = i;
      break;
    }
  }

  if (firstRoundBreak === -1) {
    if (newList.length < oldList.length) {
      const deleted = oldList.slice(newList.length);
      steps.push({ type: 'delete', text: `新列表遍历完 → 删除剩余旧节点: [${deleted.join(', ')}]` });
      deletedCount = deleted.length;
    } else if (newList.length > oldList.length) {
      const added = newList.slice(oldList.length);
      steps.push({ type: 'create', text: `旧列表遍历完 → 创建新节点: [${added.join(', ')}]` });
      createdCount = added.length;
    } else {
      steps.push({ type: 'match', text: '所有节点一一匹配，无需任何 DOM 操作' });
    }
  } else {
    // 第二轮：Map 查找
    steps.push({ type: 'phase', text: '=== 第二轮：Map 查找 ===' });
    const remainingOld = new Map();
    for (let i = firstRoundBreak; i < oldList.length; i++) {
      remainingOld.set(oldList[i], i);
    }
    steps.push({ type: 'info', text: `旧节点 Map: {${[...remainingOld].map(([k, v]) => `${k}→旧idx:${v}`).join(', ')}}` });

    lastPlacedIndex = firstRoundBreak > 0 ? firstRoundBreak - 1 : 0;

    for (let i = firstRoundBreak; i < newList.length; i++) {
      const key = newList[i];
      if (remainingOld.has(key)) {
        const oldIndex = remainingOld.get(key);
        if (oldIndex >= lastPlacedIndex) {
          steps.push({
            type: 'match',
            text: `新[${i}]=${key}: 旧idx=${oldIndex} >= lastPlaced=${lastPlacedIndex} → 不移动 ✓`
          });
          lastPlacedIndex = oldIndex;
        } else {
          steps.push({
            type: 'move',
            text: `新[${i}]=${key}: 旧idx=${oldIndex} < lastPlaced=${lastPlacedIndex} → 需要移动 DOM ⚠️`
          });
          movedCount++;
        }
        remainingOld.delete(key);
      } else {
        steps.push({ type: 'create', text: `新[${i}]=${key}: 不在旧列表中 → 创建新 DOM 节点 ➕` });
        createdCount++;
      }
    }

    if (remainingOld.size > 0) {
      steps.push({ type: 'delete', text: `删除旧列表剩余: [${[...remainingOld.keys()].join(', ')}] 🗑️` });
      deletedCount = remainingOld.size;
    }
  }

  steps.push({ type: 'phase', text: `=== 总计: ${movedCount}次移动, ${createdCount}次创建, ${deletedCount}次删除 ===` });
  return steps;
}

const SCENARIOS = [
  {
    name: '初始状态',
    list: ['A', 'B', 'C', 'D'],
    desc: '初始列表',
  },
  {
    name: '末尾→开头（代价高）',
    list: ['D', 'A', 'B', 'C'],
    desc: 'D 从末尾移到开头，导致 A、B、C 全部需要 DOM 移动',
  },
  {
    name: '开头→末尾（代价低）',
    list: ['B', 'C', 'D', 'A'],
    desc: 'A 从开头移到末尾，只有 A 需要 DOM 移动',
  },
  {
    name: '翻转列表',
    list: ['D', 'C', 'B', 'A'],
    desc: '完全翻转，除了 D 不动，其余全部移动',
  },
  {
    name: '中间插入',
    list: ['A', 'B', 'E', 'C', 'D'],
    desc: '在 B 和 C 之间插入 E',
  },
  {
    name: '删除中间',
    list: ['A', 'D'],
    desc: '删除 B 和 C',
  },
];

export default function Lab2_DiffAlgorithm() {
  const [currentList, setCurrentList] = useState(['A', 'B', 'C', 'D']);
  const [prevList, setPrevList] = useState(['A', 'B', 'C', 'D']);
  const [analysis, setAnalysis] = useState([]);
  const [mountLog, setMountLog] = useState([]);

  const applyScenario = (scenario) => {
    const oldList = currentList;
    setPrevList(oldList);
    setCurrentList(scenario.list);
    setAnalysis(analyzeDiff(oldList, scenario.list));
    setMountLog([]);
  };

  const handleMount = (id) => {
    setMountLog(prev => [...prev, `${id} mounted (新 DOM 节点)`]);
  };

  return (
    <div style={styles.container}>
      <h2>实验 2：Diff 算法可视化</h2>

      <div style={styles.instructions}>
        <p><strong>观察要点：</strong></p>
        <ul>
          <li>绿色闪烁边框 = 新创建的 DOM 节点（mount）</li>
          <li>没有闪烁 = 复用的旧 DOM 节点（只是位置可能变了）</li>
          <li>右侧面板显示 Diff 算法的逐步分析</li>
        </ul>
      </div>

      <div style={styles.buttonRow}>
        {SCENARIOS.map((s, i) => (
          <button key={i} onClick={() => applyScenario(s)} style={styles.scenarioBtn}>
            {s.name}
          </button>
        ))}
      </div>

      <div style={styles.mainLayout}>
        {/* 左侧：可视化列表 */}
        <div style={styles.leftPanel}>
          <h4>当前列表（DOM 节点）</h4>
          <div style={styles.listContainer}>
            {currentList.map(id => (
              <TrackedItem key={id} id={id} onMount={handleMount} />
            ))}
          </div>
          <div style={styles.comparison}>
            <span>旧: [{prevList.join(', ')}]</span>
            <span> → </span>
            <span>新: [{currentList.join(', ')}]</span>
          </div>
        </div>

        {/* 右侧：Diff 分析 */}
        <div style={styles.rightPanel}>
          <h4>Diff 算法分析 (lastPlacedIndex)</h4>
          <div style={styles.analysisBox}>
            {analysis.length === 0 ? (
              <p style={{ color: '#999' }}>点击上方按钮触发 Diff</p>
            ) : (
              analysis.map((step, i) => (
                <div key={i} style={{
                  ...styles.step,
                  color: step.type === 'move' ? '#f44336'
                    : step.type === 'create' ? '#4CAF50'
                    : step.type === 'delete' ? '#FF9800'
                    : step.type === 'phase' ? '#9C27B0'
                    : step.type === 'break' ? '#FF5722'
                    : '#333',
                  fontWeight: step.type === 'phase' ? 'bold' : 'normal',
                }}>
                  {step.text}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { padding: 20, maxWidth: 1000, margin: '0 auto' },
  instructions: { background: '#f5f5f5', padding: 16, borderRadius: 8, marginBottom: 16 },
  buttonRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  scenarioBtn: { padding: '8px 16px', cursor: 'pointer', border: '1px solid #ccc', borderRadius: 6, background: '#fff', fontSize: 14 },
  mainLayout: { display: 'flex', gap: 16 },
  leftPanel: { flex: 1 },
  rightPanel: { flex: 1 },
  listContainer: { display: 'flex', flexDirection: 'column', gap: 8 },
  item: { padding: '12px 16px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.3s' },
  comparison: { marginTop: 12, fontSize: 14, color: '#666' },
  analysisBox: { background: '#1e1e1e', padding: 16, borderRadius: 8, maxHeight: 400, overflow: 'auto' },
  step: { fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8 },
};
