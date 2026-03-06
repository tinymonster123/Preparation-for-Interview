# WebGL 性能优化实验记录

> 复现简历中的优化点："利用 createImageBitmap 异步解码图片并在渲染层引入 rAF 调度与对象池，有效抑制了 GC 抖动，保障 60FPS 流畅度"

## 实验架构

一个极简的 WebGL 应用，模拟无限画布场景下大量图片节点的创建/销毁/渲染。通过 4 个阶段逐步优化，每阶段用 Performance API 采集数据对比。

---

## 阶段 1：制造灾难（构建 Bug 基线）

### 目的

故意用最糟糕的写法，制造 Long Task + GC 抖动，作为优化前的基线数据。

### 故意犯的 5 个错误

1. `document.createElement('canvas')` × 500 —— 每轮疯狂创建临时 Canvas
2. `toDataURL('image/png')` —— 每张图生成巨大 base64 字符串（纯垃圾内存）
3. `new Image()` 同步解码 —— 主线程被图片解码阻塞
4. `gl.texImage2D` 无节流 —— 500 次纹理上传一口气塞进主线程
5. 每 800ms 全部销毁重建 —— V8 不断产生和回收大量垃圾对象

### 内置 Performance API 监控

| API | 采集内容 |
|-----|---------|
| `PerformanceObserver({ type: 'longtask' })` | 捕获所有 >50ms 的 Long Task |
| `performance.memory` | 每 200ms 采样 JS Heap，检测 GC 锯齿（内存突降 >0.5MB 算一次 GC） |
| rAF 时间差 | 每帧实际耗时，统计掉帧率 |

### 阶段 1 基线数据

```
====== 阶段1 性能报告 (10s 采样) ======

【Long Task】
  总次数: 13
  最长: 1549.0 ms
  平均: 906.2 ms

【帧率】
  总帧数: 24
  平均帧耗时: 519.9 ms (2 FPS)
  最长帧: 1530.1 ms
  掉帧次数 (>20ms): 24 / 24 (100.0%)

【内存 (JS Heap)】
  峰值: 125.5 MB
  GC 触发次数: ~1
  采样点数: 4
  最低: 28.9 MB
  最高: 125.5 MB
  波动幅度: 96.6 MB

========================================
```

### Performance 面板关键观察

![alt text](<../webgl/assets/CleanShot 2026-03-02 at 22.08.38@2x.png>)
![alt text](<../webgl/assets/CleanShot 2026-03-02 at 22.09.14@2x.png>)
![alt text](<../webgl/assets/CleanShot 2026-03-02 at 22.10.01@2x.png>)
![alt text](<../webgl/assets/CleanShot 2026-03-02 at 22.10.38@2x.png>)
![alt text](<../webgl/assets/CleanShot 2026-03-02 at 22.12.09@2x.png>)

#### 帧颜色含义（红 vs 绿）

帧的红/绿**不是单纯看耗时是否超过 16.6ms**：

- **绿色** = 该帧**成功渲染并上屏**（Fully Presented），哪怕略超 16.6ms（如 17.6ms）
- **红色** = 该帧**部分呈现或掉帧**（Partially Presented / Dropped），即使耗时只有 15.5ms

15.5ms 标红的原因：主线程虽然在 15ms 内跑完了 JS，但提交给 GPU 合成器的时机错过了 VSync 信号，或前一帧的 Long Task 尾巴拖住了渲染管线。

#### Raster 线程池（Worker）

- Chrome 的合成器光栅化工作线程，负责图片解码（Decode Image）、图片缩放、绘制位图块
- 在独立工作线程上执行，不阻塞主线程
- 实验中可看到大量 `Decode Image` 任务堆积

#### GPU 进程

- 执行实际的 GL 命令：纹理上传（`texImage2D`）、绘制调用（`drawArrays`）
- 页面合成（Compositing）、SwapBuffers（提交到屏幕）
- 实验中可看到密集的 GPU 任务块

#### 协作关系

