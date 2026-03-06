# WebGL 图形学知识点 —— 面试防御手册

> 你的优化过程用了工程思想（并行、池化、背压），但这些思想落地在图形管线上。
> 面试官会从图形侧追问，确认你是否真正理解底层发生了什么。

---

## 1. 一张图片从 URL 到屏幕，经历了什么？

```
CDN URL
  │
  ▼
① 网络下载（异步，IO 线程）
  → 拿到压缩的二进制数据（PNG/JPEG/WebP 格式）
  │
  ▼
② 图片解码（CPU 密集）
  → 将压缩数据解码为原始像素数组（RGBA，每像素 4 字节）
  → 一张 256×256 的图：256 × 256 × 4 = 262,144 字节 ≈ 256KB
  → 一张 1024×1024 的图：4MB！
  │
  ▼
③ 纹理上传（CPU → GPU，主线程同步）
  → gl.texImage2D() 把像素数据从 CPU 内存（RAM）传输到 GPU 显存（VRAM）
  → 这一步走的是 PCIe 总线，有带宽瓶颈
  → 而且是同步阻塞的！主线程必须等 GPU 确认收到
  │
  ▼
④ GPU 渲染（GPU 并行）
  → 顶点着色器确定"画在哪"
  → 片元着色器确定"画什么颜色"（从纹理采样）
  → 结果写入帧缓冲区（Framebuffer）
  │
  ▼
⑤ 合成上屏（Compositor）
  → 浏览器合成器将 WebGL Canvas 和其他 DOM 层合成
  → SwapBuffers → 显示到屏幕
```

### 面试官可能问的

**Q: 这五步里，哪些在主线程，哪些不在？**

| 步骤 | 线程 | 阻塞主线程？ |
|------|------|-------------|
| ① 网络下载 | IO 线程 | 否 |
| ② 图片解码 | Raster 线程（createImageBitmap）或主线程（new Image 惰性解码） | **取决于 API** |
| ③ texImage2D | **主线程** | **是！这是优化的关键瓶颈** |
| ④ GPU 渲染 | GPU | 否（但 drawCall 的发出在主线程） |
| ⑤ 合成上屏 | Compositor 线程 | 否 |

---

## 2. texImage2D vs texSubImage2D

这是面试中最容易被追问的 API 对。

### texImage2D —— "创建 + 上传"

```js
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageSource);
```

底层做了两件事：
1. **在 GPU 显存中分配一块纹理空间**（根据图片尺寸）
2. **把像素数据从 CPU 传到这块显存**

相当于 `malloc + memcpy`。

### texSubImage2D —— "只上传，不重新分配"

```js
gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageSource);
```

底层只做一件事：
1. **把像素数据传到已有的纹理空间**（覆盖原有内容）

相当于只做 `memcpy`，省掉了 `malloc`。

### 为什么对象池要用 texSubImage2D？

```
不用对象池：每张图 → texImage2D（malloc + memcpy）→ deleteTexture（free）→ 再 texImage2D...
用对象池：  第一次 texImage2D（malloc + memcpy）→ 之后全用 texSubImage2D（只 memcpy）

省掉了反复的显存分配/释放，减轻 GPU 内存管理器的压力。
```

### 面试官可能问的

**Q: texSubImage2D 为什么比 texImage2D 快？**
> 因为它跳过了 GPU 显存的分配步骤。显存分配涉及 GPU 内存管理器查找空闲块、可能的内存整理，是有开销的。texSubImage2D 直接写入已有的纹理空间，只做数据传输。

**Q: 如果新图片尺寸和旧纹理不一样呢？**
> texSubImage2D 要求写入区域不能超过纹理尺寸。如果新图更大，必须先用 texImage2D 重新分配。我们的对象池统一了纹理尺寸（都是 256×256），所以可以安全复用。在实际业务中，可以按尺寸档位（128/256/512/1024）分桶池化。

---

## 3. WebGL 着色器管线

面试官可能会问"你写过着色器吗"或者"顶点着色器和片元着色器分别干什么"。

### 渲染一个贴图矩形的最小管线

