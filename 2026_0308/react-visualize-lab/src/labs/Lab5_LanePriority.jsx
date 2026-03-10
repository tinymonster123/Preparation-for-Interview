/**
 * 实验 5：Lane 优先级可视化
 *
 * 目标：直观感受不同优先级的更新如何被调度
 *   - SyncLane (click) vs TransitionLane (startTransition) vs DefaultLane
 *   - 高优先级打断低优先级
 *
 * 操作步骤：
 *   1. 观察不同操作触发的优先级
 *   2. 在 Transition 进行中快速点击高优先级按钮
 *   3. 观察高优先级如何插队
 */
import { useState, useTransition, useEffect, useRef } from 'react';

function Lane({ bits, label, active, color }) {
  return (
    <div style={{
      ...styles.lane,
      background: active ? color : '#f5f5f5',
      color: active ? '#fff' : '#999',
      borderColor: active ? color : '#ddd',
    }}>
      <code style={{ fontSize: 11 }}>{bits}</code>
      <span style={{ fontSize: 12, fontWeight: active ? 'bold' : 'normal' }}>{label}</span>
    </div>
  );
}

function LaneVisualizer({ activeLanes }) {
  const lanes = [
    { bits: '0b0000...0001', label: 'SyncHydrationLane', key: 'syncHydration', color: '#f44336' },
    { bits: '0b0000...0010', label: 'SyncLane', key: 'sync', color: '#e91e63' },
    { bits: '0b0000...0100', label: 'InputContinuousHydrationLane', key: 'inputContHydration', color: '#9C27B0' },
    { bits: '0b0000...1000', label: 'InputContinuousLane', key: 'inputCont', color: '#673AB7' },
    { bits: '0b0000..10000', label: 'DefaultHydrationLane', key: 'defaultHydration', color: '#3F51B5' },
    { bits: '0b0000..100000', label: 'DefaultLane', key: 'default', color: '#2196F3' },
    { bits: '0b0000.1000000', label: 'TransitionHydrationLane', key: 'transitionHydration', color: '#009688' },
    { bits: '0b...111...0', label: 'TransitionLanes (×16)', key: 'transition', color: '#4CAF50' },
    { bits: '0b...11110...0', label: 'RetryLanes (×5)', key: 'retry', color: '#FF9800' },
    { bits: '0b01000...0', label: 'IdleLane', key: 'idle', color: '#795548' },
    { bits: '0b10000...0', label: 'OffscreenLane', key: 'offscreen', color: '#607D8B' },
  ];

  return (
    <div style={styles.laneContainer}>
      <h4>Lane 位掩码 (低位 = 高优先级)</h4>
      <div style={styles.laneList}>
        {lanes.map(lane => (
          <Lane
            key={lane.key}
            {...lane}
            active={activeLanes.includes(lane.key)}
          />
        ))}
      </div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
        位越低 = 优先级越高 | 同一 Lane 内的更新会被批处理
      </div>
    </div>
  );
}