```
主线程                    Raster 线程              GPU 进程
  │                         │                       │
  ├─ new Image()            │                       │
  ├─ img.src = dataURL ────→├─ Decode Image         │
  │  (等待解码...)           ├─ Decode Image         │
  │                         ├─ ...500张...           │
  ├─ img.onload 触发 ←──────┤                       │
  ├─ gl.texImage2D ────────────────────────────────→├─ 纹理上传到显存
  ├─ ...500次同步阻塞...                             ├─ ...
  ├─ gl.drawArrays ────────────────────────────────→├─ 绘制
  │                                                 ├─ SwapBuffers → 上屏
```

Raster 线程的解码是并行的不阻塞主线程，但 500 个 `onload` 回调涌回主线程后，`texImage2D` 的同步调用才是真正的瓶颈。

---

## 阶段 2：破局点 1 —— 异步解码

### 核心改动

```
❌ 阶段1: tmpCanvas → toDataURL(巨大字符串) → new Image() → img.onload → texImage2D
✅ 阶段2: tmpCanvas → createImageBitmap(异步后台解码) → .then()  → texImage2D
```

1. **干掉 `toDataURL` + `new Image()`** → 改用 `createImageBitmap(tmpCanvas)`，解码转移到后台 Raster 线程
2. **增加轮次校验** → `thisRound !== currentRound` 时丢弃过期 bitmap，避免幽灵渲染
3. **bitmap 用完立刻 `close()`** → 提前释放底层 C++ 内存，不等被动 GC

### 阶段 2 数据

```
====== 阶段2 性能报告 (10s 采样) ======

【Long Task】
  总次数: 19
  最长: 372.0 ms
  平均: 136.4 ms

【帧率】
  总帧数: 417
  平均帧耗时: 24.1 ms (42 FPS)
  最长帧: 536.3 ms
  掉帧次数 (>20ms): 42 / 417 (10.1%)

【内存 (JS Heap)】
  峰值: 414.2 MB
  GC 触发次数: ~12
  采样点数: 42
  最低: 52.6 MB
  最高: 414.2 MB
  波动幅度: 361.6 MB

========================================
```

### 阶段 1 vs 阶段 2 对比

| 指标 | 阶段 1 | 阶段 2 | 变化 |
|------|--------|--------|------|
| FPS | 2 | 42 | +2000% |
| Long Task 最长 | 1549ms | 372ms | -76% |
| Long Task 平均 | 906ms | 136ms | -85% |
| 掉帧率 | 100% | 10.1% | -90% |
| Heap 峰值 | 125.5MB | 414.2MB | +230% |
| 内存波动 | 96.6MB | 361.6MB | +274% |
| GC 次数 | ~1 | ~12 | +1100% |

### 分析

**改善**：主线程解放。`createImageBitmap` 把解码搬到后台线程，FPS 从 2 飙到 42，Long Task 缩短 85%。

**恶化**：内存反而炸了。原因：
- 阶段 1 的 `new Image()` 是懒加载，很多图还没解码就被销毁，内存反而不高
- 阶段 2 的 `createImageBitmap` 积极解码 —— 500 张图全部解码出完整 RGBA 像素数据（256×256×4 = 256KB/张，500 张 ≈ 128MB），全部驻留内存
- 加上 500 个临时 Canvas、Promise 对象等，峰值冲到 414MB
- GC 被迫频繁出手（12 次），每次回收产生卡顿

### 剩余瓶颈

1. `texImage2D` 仍然同步阻塞 → 还有 10% 掉帧 → 阶段 3 解决
2. 大量对象同时存活导致内存峰值飙升 + GC 频繁 → 阶段 4 解决

---

## 阶段 3：破局点 2 —— rAF 时间切片调度

### 核心改动

```
❌ 阶段2: createImageBitmap → .then() 里直接 texImage2D（500次涌入主线程）
✅ 阶段3: 双队列时间切片调度
```

**双队列调度架构**：

```
创建阶段（每帧 6ms 预算）          上传阶段（每帧 12ms 预算）
┌─────────────────────┐        ┌─────────────────────┐
│ createQueue          │        │ uploadQueue          │
│ 500 个创建任务       │  rAF   │ bitmap 待上传        │  rAF
│ → createElement      │──────→│ → texImage2D         │──────→ 渲染
│ → 2d 绘制            │        │ → bitmap.close()     │
│ → createImageBitmap  │        │                     │
│ 时间到 → break       │        │ 时间到 → break       │
└─────────────────────┘        └─────────────────────┘
```