```
CPU 侧准备                          GPU 侧执行
─────────────                       ─────────────
顶点数据（位置坐标）──→ attribute ──→ 顶点着色器（Vertex Shader）
纹理坐标 ──────────→ attribute ──→     ↓ varying 插值
纹理对象 ──────────→ uniform ───→ 片元着色器（Fragment Shader）
                                       ↓
                                   帧缓冲区 → 屏幕
```

### 顶点着色器（Vertex Shader）

**职责**：确定每个顶点"画在屏幕哪个位置"。

```glsl
attribute vec2 a_position;   // CPU 传入的像素坐标（如 100, 200）
attribute vec2 a_texCoord;   // 纹理坐标（0~1）
varying vec2 v_texCoord;     // 传给片元着色器

void main() {
  // 像素坐标 → clip space [-1, 1]
  vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
  v_texCoord = a_texCoord;
}
```

**面试要点**：
- `attribute`：每个顶点不同的数据（位置、纹理坐标）
- `gl_Position`：输出，clip space 坐标，范围 [-1, 1]
- `varying`：顶点着色器传给片元着色器的值，GPU 会自动在顶点之间**线性插值**

### 片元着色器（Fragment Shader）

**职责**：确定每个像素"画什么颜色"。

```glsl
precision mediump float;
varying vec2 v_texCoord;      // 从顶点着色器插值而来
uniform sampler2D u_image;    // 纹理

void main() {
  gl_FragColor = texture2D(u_image, v_texCoord);  // 从纹理采样颜色
}
```

**面试要点**：
- `uniform`：全局常量，所有片元共享（如纹理、变换矩阵）
- `texture2D(sampler, coord)`：根据纹理坐标从纹理中采样一个像素颜色
- `gl_FragColor`：输出，这个片元的最终颜色（RGBA）

### 面试官可能问的

**Q: varying 的插值是怎么回事？**
> 顶点着色器只处理顶点（比如矩形的 4 个角），但矩形内部有成千上万个像素。GPU 会对 varying 变量在顶点之间做**线性插值**（重心坐标插值），所以片元着色器拿到的 `v_texCoord` 是平滑过渡的值，从 (0,0) 到 (1,1)。

**Q: 为什么要把像素坐标转成 clip space？**
> WebGL 的坐标系是 [-1, 1] 的标准化设备坐标（NDC），不是像素坐标。左下角是 (-1,-1)，右上角是 (1,1)。我们在 JS 里用像素坐标方便计算，在着色器里必须转换。

---

## 4. Chrome 的多线程渲染架构

```
┌─────────────────────────────────────────────────┐
│  浏览器进程（Browser Process）                    │
│    管理 Tab、网络请求、用户输入                     │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  渲染进程（Renderer Process）                     │
│                                                  │
│  ┌──────────────────────────────┐                │
│  │  主线程（Main Thread）         │                │
│  │  - JS 执行                    │                │
│  │  - DOM 操作                   │                │
│  │  - texImage2D 调用            │ ← 我们优化的焦点 │
│  │  - rAF 回调                   │                │
│  └──────────────────────────────┘                │
│                                                  │
│  ┌──────────────────────────────┐                │
│  │  合成器线程（Compositor）      │                │
│  │  - 图层合成                   │                │
│  │  - 滚动处理（可脱离主线程）     │                │
│  └──────────────────────────────┘                │
│                                                  │
│  ┌──────────────────────────────┐                │
│  │  Raster 线程池                │                │
│  │  - 图片解码（Decode Image）    │ ← createImageBitmap 在这里 │
│  │  - 图层光栅化                 │                │
│  └──────────────────────────────┘                │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  GPU 进程（GPU Process）                          │
│  - 执行 GL 命令                                   │
│  - 纹理上传到显存                                  │
│  - 绘制调用                                       │
│  - SwapBuffers 上屏                               │
└─────────────────────────────────────────────────┘
```

### 面试官可能问的

**Q: 为什么 texImage2D 在主线程而不是 GPU 进程？**
> `texImage2D` 的 JS 调用确实在主线程。主线程把 GL 命令写入**命令缓冲区（Command Buffer）**，然后 GPU 进程异步消费这些命令。但主线程必须等命令写入完成才能继续，而且对于纹理上传，还需要把像素数据从 JS 堆拷贝到共享内存——这个拷贝是同步的。所以虽然 GPU 执行是异步的，主线程仍然被阻塞。

