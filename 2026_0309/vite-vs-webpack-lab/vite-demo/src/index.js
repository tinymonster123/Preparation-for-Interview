import { createApp, HMR_TEST } from './app.js';

console.log(HMR_TEST);
console.time('⏱️ createApp');
createApp();
console.timeEnd('⏱️ createApp');

// Vite HMR API（import.meta.hot）
if (import.meta.hot) {
  import.meta.hot.accept('./app.js', (newModule) => {
    console.log('[Vite HMR] 模块热更新');
    createApp();
  });
}
