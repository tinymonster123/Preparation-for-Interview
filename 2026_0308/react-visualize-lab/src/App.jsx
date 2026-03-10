import { useState } from 'react';
import Lab1_RenderOrder from './labs/Lab1_RenderOrder';
import Lab2_DiffAlgorithm from './labs/Lab2_DiffAlgorithm';
import Lab3_ConcurrentMode from './labs/Lab3_ConcurrentMode';
import Lab4_Suspense from './labs/Lab4_Suspense';
import Lab5_LanePriority from './labs/Lab5_LanePriority';

const LABS = [
  { key: 'lab1', label: '1. 渲染顺序', component: Lab1_RenderOrder, topic: '渲染原理' },
  { key: 'lab2', label: '2. Diff 算法', component: Lab2_DiffAlgorithm, topic: '渲染原理' },
  { key: 'lab3', label: '3. 并发调度', component: Lab3_ConcurrentMode, topic: '并发机制' },
  { key: 'lab4', label: '4. Suspense', component: Lab4_Suspense, topic: '异步渲染' },
  { key: 'lab5', label: '5. Lane 优先级', component: Lab5_LanePriority, topic: '并发机制' },
];

export default function App() {
  const [activeLab, setActiveLab] = useState('lab1');
  const ActiveComponent = LABS.find(l => l.key === activeLab)?.component;

  return (
    <div>
      <nav style={styles.nav}>
        <h2 style={styles.title}>React 高阶特性可视化实验室</h2>
        <div style={styles.tabs}>
          {LABS.map(lab => (
            <button
              key={lab.key}
              onClick={() => setActiveLab(lab.key)}
              style={{
                ...styles.tab,
                background: activeLab === lab.key ? '#1976D2' : 'transparent',
                color: activeLab === lab.key ? '#fff' : '#ccc',
              }}
            >
              <span>{lab.label}</span>
              <span style={styles.topic}>{lab.topic}</span>
            </button>
          ))}
        </div>
      </nav>

      <main style={styles.main}>
        {ActiveComponent && <ActiveComponent />}
      </main>
    </div>
  );
}

const styles = {
  nav: {
    background: '#1a1a2e',
    padding: '12px 20px',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  title: {
    color: '#fff',
    margin: '0 0 8px 0',
    fontSize: 18,
  },
  tabs: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
  },
  tab: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    fontSize: 14,
  },
  topic: {
    fontSize: 11,
    opacity: 0.7,
  },
  main: {
    minHeight: '100vh',
    background: '#fff',
  },
};