**Q: createImageBitmap 为什么能在后台线程解码？**
> 因为图片解码是纯 CPU 运算（解压 PNG/JPEG），不需要访问 DOM 或 JS 对象，所以可以安全地在 Raster 线程执行。返回的 ImageBitmap 是一个特殊对象，它的像素数据存储在共享内存中，可以直接被 GPU 进程读取，不需要再经过主线程拷贝。

---

## 5. GPU 显存（VRAM）vs JS 堆内存

这是理解 `bitmap.close()` 和对象池的关键。

```
JS 堆（V8 管理）                    GPU 显存（VRAM，驱动管理）
┌───────────────────┐              ┌───────────────────┐
│                   │              │                   │
│  Image 对象 (小)   │              │  纹理数据 (大)     │
│  {src, width, ...}│              │  256×256×4 = 256KB │
│  ~100 bytes       │   texImage2D │                   │
│                   │  ──────────→ │                   │
│  ImageBitmap (小)  │              │                   │
│  {引用指针}        │              │                   │
│  ~50 bytes        │              │                   │
│                   │              │                   │
│  Sprite 对象 (小)  │              │                   │
│  {x, y, texture}  │              │                   │
│  ~200 bytes       │              │                   │
└───────────────────┘              └───────────────────┘
   V8 GC 管理                         gl.deleteTexture() 释放
   被动回收，有停顿                      或 bitmap.close() 释放
```

### 关键认知

1. **JS 堆里的对象很小**（Sprite 几百字节），但 GC 压力来自**数量**（500 个 new → Minor GC）
2. **真正占内存的是 GPU 显存里的纹理数据**和 **ImageBitmap 底层的 C++ 像素缓冲区**
3. `bitmap.close()` 释放的是 **C++ 层的像素缓冲区**，不是 JS 对象本身
4. `gl.deleteTexture()` 释放的是 **GPU 显存**
5. 对象池减轻的是 **V8 GC 压力**（减少 new/丢弃的频率）
6. `close()` 和 `deleteTexture()` 解决的是 **底层内存堆积**

### 面试官可能问的

**Q: bitmap.close() 之后 JS 里的 bitmap 变量还在吗？**
> 在。`close()` 只释放底层的像素缓冲区，JS 对象壳子还在堆里（但变成不可用状态，再传给 texImage2D 会报错）。JS 对象壳子等正常 GC 回收，但它只有几十字节，压力可忽略。

**Q: 如果不调 deleteTexture，纹理会泄漏吗？**
> WebGL 纹理的生命周期绑定在 WebGL 上下文上。如果不手动 deleteTexture，纹理会在上下文销毁（页面关闭）时统一释放。但在运行中，不释放的纹理会持续占用显存，可能导致 GPU 内存不足，浏览器会强制丢失上下文（context lost）。

---

## 6. 背压控制在图形管线中的意义

### 为什么图形管线需要背压？

传统 Web 开发（DOM 操作）没有"管线"概念，但 WebGL 有一个隐式的**生产-消费管线**：

```
生产（CPU 侧）                    消费（GPU 侧）
──────────────                   ──────────────
图片下载 → 解码 → texImage2D ───→ GPU 纹理上传 → 渲染

生产速度：createImageBitmap 可以批量并发（极快）
消费速度：texImage2D 必须逐个同步执行（受 PCIe 带宽限制）
```

如果生产 >> 消费（500 个 bitmap 同时就绪，但每帧只能上传几张），bitmap 就会在内存中堆积。

**背压就是让生产速率匹配消费速率**：
- `MAX_INFLIGHT = 10`：最多 10 个 bitmap 同时存活
- 消费端每上传一个 → `inflight--` → 生产端才创建下一个
- 内存水位始终可控

### 面试官可能问的

**Q: 为什么不直接限制 createImageBitmap 的并发数就行了？为什么还需要对象池？**
> 背压控制的是 **ImageBitmap 的数量**（短期存活的中间产物）。
> 对象池控制的是 **Sprite + Texture 的创建销毁频率**（长期复用的容器）。
> 两者解决不同层面的问题：背压防止内存峰值，对象池防止 GC 频率。

---

## 快速自查清单

