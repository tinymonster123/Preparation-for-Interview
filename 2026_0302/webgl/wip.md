# WebGL 性能优化实验 - 进度追踪

## 总览

| 阶段 | 状态 | 说明 |
|------|------|------|
| 阶段 1：制造灾难 | ✅ 已完成 | 基线数据已采集 |
| 阶段 2：异步解码 | ✅ 已完成 | `createImageBitmap` 替换 `new Image()` |
| 阶段 3：rAF 时间切片 | ✅ 已完成 | 双队列调度器平摊创建 + `texImage2D` |
| 阶段 4：对象池 | ✅ 已完成 | 对象池 + 背压控制 + `bitmap.close()` |

---

## 阶段 1 ✅

- [x] 编写灾难代码 `index.html`
- [x] 内置 Performance API 监控（Long Task / Memory / Frame Duration）
- [x] 采集基线数据：2 FPS / Long Task 最长 1549ms / 内存波动 96.6MB
- [x] 理解 Performance 面板帧颜色（红/绿）含义
- [x] 理解 Raster 线程池和 GPU 进程的作用
- [x] 记录到 index.md

## 阶段 2 ✅

- [x] 用 `createImageBitmap` 替换 `toDataURL` + `new Image()`
- [x] 增加轮次校验防止幽灵渲染
- [x] bitmap 用完立刻 `close()`
- [x] 采集数据：42 FPS / Long Task -85% / 但内存峰值飙到 414MB
- [x] 记录到 index.md

## 阶段 3 ✅

- [x] 实现 texImage2D 上传时间切片调度器（FRAME_BUDGET = 12ms）
- [x] 发现 500 次 createElement 同步循环也是 Long Task，增加 createQueue 切片
- [x] 双队列调度：创建 6ms + 上传 12ms
- [x] 采集数据：56 FPS / Long Task 降至 5 次 / 掉帧 4.3%
- [x] 剩余 Long Task 来自 GC 停顿（内存波动 183MB，GC 12 次）
- [x] 记录到 index.md

## 阶段 4 ✅

- [x] 实现 Sprite 对象池（acquireSprite / releaseSprite）
- [x] 纹理复用：texSubImage2D 替换 texImage2D
- [x] Canvas 复用：reusableCanvas 消灭临时 Canvas 垃圾
- [x] v1 失败：500 个 bitmap 同时存活，内存未改善
- [x] v2 失败：直接 canvas→texSubImage2D 反而更慢（同步读像素）
- [x] v3 成功：背压控制 MAX_INFLIGHT=10，限制同时存活 bitmap
- [x] 排查发现：浏览器扩展造成严重干扰（BrowserStack/Sider/1Password）
- [x] 无痕模式验证：60 FPS / 0 Long Task / Heap 37.7MB / GC 仅 2 次
- [x] 记录到 index.md