function UpdateTimeline({ events }) {
  return (
    <div style={styles.timeline}>
      <h4>更新时间线</h4>
      {events.length === 0 ? (
        <p style={{ color: '#999' }}>触发操作后会显示事件流</p>
      ) : (
        events.map((event, i) => (
          <div key={i} style={{
            ...styles.event,
            borderLeftColor: event.color,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{event.action}</strong>
              <code style={{ fontSize: 11, color: '#999' }}>{event.time}</code>
            </div>
            <div style={{ fontSize: 13, color: '#666' }}>
              Lane: {event.lane} | 调度: {event.scheduler}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// 故意制造一个很慢的组件来让 Transition 可以被打断
function SlowContent({ value }) {
  const start = performance.now();
  while (performance.now() - start < 2) { /* busy */ }
  return <div style={styles.slowItem}>渲染: {value}</div>;
}

export default function Lab5_LanePriority() {
  const [syncCount, setSyncCount] = useState(0);
  const [transitionCount, setTransitionCount] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [transitionList, setTransitionList] = useState([]);
  const [activeLanes, setActiveLanes] = useState([]);
  const [events, setEvents] = useState([]);
  const timeRef = useRef(Date.now());

  const addEvent = (action, lane, scheduler, color) => {
    const elapsed = Date.now() - timeRef.current;
    setEvents(prev => [...prev.slice(-15), {
      action, lane, scheduler, color,
      time: `+${elapsed}ms`,
    }]);
  };

  // 高优先级：同步更新 (SyncLane)
  const handleSyncClick = () => {
    setActiveLanes(['sync']);
    addEvent('Click → setState', 'SyncLane', 'ImmediatePriority', '#e91e63');
    setSyncCount(c => c + 1);
    setTimeout(() => setActiveLanes([]), 500);
  };

  // 低优先级：Transition (TransitionLane)
  const handleTransition = () => {
    setActiveLanes(['transition']);
    addEvent('startTransition → setState', 'TransitionLane', 'NormalPriority', '#4CAF50');

    startTransition(() => {
      setTransitionCount(c => c + 1);
      setTransitionList(
        Array.from({ length: 200 }, (_, i) => `Item-${i}`)
      );
    });
  };

  // 同时触发高低优先级
  const handleBoth = () => {
    timeRef.current = Date.now();
    setEvents([]);
    setActiveLanes(['sync', 'transition']);

    addEvent('Click → setSyncCount', 'SyncLane', 'ImmediatePriority', '#e91e63');
    setSyncCount(c => c + 1);

    addEvent('startTransition → setList', 'TransitionLane', 'NormalPriority', '#4CAF50');
    startTransition(() => {
      setTransitionCount(c => c + 1);
      setTransitionList(
        Array.from({ length: 200 }, (_, i) => `Item-${i}`)
      );
    });

    setTimeout(() => setActiveLanes([]), 1000);
  };

  const handleReset = () => {
    timeRef.current = Date.now();
    setEvents([]);
    setActiveLanes([]);
    setSyncCount(0);
    setTransitionCount(0);
    setTransitionList([]);
  };

  return (
    <div style={styles.container}>
      <h2>实验 5：Lane 优先级可视化</h2>

      <div style={styles.instructions}>
        <p><strong>核心概念：</strong></p>
        <ul>
          <li>每次 setState 都会被分配一个 Lane（优先级）</li>
          <li>Click 事件 → SyncLane（最高，立即执行）</li>
          <li>startTransition → TransitionLane（低，可中断）</li>
          <li>高优先级更新可以<strong>打断</strong>正在进行的低优先级渲染</li>
        </ul>
      </div>

      <div style={styles.buttonRow}>
        <button onClick={handleSyncClick} style={{ ...styles.btn, background: '#e91e63' }}>
          高优先级 (SyncLane)
        </button>
        <button onClick={handleTransition} style={{ ...styles.btn, background: '#4CAF50' }}>
          低优先级 (TransitionLane)
        </button>
        <button onClick={handleBoth} style={{ ...styles.btn, background: '#FF9800' }}>
          同时触发两个优先级
        </button>
        <button onClick={handleReset} style={{ ...styles.btn, background: '#9e9e9e' }}>
          重置
        </button>
      </div>

      <div style={styles.statusRow}>
        <div style={styles.statusCard}>
          <div>同步计数 (SyncLane)</div>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: '#e91e63' }}>{syncCount}</div>
          <div style={{ fontSize: 12, color: '#999' }}>立即更新</div>
        </div>
        <div style={styles.statusCard}>
          <div>Transition 计数</div>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: '#4CAF50' }}>{transitionCount}</div>
          <div style={{ fontSize: 12, color: isPending ? '#FF9800' : '#999' }}>
            {isPending ? '⏳ Transition 渲染中...' : '就绪'}
          </div>
        </div>
      </div>

      <div style={styles.mainLayout}>
        <LaneVisualizer activeLanes={activeLanes} />
        <UpdateTimeline events={events} />
      </div>

      <pre style={styles.schema}>{`
调度流程 (ensureRootIsScheduled):

setState()
  → requestUpdateLane(fiber)
     → 检查是否在 transition 上下文中？
        是 → 返回 TransitionLane
        否 → 根据事件类型返回 (click → SyncLane, mousemove → InputContinuousLane)
  → scheduleUpdateOnFiber(fiber, lane)
     → root.pendingLanes |= lane            // 用位运算合并优先级
  → ensureRootIsScheduled(root)
     → getNextLanes()                       // 取最高优先级 (l & -l)
     → 比较新旧优先级
        → 相同 → 复用现有任务（批处理！）
        → 不同 → 取消旧任务，调度新任务（高优先级插队！）
     → scheduleCallback(priority, performConcurrentWorkOnRoot)
        → 推入 Scheduler 最小堆
        → MessageChannel 触发下一个时间片
      `}</pre>

      {transitionList.length > 0 && (
        <div style={{
          ...styles.listBox,
          opacity: isPending ? 0.5 : 1,
        }}>
          <h4>Transition 渲染的列表 ({transitionList.length} items)</h4>
          <div style={{ maxHeight: 150, overflow: 'auto', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {transitionList.map((item, i) => (
              <SlowContent key={i} value={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { padding: 20, maxWidth: 1000, margin: '0 auto' },
  instructions: { background: '#f5f5f5', padding: 16, borderRadius: 8, marginBottom: 16 },
  buttonRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  btn: { padding: '10px 20px', cursor: 'pointer', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 'bold' },
  statusRow: { display: 'flex', gap: 16, marginBottom: 16 },
  statusCard: { flex: 1, border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, textAlign: 'center' },
  mainLayout: { display: 'flex', gap: 16, marginBottom: 16 },
  laneContainer: { flex: 1 },
  laneList: { display: 'flex', flexDirection: 'column', gap: 3 },
  lane: { display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px', borderRadius: 4, border: '1px solid', fontSize: 12, transition: 'all 0.3s' },
  timeline: { flex: 1, maxHeight: 400, overflow: 'auto' },
  event: { borderLeft: '3px solid', padding: '6px 12px', marginBottom: 6, background: '#fafafa', borderRadius: '0 4px 4px 0' },
  schema: { background: '#1e1e1e', color: '#d4d4d4', fontSize: 13, lineHeight: 1.6, padding: 16, borderRadius: 8, margin: '12px 0' },
  listBox: { border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, transition: 'opacity 0.2s' },
  slowItem: { padding: '2px 6px', background: '#e8f5e9', borderRadius: 4, fontSize: 12 },
};