面试前过一遍，确保每个概念都能用一句话解释：

- [ ] texImage2D 和 texSubImage2D 的区别？（分配+传输 vs 只传输）
- [ ] 顶点着色器和片元着色器各干什么？（定位 vs 着色）
- [ ] varying 是什么？怎么插值的？（顶点间线性插值）
- [ ] attribute、uniform、varying 的区别？（每顶点/全局/插值传递）
- [ ] clip space 是什么范围？（-1 到 1）
- [ ] createImageBitmap 在哪个线程执行？（Raster 线程）
- [ ] texImage2D 为什么阻塞主线程？（像素数据拷贝是同步的）
- [ ] bitmap.close() 释放的是什么？（C++ 层像素缓冲区，不是 JS 对象）
- [ ] GPU 显存和 JS 堆是什么关系？（独立的，分别由驱动和 V8 管理）
- [ ] context lost 是什么？（GPU 资源耗尽，浏览器强制回收 WebGL 上下文）

---

## 7. WebGL 基础：它到底是什么？

### 一句话

**WebGL 是 OpenGL ES 2.0 的 JavaScript 绑定（binding），运行在浏览器里的 GPU 编程接口。**

```
桌面端：    C/C++ 代码  →  调用 OpenGL API     →  GPU 驱动  →  显卡
移动端：    Java/Swift   →  调用 OpenGL ES API  →  GPU 驱动  →  显卡
浏览器端：  JavaScript   →  调用 WebGL API      →  浏览器翻译为 GL 命令  →  GPU 驱动  →  显卡
```

WebGL API（`gl.bindTexture`、`gl.bindBuffer`、`gl.bindBuffer`...）和 OpenGL ES **几乎一一对应**。浏览器只是做了一层"JS 到 C++ 的桥接"。

### 为什么着色器是"C 语言风格的字符串"？

```js
// 你在 JS 里看到的
const vsSource = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0, 1);
  }
`;
gl.shaderSource(vertexShader, vsSource);  // 把字符串传给 GPU
gl.compileShader(vertexShader);           // GPU 驱动编译它
```

这段字符串不是 JS，也不是 C，而是 **GLSL（OpenGL Shading Language）**。它看起来像 C 是因为 GLSL 确实脱胎于 C 语言。

**关键认知：着色器代码不在 CPU 上运行，它在 GPU 上运行。**

```
你写的 JS 代码          → V8 引擎解释执行 → 跑在 CPU 上
你写的 GLSL 着色器字符串  → GPU 驱动编译为机器码 → 跑在 GPU 的着色器核心上
```

整个流程：

```
① JS 里写 GLSL 字符串
     │
     ▼
② gl.shaderSource(shader, string)
   → 把字符串从 JS 堆传到浏览器 C++ 层
     │
     ▼
③ gl.compileShader(shader)
   → 浏览器把 GLSL 源码传给 GPU 驱动
   → GPU 驱动把 GLSL 编译为 GPU 机器码（类似 gcc 编译 C）
   → 如果语法错误，这一步会失败（可以用 gl.getShaderInfoLog 拿到错误信息）
     │
     ▼
④ gl.linkProgram(program)
   → 把顶点着色器和片元着色器链接成一个完整的"着色器程序"
   → 类似 C 的链接步骤（ld），把两个 .o 链接成可执行文件
     │
     ▼
⑤ gl.useProgram(program)
   → 告诉 GPU："后续的绘制命令都用这个着色器程序"
     │
     ▼
⑥ gl.bindbindBindDrawArrays() / gl.drawElements()
   → GPU 对每个顶点执行顶点着色器
   → GPU 对每个像素执行片元着色器
   → 数千个 GPU 核心并行执行同一份着色器代码
