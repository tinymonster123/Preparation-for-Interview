// 工具模块 — 用于观察 Tree Shaking
// usedFunction 被引用，unusedFunction 不被引用

export const utils = {
  greet: (name) => `你好, ${name}!`,
  formatDate: (d) => d.toISOString(),
};

// 这个函数没有被任何地方引用 — Tree Shaking 应该移除它
export function unusedFunction() {
  console.log('我不应该出现在生产构建中');
  return Array.from({ length: 10000 }, (_, i) => `unused_${i}`);
}
