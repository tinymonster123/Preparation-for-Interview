// 一个同步引入的模块（会被打入主 bundle）
export function heavyCompute(n) {
  let result = 0;
  for (let i = 0; i < n * 1000; i++) {
    result += Math.sqrt(i);
  }
  return result.toFixed(2);
}