```

### 为什么不能直接用 JS 写着色器？

| | JS | GLSL |
|--|-----|------|
| 运行在 | CPU（单线程） | GPU（数千核心并行） |
| 执行模式 | 顺序执行 | **SIMD：同一份代码对每个顶点/像素并行执行** |
| 内存模型 | 堆、栈、GC | 寄存器、显存、无 GC |
| 类型系统 | 动态类型 | **严格静态类型**（vec2, mat4, sampler2D...） |
| 编译时机 | 运行时 JIT | **提前编译为 GPU 机器码** |

GPU 是一台和 CPU 完全不同架构的处理器。它不理解 JS，只理解自己的机器码。GLSL 是专门为 GPU 设计的语言，编译器也内置在 GPU 驱动里。

**类比**：就像你不能用 Python 直接写 SQL 查询一样——数据库引擎有自己的执行引擎，SQL 是它理解的语言。GPU 也是一样，GLSL 是它理解的语言。

### 面试官可能问的

**Q: 着色器编译发生在什么时候？会卡主线程吗？**
> `gl.compileShader()` 和 `gl.linkProgram()` 是同步调用，会阻塞主线程。但着色器通常只在初始化时编译一次（不是每帧编译），所以不会成为运行时瓶颈。如果着色器很复杂或数量多，初始化时可能会有明显的等待。WebGL 2.0 没有异步编译 API，但有些浏览器支持 `KHR_parallel_shader_compile` 扩展来缓解。

**Q: GLSL 里的 vec2、vec4、mat4 是什么？**
> 这些是 GPU 原生支持的向量和矩阵类型，**在硬件层面有专门的寄存器和运算单元**：
> - `vec2`：二维向量 (x, y)，常用于纹理坐标、2D 位置
> - `vec4`：四维向量 (x, y, z, w)，常用于颜色 (RGBA) 和裁剪空间坐标
> - `mat4`：4×4 矩阵，用于变换（平移、旋转、缩放、投影）
> GPU 做 `vec4 * vec4` 或 `mat4 * vec4` 是单条指令，不像 CPU 上要拆成多次乘加。

---

## 8. WebGL 核心 API 速查（gl.bindXxx 全家桶）

WebGL 的编程模式是**状态机**——你不是直接告诉 GPU "把这个纹理画到这个位置"，而是一步步设置状态，最后一个 `draw` 命令把当前状态全部提交。

### 状态机模型

```
想象 GPU 是一台老式缝纫机：
  - 你不能说"缝一条红线从 A 到 B"
  - 你要说：
    1. 换红色线（bindTexture）
    2. 放好布料（bindBuffer + 传数据）
    3. 设置针脚（vertexAttribPointer）
    4. 踩踏板开始缝（bindDrawArrays）
```

### 核心 API 分组

#### 第一组：缓冲区（Buffer）—— "顶点数据怎么传给 GPU"

```js
// 1. 创建缓冲区对象（在 GPU 侧分配一块内存）
const buffer = gl.createBuffer();

// 2. 绑定：告诉 GPU "后续操作针对这个缓冲区"
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

// 3. 填充数据：把 JS 的 Float32Array 传到 GPU 缓冲区
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  // x, y 顶点坐标
  0, 0,
  100, 0,
  0, 100,
]), gl.STATIC_DRAW);
//    ↑ 提示 GPU：这个数据不会频繁变化（GPU 可以优化存储位置）
//    gl.DYNAMIC_DRAW = 会频繁变化（GPU 放在容易修改的位置）

// 4. 告诉着色器怎么读这个缓冲区
gl.enableVertexAttribArray(positionAttributeLocation);
gl.vertexAttribPointer(
  positionAttributeLocation,  // 着色器里 attribute 的位置
  2,                          // 每次取 2 个数（vec2）
  gl.FLOAT,                   // 数据类型
  false,                      // 不归一化
  0,                          // 步进（0 = 紧密排列）
  0                           // 偏移
);
```

#### 第二组：纹理（Texture）—— "图片数据怎么传给 GPU"

```js
// 1. 创建纹理对象
const texture = gl.createTexture();

// 2. 绑定：后续操作针对这个纹理
gl.bindTexture(gl.TEXTURE_2D, texture);

// 3. 上传像素数据（从 CPU → GPU 显存）
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageSource);

// 4. 设置采样参数（GPU 读取纹理时怎么处理边界和缩放）
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);   // 水平方向：超出边界就取边缘色
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);   // 垂直方向同上
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);      // 缩小时：线性插值（平滑）
//                                                      gl.NEAREST      // 另一种：最近邻（像素风）
```

#### 第三组：着色器程序（Program）—— "GPU 执行什么代码"

```js
// 1. 创建、编译着色器
const vs = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vs, vsSourceString);   // 传入 GLSL 字符串
gl.compileShader(vs);                  // GPU 驱动编译

