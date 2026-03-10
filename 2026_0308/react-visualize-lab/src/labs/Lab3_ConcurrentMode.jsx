/**
 * 实验 3：并发调度与时间切片可视化
 *
 * 目标：直观感受 useTransition 带来的时间切片效果
 *
 * 操作步骤：
 *   1. 在 "同步模式" 下输入文字 → 输入框明显卡顿
 *   2. 切到 "并发模式" → 输入流畅，列表延迟更新
 *   3. 打开 Chrome DevTools → Performance 面板录制对比
 *      - 同步模式：一个大的 Long Task（红色三角标记）
 *      - 并发模式：多个 ~5ms 的小任务块
 */
import { useState, useTransition, useDeferredValue, memo, useMemo } from 'react';

// 故意制造一个渲染很慢的组件
const SlowItem = memo(function SlowItem({ text, index }) {
  // 模拟重计算（每个 item 耗时约 1ms）
  const startTime = performance.now();
  while (performance.now() - startTime < 1) {
    // busy wait
  }
  return (
    <div style={{
      padding: '4px 8px',
      margin: 2,
      background: `hsl(${index * 3}, 70%, 90%)`,
      borderRadius: 4,
      fontSize: 13,
    }}>
      {text}
    </div>
  );
});

function SyncMode() {
  const [input, setInput] = useState('');
  const [list, setList] = useState([]);
  const [renderTime, setRenderTime] = useState(0);

  const handleChange = (e) => {
    const value = e.target.value;
    const start = performance.now();
    setInput(value);
    // 同步更新：setState 在同一个事件中，会被批处理
    // 但列表渲染本身非常慢
    setList(
      value
        ? Array.from({ length: 500 }, (_, i) => `${value} - 结果 ${i}`)
        : []
    );
    // 注意：这里的 renderTime 测的是 setState 到下一次渲染的时间
    requestAnimationFrame(() => {
      setRenderTime(Math.round(performance.now() - start));
    });
  };

  return (
    <div style={styles.modePanel}>
      <h3 style={{ color: '#f44336' }}>同步模式（无 useTransition）</h3>
      <p style={styles.hint}>输入文字试试 → 输入框会卡顿</p>
      <input
        value={input}
        onChange={handleChange}
        placeholder="输入搜索..."
        style={styles.input}
      />
      <div style={styles.stats}>
        渲染耗时: <strong>{renderTime}ms</strong>
        {renderTime > 100 && <span style={{ color: '#f44336' }}> ⚠️ 长任务！</span>}
      </div>
      <div style={styles.listBox}>
        {list.map((item, i) => (
          <SlowItem key={i} text={item} index={i} />
        ))}
      </div>
    </div>
  );
}

function ConcurrentMode() {
  const [input, setInput] = useState('');
  const [list, setList] = useState([]);
  const [isPending, startTransition] = useTransition();
  const [renderTime, setRenderTime] = useState(0);

  const handleChange = (e) => {
    const value = e.target.value;
    const start = performance.now();

    // 高优先级：输入框立即更新 (SyncLane)
    setInput(value);

    // 低优先级：列表延迟更新 (TransitionLane)
    startTransition(() => {
      setList(
        value
          ? Array.from({ length: 500 }, (_, i) => `${value} - 结果 ${i}`)
          : []
      );
    });

    requestAnimationFrame(() => {
      setRenderTime(Math.round(performance.now() - start));
    });
  };

  return (
    <div style={styles.modePanel}>
      <h3 style={{ color: '#4CAF50' }}>并发模式（useTransition）</h3>
      <p style={styles.hint}>输入文字试试 → 输入框流畅，列表异步更新</p>
      <input
        value={input}
        onChange={handleChange}
        placeholder="输入搜索..."
        style={styles.input}
      />
      <div style={styles.stats}>
        输入响应: <strong>{renderTime}ms</strong>
        {isPending && <span style={styles.pending}> ⏳ Transition 进行中...</span>}
      </div>
      <div style={{
        ...styles.listBox,
        opacity: isPending ? 0.6 : 1,
        transition: 'opacity 0.2s',
      }}>
        {list.map((item, i) => (
          <SlowItem key={i} text={item} index={i} />
        ))}
      </div>
    </div>
  );
}

