# LLM Token 产出 → 后端服务 → 前端流式渲染 全链路解析

### 全链路总览

```
┌─────────────────────────────────────────────────────────────────┐
│  1. GPU 推理层                                                   │
│  Prompt → Prefill(并行) → KV Cache → Decode(逐token) → 采样     │
│                                          ↓ async yield token    │
├─────────────────────────────────────────────────────────────────┤
│  2. 推理引擎层 (vLLM / TGI)                                     │
│  PagedAttention 管理显存 · Continuous Batching 动态调度请求       │
│                                          ↓ async generator      │
├─────────────────────────────────────────────────────────────────┤
│  3. 后端服务层 (FastAPI / Express)                               │
│  格式化 SSE: "data: {delta}\n\n" · Transfer-Encoding: chunked   │
│                                          ↓ HTTP chunked stream  │
├─────────────────────────────────────────────────────────────────┤
│  4. 前端消费层 (Browser)                                         │
│  fetch + ReadableStream → TextDecoder → SSE 解析 → 增量渲染      │
└─────────────────────────────────────────────────────────────────┘
```

---

### 第一层：LLM 推理 — Token 是怎么一个一个"吐"出来的

#### 1.1 两阶段推理：Prefill vs Decode

LLM 推理分为两个计算特征完全不同的阶段：

```
用户输入 "请帮我写一首诗"
         ↓
┌─── Prefill 阶段（计算密集型）───┐
│  整条 prompt 并行输入模型         │
│  一次 forward pass 产出：        │
│  • 第一个输出 token              │
│  • N 个 KV 对（构成初始 KV Cache）│
│  耗时：100-500ms（取决于 prompt 长度）│
└──────────────────────────────────┘
         ↓
┌─── Decode 阶段（显存带宽瓶颈）───┐
│  逐 token 自回归生成              │
│  每次 forward pass 只产出 1 个 token │
│  读 KV Cache + 生成新 KV → 追加   │
│  每个 token 耗时：10-50ms         │
│  → 每个 token 产出后立即 yield    │
└──────────────────────────────────┘
```

**关键理解：** Prefill 是 GPU 计算密集型（大量矩阵运算），Decode 是显存带宽密集型（每步都要读取整个 KV Cache）。这也是为什么现代推理系统（如 DeepSeek 的 DuetServe）会将 Prefill 和 Decode **分离到不同 GPU 池**，避免相互干扰。

#### 1.2 KV Cache — 流式输出的效率基石

如果没有 KV Cache，生成第 N 个 token 时需要重新计算前 N-1 个 token 的所有 Attention，总复杂度 O(n²)。

KV Cache 缓存了每一层 Transformer 中所有已生成 token 的 Key 和 Value 向量。生成新 token 时，只需计算新 token 的 Q/K/V，然后与缓存的 K/V 做 Attention。

```
无 KV Cache:  生成 token₁ → 计算 1 步
              生成 token₂ → 重新计算 2 步
              生成 token₃ → 重新计算 3 步
              ...
              总计: 1+2+3+...+n = O(n²)

有 KV Cache:  生成 token₁ → 计算 1 步 → 缓存 KV₁
              生成 token₂ → 读 KV₁ + 计算 1 步 → 缓存 KV₂
              生成 token₃ → 读 KV₁₂ + 计算 1 步 → 缓存 KV₃
              ...
              总计: n 步，每步 O(n) 读取 → 总 O(n²) 但常数小很多
```

**为什么对流式输出至关重要：** KV Cache 使得每生成一个 token 只需一次轻量 forward pass（~10-50ms），token 产出后**立即 yield**给上层，实现了"打字机效果"。没有 KV Cache，每个 token 的延迟会随序列增长线性递增，流式体验无法接受。

**显存代价：** 13B 模型权重 ~26GB，A100 80GB 显卡只剩 ~54GB 给 KV Cache。长上下文 + 大并发时，KV Cache 是最大的显存消耗者。

#### 1.3 vLLM：PagedAttention + Continuous Batching

**传统做法的浪费：**

传统推理框架为每个请求**预分配**连续显存块（按最大输出长度），导致 60-80% 的显存被浪费：

```
请求 A: 预分配 2048 tokens 的 KV 空间，实际只生成了 200 tokens
        → 1848 个 slot 的显存被白白占用（内部碎片）
请求 B: 需要 500 tokens，但空闲区域中最大的连续块只有 400
        → 必须等待（外部碎片）
```