关键设计：
1. **创建也做切片**：500 次 `createElement('canvas')` 不再同步循环，分摊到多帧（每帧 6ms）
2. **上传切片**：`texImage2D` 每帧最多执行 12ms，时间到强制 break
3. **存活校验**：每次从队列取 bitmap 前检查轮次是否过期，过期直接 `close()` 丢弃
4. **销毁时清空双队列**：避免幽灵渲染

调度器核心代码：

```js
function processUploadQueue(frameStart) {
  while (uploadQueue.length > 0) {
    if (performance.now() - frameStart >= FRAME_BUDGET) break;
    const task = uploadQueue.shift();
    if (task.round !== currentRound) { task.bitmap.close(); continue; }
    // texImage2D...
    task.bitmap.close();
  }
}
```

### 迭代过程

第一版只对 `texImage2D` 做了时间切片，Long Task 从 19→16 次，但 500 次 `createElement` 的同步循环本身仍是 Long Task。

第二版增加 `createQueue` + `processCreateQueue`，把 Canvas 生成也分摊到多帧，Long Task 降至 5 次。

### 阶段 3 数据

```
====== 阶段3 性能报告 (10s 采样) ======

【Long Task】
  总次数: 5
  最长: 214.0 ms
  平均: 127.2 ms

【帧率】
  总帧数: 563
  平均帧耗时: 17.8 ms (56 FPS)
  最长帧: 278.9 ms
  掉帧次数 (>20ms): 24 / 563 (4.3%)

【内存 (JS Heap)】
  峰值: 231.9 MB
  GC 触发次数: ~12
  采样点数: 49
  最低: 48.6 MB
  最高: 231.9 MB
  波动幅度: 183.2 MB

========================================
```

### 三阶段对比

| 指标 | 阶段 1 | 阶段 2 | 阶段 3 |
|------|--------|--------|--------|
| FPS | 2 | 42 | **56** |
| Long Task 最长 | 1549ms | 372ms | **214ms** |
| Long Task 次数 | 13 | 19 | **5** |
| 掉帧率 | 100% | 10.1% | **4.3%** |
| Heap 峰值 | 125.5MB | 414.2MB | **231.9MB** |
| 内存波动 | 96.6MB | 361.6MB | **183.2MB** |
| GC 次数 | ~1 | ~12 | **~12** |

### 分析

**改善**：时间切片有效。FPS 42→56，Long Task 从 19 降至 5，掉帧率减半。

**剩余瓶颈**：5 次 Long Task（最长 214ms）来自 **GC 停顿**而非 JS 执行。内存 48.6↔231.9MB 剧烈波动，12 次 GC 说明 V8 仍在被迫频繁执行 Major GC，每次 GC 回收约 180MB 时产生同步阻塞。

→ 阶段 4 用对象池 + `bitmap.close()` 主动释放来消灭 GC 停顿。

---

## 阶段 4：破局点 3 —— 对象池 + 背压控制 + 主动内存释放

### 核心改动（3 大机制）

#### 1. Sprite 对象池

```js
const spritePool = [];

function acquireSprite() {
  if (spritePool.length > 0) return spritePool.pop();  // 池命中
  // 池空 → 创建新 texture，预分配显存
  const tex = gl.createTexture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, IMG_SIZE, IMG_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return { texture: tex, x: 0, y: 0, size: 0 };
}

function releaseSprite(sprite) {
  spritePool.push(sprite);  // 归还，不销毁
}
```

池化内容：WebGL Texture 对象 + sprite 容器。减少 `new` 调用，减轻 V8 Minor GC 压力。
纹理用 `texSubImage2D` 更新像素（只改内容不重新分配显存），比 `texImage2D` 更快。

#### 2. 背压控制（Backpressure）

