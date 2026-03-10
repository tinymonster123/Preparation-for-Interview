// 懒加载模块 — 通过 import() 动态导入
// 在 Network 面板可以观察到：这个文件只在点击按钮时才被请求

export function lazyModule() {
  console.log('✅ 懒加载模块已加载！');
  return `懒加载成功！时间: ${new Date().toLocaleTimeString()}`;
}