**PagedAttention — 借鉴 OS 虚拟内存分页：**

```
传统方式: 连续物理内存分配
┌──────────────────────────────────┐
│ 请求A的KV Cache (预分配2048 slots) │  ← 大量内部碎片
├──────────────────────────────────┤
│        空闲（外部碎片）            │  ← 无法利用
├──────────────────────────────────┤
│ 请求B的KV Cache (预分配2048 slots) │
└──────────────────────────────────┘

PagedAttention: 非连续分页分配
物理显存块: [Block0] [Block1] [Block2] [Block3] [Block4] ...

请求A的 Block Table:
  逻辑块0 → 物理块2
  逻辑块1 → 物理块4  (按需分配，用完再申请新块)

请求B的 Block Table:
  逻辑块0 → 物理块0
  逻辑块1 → 物理块3
```

- KV Cache 被切分为固定大小的 **Block**（页），不要求物理连续
- **Block Table** 维护逻辑块 → 物理块的映射（类似 OS 页表）
- 按需分配：生成新 token 填满当前块后，才申请新物理块
- 共享前缀的请求（如相同 system prompt）通过**引用计数 + Copy-on-Write** 共享 KV 块
- 显存浪费从 60-80% 降到 **< 4%**

**Continuous Batching — 动态批处理：**

```
传统静态 Batching:
  Batch 1: [请求A(长), 请求B(短), 请求C(短)]
           请求B、C 完成后必须等请求A，GPU 空转 pad

Continuous Batching:
  Step 1: [A, B, C] → B完成 → 移除B
  Step 2: [A, C, D] → D是新进入的请求，立即填入空位
  Step 3: [A, D, E] → C完成 → 移除C → E填入
```

每个 decode step 后，完成的请求立即移除，新请求立即填入，**GPU 零空转**。配合 PagedAttention，吞吐量比 HuggingFace Transformers 提升 **3-24 倍**。

#### 1.4 Token 采样策略

模型输出的是词表上的概率分布（logits），采样决定选哪个 token：

```
logits = model.forward(input)     # 原始分数
probs = softmax(logits / T)       # Temperature 缩放

# 采样管线: Temperature → Top-K → Top-P → 重归一化 → 采样
```

**Temperature（温度）：**

```
T < 1.0: 分布变尖锐 → 高概率 token 更突出 → 输出更确定/保守
T = 1.0: 原始分布
T > 1.0: 分布变平坦 → 低概率 token 获得更多机会 → 输出更随机/创意
T → 0:   退化为贪心解码（argmax）
```

**Top-K：** 只保留概率最高的 K 个 token，其余置零后重新归一化。问题是 K 是固定的——模型很确信时 K=20 太大（引入噪声），不确信时 K=20 太小（截断合理选项）。

**Top-P / Nucleus Sampling（核采样）：** 按概率降序排列，累积到总概率达到 P（如 0.9）时截断。**自适应**：确信时候选集小，不确信时候选集大。

#### 1.5 Token 产出：async generator 模式

推理引擎用 Python async generator 逐 token yield：

```python
async def generate_stream(prompt: str, params: SamplingParams):
    kv_cache = prefill(prompt)              # Prefill: 处理 prompt，建立 KV Cache

    while True:
        logits = decode_step(kv_cache)      # Decode: 一次 forward pass
        token = sample(logits, params)      # 采样: temperature + top-p + top-k
        kv_cache.append(token)              # 追加到 KV Cache

        yield token                         # 立即 yield 给上层！不等生成完毕

        if token == eos_token:
            break
```

**关键：** `yield token` 是流式的起点。每产出一个 token 就立即传递给后端服务层，不需要等整个回复生成完毕。

---

### 第二层：后端服务 — 如何将 Token 流包装为 HTTP 流式响应

#### 2.1 SSE（Server-Sent Events）协议格式

SSE 是 LLM 流式输出的事实标准（OpenAI / Anthropic / 各大模型厂商统一使用）。

**必需的 HTTP 响应头：**

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Transfer-Encoding: chunked
```

**消息格式 — 以双换行 `\n\n` 作为消息分隔符：**

```
event: token           ← 事件类型（可选，默认 "message"）
id: 42                 ← 事件 ID（可选，用于断线重连）
retry: 3000            ← 重连间隔 ms（可选）
data: {"content":"你"}  ← 数据载荷（必需）

data: {"content":"好"}

