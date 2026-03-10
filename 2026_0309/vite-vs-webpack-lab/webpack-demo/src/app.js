// ============================================
// 共享业务代码 — 两个项目使用完全相同的源码
// ============================================

import { heavyCompute } from './heavy.js';
import { utils } from './utils.js';

// 入口模块
export function createApp() {
  const root = document.getElementById('app');

  root.innerHTML = `
    <h1>Vite vs Webpack 实验</h1>
    <p>当前时间: ${new Date().toLocaleTimeString()}</p>
    <p>Utils 结果: ${utils.greet('面试官')}</p>
    <button id="heavy-btn">点击触发动态 import (懒加载)</button>
    <button id="compute-btn">同步计算</button>
    <div id="output"></div>
  `;

  // 同步计算按钮
  document.getElementById('compute-btn').addEventListener('click', () => {
    const result = heavyCompute(42);
    document.getElementById('output').textContent = `计算结果: ${result}`;
  });

  // 动态 import — 懒加载实验
  document.getElementById('heavy-btn').addEventListener('click', async () => {
    console.time('⏱️ 动态 import 耗时');
    const { lazyModule } = await import('./lazy-module.js');
    console.timeEnd('⏱️ 动态 import 耗时');
    document.getElementById('output').textContent = lazyModule();
  });
}

// HMR 实验：修改这行文字后观察更新速度
export const HMR_TEST = '1';
