import { createApp, HMR_TEST } from './app.js';

console.log(HMR_TEST);
console.time('⏱️ createApp');
createApp();
console.timeEnd('⏱️ createApp');

// Webpack HMR API
if (module.hot) {
  module.hot.accept('./app.js', () => {
    console.log('[Webpack HMR] 模块热更新');
    createApp();
  });
}