data: [DONE]           ← 流结束标记

```

- 以 `:` 开头的行是注释，常用于心跳保活：`: heartbeat\n\n`
- 多个 `data:` 行会被拼接（中间插入 `\n`）

#### 2.2 OpenAI 流式 API 格式（业界标准）

请求时设置 `"stream": true`，响应是 SSE 流：

```
data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"你"},"finish_reason":null}]}

data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}

data: {"id":"chatcmpl-xyz","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**与非流式响应的关键区别：**

| | 非流式 | 流式 |
|---|---|---|
| `object` | `chat.completion` | `chat.completion.chunk` |
| 内容字段 | `message.content`（完整内容） | `delta.content`（增量内容） |
| 第一个 chunk | — | `delta: { role: "assistant" }` |
| 中间 chunks | — | `delta: { content: "..." }` |
| 最后一个 chunk | — | `delta: {}`, `finish_reason: "stop"` |
| 终止标记 | — | `data: [DONE]` |

#### 2.3 后端实现：FastAPI 示例

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import json

app = FastAPI()

async def sse_generator(prompt: str):
    """将 LLM 的 token 流转换为 SSE 格式"""
    async for token in llm_engine.generate_stream(prompt):
        chunk = {
            "id": "chatcmpl-xxx",
            "object": "chat.completion.chunk",
            "choices": [{
                "index": 0,
                "delta": {"content": token},
                "finish_reason": None
            }]
        }
        yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

    # 流结束
    yield "data: [DONE]\n\n"

@app.post("/v1/chat/completions")
async def chat_completions(request: ChatRequest):
    if request.stream:
        return StreamingResponse(
            sse_generator(request.messages),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # 禁止 Nginx 缓冲
            }
        )
    else:
        # 非流式：等全部生成完毕再返回
        result = await llm_engine.generate(request.messages)
        return JSONResponse(result)