const fs = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fs, fsSourceString);
gl.compileShader(fs);

// 2. 链接成程序
const program = gl.createProgram();
gl.attachShader(program, vs);
gl.attachShader(program, fs);
gl.linkProgram(program);

// 3. 使用这个程序
gl.useProgram(program);

// 4. 获取 attribute/uniform 的"地址"（用于后续传数据）
const posLoc = gl.getAttribLocation(program, 'a_position');
const texLoc = gl.getUniformLocation(program, 'u_image');
```

#### 第四组：绘制（Draw）—— "开画！"

```js
// 清屏
gl.clearColor(0, 0, 0, 1);   // 设置清屏颜色（黑色）
gl.clear(gl.COLOR_BUFFER_BIT);

// 画！
gl.bindDrawArrays(gl.TRIANGLES, 0, 6);
//        ↑ 图元类型     ↑ 起始  ↑ 顶点数
//
// TRIANGLES = 每 3 个顶点画一个三角形
// 6 个顶点 = 2 个三角形 = 1 个矩形
//
//  v0 ─── v1        三角形1: v0, v1, v2
//  │ ╲    │         三角形2: v2, v1, v3
//  │  ╲   │
//  v2 ─── v3
```

### 一次完整绘制的 API 调用顺序

```js
// === 初始化阶段（只做一次）===
gl.createBuffer()    →  gl.bindBuffer()  →  gl.bufferData()       // 准备顶点数据
gl.createTexture()   →  gl.bindTexture() →  gl.texImage2D()       // 准备纹理
gl.createShader() ×2 →  gl.compileShader() ×2 → gl.linkProgram() // 准备着色器
gl.getAttribLocation() / gl.getUniformLocation()                  // 拿到"地址"

// === 每帧渲染（rAF 循环里）===
gl.clear()                          // 清屏
gl.useProgram(bindProgram)                 // 选择着色器
gl.bindBuffer() + gl.bindVertexAttribPointer()  // "顶点数据插到着色器的 attribute 口上"
gl.bindTexture()                    // "纹理插到着色器的 uniform sampler 口上"
gl.drawArrays()                     // 开画！GPU 并行执行着色器
```

### 为什么这么麻烦？——状态机的设计哲学

WebGL 继承自 OpenGL（1992 年设计），当时的设计原则：

1. **最小化 CPU↔GPU 通信**：不是每次 draw 都传全部数据，而是"设好状态"后一个 draw 命令就行
2. **GPU 硬件直接映射**：每个 API 调用几乎直接对应一条 GPU 硬件指令
3. **零抽象开销**：不做任何高层封装，给你最底层的控制权

这就是为什么 WebGL 代码看起来很"啰嗦"——它不是为开发者体验设计的，是为**性能**设计的。PixiJS、Three.js 等框架的价值就在于把这些状态机操作封装成 `sprite.bindTexture = texture` 这样的高层 API。

### 面试官可能问的

**Q: gl.bindXxx 到底在做什么？**
> 设置 GPU 状态机的"当前激活对象"。`bindTexture(GL_TEXTURE_2D, tex)` 意思是"把 tex 设为当前纹理"，后续的 `texImage2D`、`drawArrays` 都会作用于这个纹理。就像终端里 `cd /some/path` 设置当前目录一样。

**Q: STATIC_DRAW 和 DYNAMIC_DRAW 有什么区别？**
> 这是给 GPU 驱动的**优化提示**。`STATIC_DRAW` 告诉 GPU"这块数据不会变，可以放在高速但不好改的显存里"。`DYNAMIC_DRAW` 告诉 GPU"这块数据会频繁更新，放在容易修改的位置"。选错不会报错，但可能影响性能。

**Q: 为什么画一个矩形需要 6 个顶点（2 个三角形）？**
> GPU 硬件只认识三角形（Triangle），不认识矩形。一个矩形必须拆成 2 个三角形。这是因为三角形是唯一保证共面的多边形（3 点确定一个平面），GPU 的光栅化硬件就是按三角形设计的。如果想避免重复顶点，可以用 `gl.bindDrawElements` + 索引缓冲区（Index Buffer）来复用顶点。
