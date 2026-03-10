/**
 * 实验 4：Suspense 机制可视化
 *
 * 目标：理解 Suspense 的 "抛出 Promise" 模式和两遍渲染
 *
 * 操作步骤：
 *   1. 点击 "加载数据" 按钮
 *   2. 观察控制台 log：第一遍渲染(抛出Promise) → fallback → Promise resolve → 第二遍渲染
 *   3. 调整延迟时间，观察 Suspense 的行为
 *   4. 试试嵌套 Suspense，理解边界的概念
 */
import { useState, Suspense, use } from 'react';

// ─── 模拟数据获取 ───

// 简易缓存（模拟 React.lazy / use() 的行为）
const cache = new Map();

function fetchWithDelay(key, delay) {
  if (cache.has(key)) {
    const entry = cache.get(key);
    if (entry.status === 'resolved') return entry.value;
    if (entry.status === 'rejected') throw entry.error;
    throw entry.promise; // pending → 抛出 Promise → Suspense 捕获
  }

  const promise = new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() > 0.15) {
        const value = `✅ 数据 "${key}" 加载成功 (耗时 ${delay}ms)`;
        cache.set(key, { status: 'resolved', value, promise });
        resolve(value);
      } else {
        const error = new Error(`❌ 加载 "${key}" 失败`);
        cache.set(key, { status: 'rejected', error, promise });
        reject(error);
      }
    }, delay);
  });

  cache.set(key, { status: 'pending', promise });
  throw promise; // 第一次调用一定是 pending → 抛出 Promise
}

// ─── 组件 ───

function DataDisplay({ dataKey, delay }) {
  console.log(
    `%c[render] DataDisplay("${dataKey}") — 尝试获取数据...`,
    'color: #2196F3; font-weight: bold;'
  );

  // 这里会：
  // 1. 第一次：抛出 Promise → Suspense 捕获 → 显示 fallback
  // 2. Promise resolve 后：React 重新渲染 → 这次返回数据
  const data = fetchWithDelay(dataKey, delay);

  console.log(
    `%c[render] DataDisplay("${dataKey}") — 数据已就绪 ✓`,
    'color: #4CAF50; font-weight: bold;'
  );

  return (
    <div style={styles.dataCard}>
      <p>{data}</p>
    </div>
  );
}

// 使用 React 19 的 use() Hook
function DataWithUseHook({ promise, label }) {
  console.log(
    `%c[render] use("${label}") — 检查 Promise 状态...`,
    'color: #9C27B0; font-weight: bold;'
  );

  const data = use(promise);

  console.log(
    `%c[render] use("${label}") — 数据: ${data}`,
    'color: #4CAF50; font-weight: bold;'
  );

  return (
    <div style={styles.dataCard}>
      <p>{label}: {String(data)}</p>
    </div>
  );
}

function LoadingFallback({ label }) {
  console.log(
    `%c[fallback] 显示 Loading: "${label}"`,
    'color: #FF9800; font-weight: bold;'
  );
  return (
    <div style={styles.fallback}>
      <div style={styles.spinner} />
      <span>加载中: {label}...</span>
    </div>
  );
}

// ─── 错误边界 ───
import { Component } from 'react';