```

**Node.js Express 实现：**

```js
app.post('/v1/chat/completions', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();  // 立即发送响应头，不等 body

  for await (const token of llm.generateStream(req.body.messages)) {
    const chunk = JSON.stringify({
      choices: [{ index: 0, delta: { content: token }, finish_reason: null }]
    });
    res.write(`data: ${chunk}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
});
```

#### 2.4 HTTP Chunked Transfer Encoding — 传输层协议

SSE 数据在网络上通过 HTTP Chunked 编码传输。每个 chunk 的线上格式：

```
<chunk-size-hex>\r\n
<chunk-data>\r\n

示例:
1a\r\n                              ← 26 字节
data: {"content":"你"}\n\n\r\n      ← 实际数据
0\r\n                               ← 终止块
\r\n
```

浏览器透明处理 chunk 重组，应用层代码看到的是连续的字节流。

> 注意：HTTP/2 有自己的 DATA Frame 分帧机制，不使用 chunked 编码。但 SSE 的逻辑格式（`data: ...\n\n`）不变。

#### 2.5 SSE vs WebSocket vs HTTP Chunked

| | SSE | WebSocket | HTTP Chunked |
|---|---|---|---|
| 方向 | 服务端 → 客户端（单向） | 双向 | 服务端 → 客户端 |
| 协议 | HTTP | ws:// / wss://（独立协议） | HTTP |
| 自动重连 | 内置（EventSource API） | 需手动实现 | 需手动实现 |
| CDN/代理兼容 | 好（标准 HTTP） | 一般（需代理支持 Upgrade） | 好 |
| 适用场景 | **LLM token 流式输出**（首选） | 需要双向通信（语音、中断生成） | 大文件流式下载 |

**结论：** LLM 流式输出**首选 SSE**。只有需要客户端在生成过程中向服务端发消息（如中断生成、工具调用反馈）时才考虑 WebSocket。

#### 2.6 反压（Backpressure）处理

当 LLM 产出 token 的速度 > 网络传输速度时：

```
LLM 产出速率: 50 tokens/s
网络传输速率: 30 tokens/s （弱网环境）
         ↓
TCP 发送缓冲区填满 → TCP 滑动窗口收缩 → 内核暂停 socket 写入
         ↓
Node.js: res.write() 返回 false → 等待 'drain' 事件后再继续写入
Python:  StreamingResponse 内部处理，自动暂停 async generator 的消费
```

在 Node.js 中显式处理反压：

```js
for await (const token of llm.generateStream(messages)) {
  const chunk = `data: ${JSON.stringify({ delta: { content: token } })}\n\n`;
  const canContinue = res.write(chunk);
  if (!canContinue) {
    // 缓冲区满了，等待排空
    await new Promise(resolve => res.once('drain', resolve));
  }
}
```

---

### 第三层：前端消费 — 从字节流到用户看到的"打字机效果"

#### 3.1 fetch + ReadableStream（主流方案）

```ts
async function streamChat(messages: Message[]) {
  const response = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ messages, stream: true }),
    signal: abortController.signal,  // 支持取消
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';  // 行缓冲区

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // 1. 解码字节 → 文本（处理多字节字符被截断的情况）
    buffer += decoder.decode(value, { stream: true });

    // 2. 按行分割（保留未完成的行在缓冲区）
    const lines = buffer.split('\n');
    buffer = lines.pop()!;  // 最后一段可能不完整，留到下次

    // 3. 逐行解析 SSE
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;  // 空行或注释
      if (trimmed === 'data: [DONE]') return;             // 流结束

      if (trimmed.startsWith('data: ')) {
        const json = JSON.parse(trimmed.slice(6));
        const content = json.choices?.[0]?.delta?.content;
        if (content) {
          // 4. 增量追加到 UI
          appendToUI(content);
        }
      }
    }
  }
}
```

#### 3.2 为什么不用 EventSource API？

| | EventSource | fetch + ReadableStream |
|---|---|---|
| HTTP 方法 | **仅 GET** | 任意（POST 等） |
| 自定义 Header | **不支持** | 完全支持（Authorization 等） |
| 请求体 | **不支持** | 支持（发送 messages JSON） |
| 自动重连 | 内置 | 需手动实现 |

**EventSource 无法用于 LLM API**，因为：
- LLM API 使用 **POST** 请求发送 prompt/messages
- 需要 **Authorization** 头携带 API Key

替代方案：`@microsoft/fetch-event-source` 库在 fetch 基础上提供 EventSource 的便利性（自动重连、事件解析）。

#### 3.3 TextDecoder 处理多字节字符截断

UTF-8 编码中，中文占 3 字节，emoji 占 4 字节。网络 chunk 边界可能切在字符中间：

```
Chunk 1: [0xE4, 0xBD]           ← "你" 的前 2 字节（不完整）
Chunk 2: [0xA0, 0xE5, 0xA5, 0xBD]  ← "你" 的第 3 字节 + "好" 的全部 3 字节

不用 { stream: true }:
  decode(chunk1) → "�"   ← 乱码！U+FFFD 替换字符
  decode(chunk2) → "�好"

使用 { stream: true }:
  decode(chunk1, { stream: true }) → ""   ← 暂不输出，内部保留未完成字节
  decode(chunk2, { stream: true }) → "你好" ← 拼接完成，正确输出
```

**关键：** 必须复用同一个 `TextDecoder` 实例，且中间 chunk 传 `{ stream: true }`，最后调用 `decoder.decode()` 刷新剩余字节。

#### 3.4 React 中的流式状态管理

```tsx
function ChatMessage({ messages, onSend }: Props) {
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleSend = async (input: string) => {
    setIsStreaming(true);
    setStreamingContent('');
    abortRef.current = new AbortController();

    try {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, { role: 'user', content: input }], stream: true }),
        signal: abortRef.current.signal,
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;

        for (const line of lines) {
          if (line.trim() === 'data: [DONE]') break;
          if (line.startsWith('data: ')) {
            const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content;
            if (delta) {
              // 关键：用函数式 setState 保证增量追加的正确性
              setStreamingContent(prev => prev + delta);
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户主动取消，不是错误
      } else {
        console.error('Stream error:', err);
      }
    } finally {
      setIsStreaming(false);
    }
  };

  // 取消生成
  const handleStop = () => abortRef.current?.abort();

  return (
    <div>
      <div className="message">
        <MarkdownRenderer content={streamingContent} />
        {isStreaming && <span className="cursor blink" />}
      </div>
      {isStreaming
        ? <button onClick={handleStop}>停止生成</button>
        : <ChatInput onSend={handleSend} />
      }
    </div>
  );
}
```

**性能注意点：**
- `setStreamingContent(prev => prev + delta)` 每个 token 触发一次 re-render。如果 token 速率很高（50+ tokens/s），可以用 `requestAnimationFrame` 做批量合并，每帧只 setState 一次
- Markdown 渲染器避免每次 re-render 都全量解析——只重新解析最后一个未闭合的 block

#### 3.5 增量 Markdown 渲染的挑战

这是 LLM 流式 UI 中**最难的前端问题之一**：

**问题 1：语法标记的歧义性**

```
收到 "*"  → 是列表项？斜体开始？粗体开始（**）的一半？
收到 "`"  → 是行内代码？还是代码块（```）的开始？
收到 "|"  → 是表格？还是普通文本？
```

必须等后续 token 到达才能确定语义。

**问题 2：视觉闪烁**

```
Token 1: "这是"       → 渲染: 这是
Token 2: "**"         → 渲染: 这是**        ← 原始标记闪现
Token 3: "加粗"       → 渲染: 这是**加粗    ← 还是原始标记
Token 4: "**"         → 渲染: 这是加粗      ← 突然变为粗体
```

用户看到格式标记先出现再消失，体验很差。

**问题 3：块类型突变**

```
Token 1-3: "| Name | Age |"    → 当作普通文本渲染
Token 4:   "\n| --- | --- |"   → 原来是表格！整个块要重新渲染为 <table>
```

**解决方案：**

```
方案 1: 缓冲未闭合标记
  收到 "**" 后不立即渲染，等到闭合 "**" 到达后一次性渲染粗体

方案 2: 流式 Markdown 解析器（如 streaming-markdown）
  核心思想：只有最后一个顶层 block 可能发生变化，之前的 block 已定型
  → 增量解析只处理最后一个 block，O(1) 而非 O(n)

方案 3: 状态机逐字符处理
  Shopify 的做法：用有限状态机逐字符扫描，维护解析状态
  在 "可能是标记" 和 "确认是标记" 之间用中间状态缓冲
```

#### 3.6 取消机制：AbortController

```ts
// 创建
const controller = new AbortController();

// 传入 fetch
fetch(url, { signal: controller.signal });

// 取消（用户点击"停止生成"）
controller.abort();

// fetch 会抛出 AbortError
// 同时浏览器会关闭底层 TCP 连接
// 服务端检测到连接断开 → 停止 LLM 推理 → 释放 GPU 资源
```

**服务端感知取消：**

```python
# FastAPI
async def sse_generator():
    try:
        async for token in llm.generate_stream(prompt):
            yield f"data: {json.dumps({'content': token})}\n\n"
    except asyncio.CancelledError:
        # 客户端断开连接 → 通知推理引擎取消
        llm.cancel(request_id)
        raise
```

---

### 全链路时序图

```
时间轴 →

[用户]     点击发送
              │
[浏览器]      fetch POST /chat/completions { stream: true }
              │
[Nginx/CDN]   透传（X-Accel-Buffering: no 禁止缓冲）
              │
[后端服务]    收到请求 → 调用推理引擎
              │
[推理引擎]    ┌─ Prefill (100-500ms) ──────────────────────────┐
              │  处理 prompt，建立 KV Cache                      │
              └──────────────────────────────────────────────────┘
              │
              │  ← 第一个 token 延迟 (TTFT: Time To First Token)
              │
              ├── token₁ yield → SSE "data: {delta: '你'}\n\n" → HTTP chunk → 浏览器 reader.read()
              │   → TextDecoder → 解析 SSE → setState → React re-render → 用户看到 "你"
              │
              ├── token₂ yield → SSE "data: {delta: '好'}\n\n" → ... → 用户看到 "你好"
              │
              ├── token₃ yield → ...
              │
              ├── ...（每个 token 间隔 10-50ms）
              │
              └── EOS token → SSE "data: [DONE]\n\n" → reader.read() done:true
                                                        → setIsStreaming(false)
                                                        → 隐藏光标，显示完整消息
```

### 关键性能指标

| 指标 | 含义 | 典型值 |
|---|---|---|
| **TTFT**（Time To First Token） | 用户发送到看到第一个字 | 200ms - 2s |
| **ITL**（Inter-Token Latency） | 相邻两个 token 之间的间隔 | 10-50ms |
| **TPS**（Tokens Per Second） | 每秒产出 token 数 | 20-100 |
| **端到端延迟** | 从发送到完整回复渲染完毕 | 取决于回复长度 |

TTFT 受 Prefill 阶段影响最大（与 prompt 长度正相关），ITL 受 Decode 阶段影响（与 KV Cache 大小正相关）。用户体验上 TTFT < 1s 是基本要求。