function DeferredValueMode() {
  const [input, setInput] = useState('');
  const deferredInput = useDeferredValue(input);
  const isStale = input !== deferredInput;

  const list = useMemo(() => {
    if (!deferredInput) return [];
    return Array.from({ length: 500 }, (_, i) => `${deferredInput} - 结果 ${i}`);
  }, [deferredInput]);

  return (
    <div style={styles.modePanel}>
      <h3 style={{ color: '#2196F3' }}>useDeferredValue 模式</h3>
      <p style={styles.hint}>原理类似 useTransition，但延迟的是值而非 setState</p>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="输入搜索..."
        style={styles.input}
      />
      <div style={styles.stats}>
        输入值: "{input}" | 延迟值: "{deferredInput}"
        {isStale && <span style={styles.pending}> ⏳ 延迟中...</span>}
      </div>
      <div style={{
        ...styles.listBox,
        opacity: isStale ? 0.6 : 1,
        transition: 'opacity 0.2s',
      }}>
        {list.map((item, i) => (
          <SlowItem key={i} text={item} index={i} />
        ))}
      </div>
    </div>
  );
}

export default function Lab3_ConcurrentMode() {
  const [mode, setMode] = useState('sync');

  return (
    <div style={styles.container}>
      <h2>实验 3：并发调度 & 时间切片</h2>

      <div style={styles.instructions}>
        <p><strong>验证步骤：</strong></p>
        <ol>
          <li>分别在三种模式下快速输入文字，感受流畅度差异</li>
          <li>打开 <strong>Chrome DevTools → Performance</strong> 面板</li>
          <li>点击录制 → 输入文字 → 停止录制</li>
          <li>观察 Main Thread 火焰图：
            <ul>
              <li>同步模式：一个连续的大块任务</li>
              <li>并发模式：被切成多个 ~5ms 的小块，中间有浏览器绘制的空隙</li>
            </ul>
          </li>
        </ol>
      </div>

      <div style={styles.modeSelector}>
        {[
          { key: 'sync', label: '同步模式', color: '#f44336' },
          { key: 'concurrent', label: '并发模式 (useTransition)', color: '#4CAF50' },
          { key: 'deferred', label: 'useDeferredValue', color: '#2196F3' },
        ].map(m => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            style={{
              ...styles.modeBtn,
              background: mode === m.key ? m.color : '#fff',
              color: mode === m.key ? '#fff' : '#333',
              borderColor: m.color,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div style={styles.schemaBox}>
        <pre style={styles.schema}>{
mode === 'sync'
? `同步渲染流程:
setState(inputValue)   ← SyncLane
setState(listData)     ← SyncLane (同一事件中批处理)
    ↓
一次性渲染所有内容（不可中断）
    ↓
[==================== 500个组件 ====================] 一个长任务
    ↓
浏览器终于可以绘制了 → 用户感受到卡顿`

: mode === 'concurrent'
? `并发渲染流程:
setState(inputValue)              ← SyncLane（高优先级）
startTransition(() => setState(listData))  ← TransitionLane（低优先级）
    ↓
第一次 render: 只渲染 input 变化 → 立即 commit → 用户看到输入响应
    ↓
第二次 render: 渲染列表（可中断）
[====] yield [====] yield [====] yield [====]  每 ~5ms 让出
         ↑                        ↑
    浏览器可以处理           如果有新输入
    绘制和用户输入           会中断当前 Transition`

: `useDeferredValue 流程:
const deferredInput = useDeferredValue(input)
    ↓
input 变化 → 立即 re-render，但 deferredInput 仍是旧值
    ↓
React 内部 schedule 一个 Transition 来更新 deferredInput
    ↓
等 Transition render 完成 → deferredInput 更新为新值 → 列表重渲染

本质上和 useTransition 类似，区别在于：
- useTransition: 你控制哪个 setState 是低优先级的
- useDeferredValue: 你控制哪个值是延迟的`
        }</pre>
      </div>

      {mode === 'sync' && <SyncMode />}
      {mode === 'concurrent' && <ConcurrentMode />}
      {mode === 'deferred' && <DeferredValueMode />}
    </div>
  );
}

const styles = {
  container: { padding: 20, maxWidth: 900, margin: '0 auto' },
  instructions: { background: '#f5f5f5', padding: 16, borderRadius: 8, marginBottom: 16 },
  modeSelector: { display: 'flex', gap: 8, marginBottom: 16 },
  modeBtn: { padding: '10px 20px', cursor: 'pointer', border: '2px solid', borderRadius: 6, fontSize: 14, fontWeight: 'bold' },
  modePanel: { marginTop: 16 },
  hint: { color: '#666', fontSize: 14 },
  input: { width: '100%', padding: 12, fontSize: 16, border: '2px solid #ddd', borderRadius: 8, boxSizing: 'border-box' },
  stats: { margin: '8px 0', fontSize: 14 },
  pending: { color: '#FF9800', fontWeight: 'bold' },
  listBox: { maxHeight: 300, overflow: 'auto', border: '1px solid #eee', borderRadius: 8, padding: 4 },
  schemaBox: { background: '#1e1e1e', borderRadius: 8, marginBottom: 16 },
  schema: { color: '#d4d4d4', fontSize: 13, lineHeight: 1.6, padding: 16, margin: 0 },
};