class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={styles.errorBox}>
          <p>{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            style={styles.retryBtn}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Demo 1: 基础 Suspense ───
function BasicSuspenseDemo() {
  const [key, setKey] = useState(0);
  const [delay, setDelay] = useState(2000);

  const handleLoad = () => {
    cache.clear();
    console.clear();
    console.log('%c═══ 触发 Suspense ═══', 'font-size: 16px; color: #9C27B0;');
    console.log('观察顺序: render(抛出Promise) → fallback显示 → Promise resolve → render(返回数据)');
    setKey(k => k + 1);
  };

  return (
    <div style={styles.demoBox}>
      <h3>Demo 1: 基础 Suspense — "抛出 Promise" 模式</h3>
      <div style={styles.controls}>
        <label>
          延迟: {delay}ms
          <input
            type="range"
            min={500}
            max={5000}
            step={500}
            value={delay}
            onChange={e => setDelay(Number(e.target.value))}
          />
        </label>
        <button onClick={handleLoad} style={styles.loadBtn}>
          加载数据 (清除缓存)
        </button>
      </div>
      {key > 0 && (
        <ErrorBoundary key={`eb-${key}`}>
          <Suspense fallback={<LoadingFallback label="基础数据" />}>
            <DataDisplay dataKey={`basic-${key}`} delay={delay} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}

// ─── Demo 2: 嵌套 Suspense ───
function NestedSuspenseDemo() {
  const [key, setKey] = useState(0);

  const handleLoad = () => {
    cache.clear();
    console.clear();
    console.log('%c═══ 嵌套 Suspense ═══', 'font-size: 16px; color: #9C27B0;');
    console.log('观察: 外层和内层 fallback 独立显示/隐藏');
    setKey(k => k + 1);
  };

  return (
    <div style={styles.demoBox}>
      <h3>Demo 2: 嵌套 Suspense — 独立的边界</h3>
      <button onClick={handleLoad} style={styles.loadBtn}>
        加载数据
      </button>
      {key > 0 && (
        <ErrorBoundary key={`eb-${key}`}>
          <Suspense fallback={<LoadingFallback label="外层" />}>
            <DataDisplay dataKey={`outer-${key}`} delay={1000} />
            <Suspense fallback={<LoadingFallback label="内层" />}>
              <DataDisplay dataKey={`inner-${key}`} delay={3000} />
            </Suspense>
          </Suspense>
        </ErrorBoundary>
      )}
      <pre style={styles.tree}>{`
Suspense 树结构:

<Suspense fallback="外层 Loading">     ← 1000ms 后显示外层数据
  <DataDisplay "outer" />               ← 抛出 Promise (1s)
  <Suspense fallback="内层 Loading">    ← 3000ms 后显示内层数据
    <DataDisplay "inner" />             ← 抛出 Promise (3s)
  </Suspense>
</Suspense>

关键行为:
- 外层 Promise resolve 后，外层内容显示，内层仍然显示 fallback
- 内层 Promise resolve 后，内层 fallback 替换为真实内容
- 内层 Suspense 不会影响外层已经显示的内容
      `}</pre>
    </div>
  );
}

// ─── Demo 3: use() Hook ───
function UseHookDemo() {
  const [key, setKey] = useState(0);
  const [promise, setPromise] = useState(null);

  const handleLoad = () => {
    console.clear();
    console.log('%c═══ use() Hook ═══', 'font-size: 16px; color: #9C27B0;');
    const newKey = key + 1;
    setKey(newKey);
    // 创建一个新的 Promise
    const p = new Promise(resolve => {
      setTimeout(() => resolve(`数据 #${newKey} 已加载`), 2000);
    });
    setPromise(p);
  };

  return (
    <div style={styles.demoBox}>
      <h3>Demo 3: use() Hook — React 19 的新方式</h3>
      <button onClick={handleLoad} style={styles.loadBtn}>
        创建 Promise 并用 use() 读取
      </button>
      {promise && (
        <ErrorBoundary key={`eb-${key}`}>
          <Suspense fallback={<LoadingFallback label="use() 等待中" />}>
            <DataWithUseHook promise={promise} label={`Promise #${key}`} />
          </Suspense>
        </ErrorBoundary>
      )}
      <pre style={styles.tree}>{`
use() 的工作原理 (trackUsedThenable):

1. 首次调用 use(promise):
   - promise.status === undefined → 设置为 'pending'
   - 挂载 .then() 回调设置 status/value
   - throw SuspenseException → Suspense 捕获

2. Promise resolve 后 React 重新渲染:
   - promise.status === 'fulfilled'
   - return promise.value → 正常返回数据

与 await 的区别:
  await  → 在同一位置继续执行
  use()  → 整个组件从头重新渲染，use() 返回 resolved 值
      `}</pre>
    </div>
  );
}

export default function Lab4_Suspense() {
  return (
    <div style={styles.container}>
      <h2>实验 4：Suspense 机制可视化</h2>

      <div style={styles.instructions}>
        <p><strong>打开控制台 (F12)</strong> 观察完整流程：</p>
        <ol>
          <li><span style={{ color: '#2196F3' }}>蓝色</span> = 组件 render（尝试获取数据）</li>
          <li><span style={{ color: '#FF9800' }}>橙色</span> = 显示 fallback（Promise 被捕获）</li>
          <li><span style={{ color: '#4CAF50' }}>绿色</span> = 数据就绪（Promise resolve 后重新渲染）</li>
        </ol>
      </div>

      <BasicSuspenseDemo />
      <NestedSuspenseDemo />
      <UseHookDemo />
    </div>
  );
}

const styles = {
  container: { padding: 20, maxWidth: 900, margin: '0 auto' },
  instructions: { background: '#f5f5f5', padding: 16, borderRadius: 8, marginBottom: 16 },
  demoBox: { border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 20 },
  controls: { display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 },
  loadBtn: { padding: '10px 20px', cursor: 'pointer', background: '#9C27B0', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14 },
  dataCard: { background: '#e8f5e9', padding: 12, borderRadius: 8, margin: '8px 0' },
  fallback: { background: '#fff3e0', padding: 16, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 },
  spinner: { width: 20, height: 20, border: '3px solid #FF9800', borderTop: '3px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  errorBox: { background: '#ffebee', padding: 16, borderRadius: 8, margin: '8px 0' },
  retryBtn: { padding: '6px 12px', cursor: 'pointer', background: '#f44336', color: '#fff', border: 'none', borderRadius: 4, marginTop: 8 },
  tree: { background: '#1e1e1e', color: '#d4d4d4', fontSize: 13, lineHeight: 1.6, padding: 16, borderRadius: 8, margin: '12px 0' },
};