```js
const MAX_INFLIGHT = 10;  // 同时最多 10 个 ImageBitmap 存活
let inflight = 0;

function produceImages() {
  while (remaining > 0 && inflight < MAX_INFLIGHT) {
    remaining--;
    inflight++;
    drawRandomImage();
    const sprite = acquireSprite();
    createImageBitmap(reusableCanvas).then((bitmap) => {
      inflight--;  // 解码完成，释放名额
      uploadQueue.push({ bitmap, sprite, round: thisRound });
    });
  }
}
```

之前 500 个 `createImageBitmap` 同时发射 → 500 个 ImageBitmap 同时存活（~128MB）。
现在限制最多 10 个在飞 → 峰值仅 ~2.5MB。消费端每上传一张 `inflight--`，生产端才能创建下一张。

#### 3. 复用 Canvas + bitmap.close() 主动释放

- 一个 `reusableCanvas` 反复绘制，不再 `createElement`（消灭 500 个临时 Canvas 垃圾）
- bitmap 上传完毕立刻 `close()`，绕过 GC 直接释放底层 C++ 图像内存
- 过期轮次的 bitmap 也立刻 `close()` 丢弃

### 迭代过程

**v1**：对象池 + Canvas 复用 + bitmap.close()，但 500 个 createImageBitmap 同时发射
→ 内存峰值仍有 262MB，GC 11 次，改善不明显

**v2**（错误尝试）：干掉 createImageBitmap，直接 canvas → texSubImage2D
→ 反而更慢（主线程同步读像素），FPS 降到 39

**v3**：加入背压控制 MAX_INFLIGHT=10，限制同时存活的 bitmap 数量
→ 内存和 GC 大幅改善

### 排查插曲：浏览器扩展干扰

v3 的 Performance API 报告仍显示 Long Task 和高内存，通过 Performance 面板的第三方分析发现：

| 来源 | 主线程耗时 |
|------|-----------|
| 我们的代码 (127.0.0.1) | 245.8 ms |
| BrowserStack Bug Capture | 308.3 ms |
| Sider AI | 66.4 ms |
| 1Password | 58.9 ms |

扩展比我们的代码还耗时！节点数从 1,911 暴增到 65,123，文档数 22→10,422，均为扩展注入。

**切换到无痕模式后，问题全部消失。**

### 阶段 4 数据（无痕模式，排除扩展干扰）

```
====== 阶段4 性能报告 (10s 采样) ======

【Long Task】
  总次数: 0
  最长: 0.0 ms
  平均: N/A ms

【帧率】
  总帧数: 601
  平均帧耗时: 16.6 ms (60 FPS)
  最长帧: 30.7 ms
  掉帧次数 (>20ms): 1 / 601 (0.2%)

【内存 (JS Heap)】
  峰值: 37.7 MB
  GC 触发次数: ~2
  采样点数: 50
  最低: 8.4 MB
  最高: 37.7 MB
  波动幅度: 29.3 MB

【对象池】
  池命中: 5530
  池未命中: 490
  命中率: 91.9%

========================================
```

### 四阶段终极对比

| 指标 | 阶段 1 | 阶段 2 | 阶段 3 | **阶段 4** |
|------|--------|--------|--------|-----------|
| FPS | 2 | 42 | 56 | **60** |
| Long Task 次数 | 13 | 19 | 5 | **0** |
| Long Task 最长 | 1549ms | 372ms | 214ms | **0ms** |
| 掉帧率 | 100% | 10.1% | 4.3% | **0.2%** |
| Heap 峰值 | 125.5MB | 414.2MB | 231.9MB | **37.7MB** |
| 内存波动 | 96.6MB | 361.6MB | 183.2MB | **29.3MB** |
| GC 次数 | ~1 | ~12 | ~12 | **~2** |

### 总结：三板斧对应的量化收益

| 优化手段 | 解决的问题 | 量化效果 |
|----------|-----------|---------|
| `createImageBitmap` 异步解码 | 主线程解码阻塞 | FPS 2→42，Long Task -85% |
| rAF 时间切片调度 | `texImage2D` 同步拥堵 | FPS 42→56，掉帧 10%→4% |
| 对象池 + 背压 + `close()` | GC 抖动 + 内存峰值 | FPS→60，Heap 峰值 -70%，GC -83% |
