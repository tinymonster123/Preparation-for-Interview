# 百度：文心一言

## 八股和项目 Part

1. websocket 和 sse 的区别
2. fetch 和 axios 的底层原理
3. fetchEventSource 和 sse 的区别
4. 对于懒加载的理解
5. 对于虚拟列表的理解
6. 不定高虚拟列表的处理
7. 跨域问题的处理
8. 每次 localhost 或者域名变化，但是不好意思和后端沟通添加 allow-site,那应该如何处理
9. ES6 中 array 的遍历方法
10. webpack 和 vite 的区别
11. Pinia 构建多模块 Store
12. https 和 http 区别
13. Next.js 和 React 的区别

## 参考答案（速背版）

### 1) WebSocket vs SSE

- 通信模型：WebSocket 全双工；SSE 单向（服务端 -> 客户端）。
- 协议：WebSocket 通过 HTTP Upgrade 后变为 ws/wss；SSE 是普通 HTTP 长连接（`text/event-stream`）。
- 数据格式：WebSocket 传二进制/文本都行；SSE 约定文本事件格式（event/id/data/retry）。
- 断线重连：SSE 原生带自动重连 + `Last-Event-ID`；WebSocket 要自己做心跳/重连/补偿。
- 场景：聊天室/协同编辑/需要客户端上行实时交互 -> WebSocket；LLM 流式输出/通知推送/日志流 -> SSE。

### 2) fetch vs axios（底层与行为差异）

- 底层：`fetch` 是浏览器原生 Web API（现代环境可用 Streams）；`axios` 是库，浏览器端历史上基于 XHR（新版本也可走 fetch 适配），Node 端走 http/https 适配。
- 错误语义：`fetch` 只有网络错误才 reject，HTTP 4xx/5xx 仍 resolve（要手动 `if (!res.ok) throw ...`）；axios 4xx/5xx 默认 reject。
- 拦截器/中间件：axios 有请求/响应拦截器、统一 transform；fetch 需要自己封装。
- 取消请求：fetch 用 `AbortController`；axios 也支持取消（内部适配）。
- Cookie/跨域：fetch 需显式设置 `credentials: 'include'` 才带跨站 cookie；axios 用 `withCredentials: true`。

### 3) fetchEventSource vs SSE

- SSE（原生）：用 `EventSource(url)`，只能 GET，设置自定义 header 不方便（浏览器限制），自动重连。
- fetchEventSource（常见实现方式）：用 `fetch` 读 `ReadableStream` 来“模拟 SSE”。
    - 优点：可自定义 headers、可 POST、可更细粒度控制重连/退避、可接入 auth token。
    - 代价：需要库/自己处理解析与重连；不是真正的 EventSource 对象。

### 4) 懒加载（Lazy Loading）的理解

- 核心目标：把“现在用不到的资源/代码/内容”延后到需要时再加载，降低首屏 JS/CSS/图片体积。
- 常见类型：
    - 路由/组件懒加载：`import()` + code splitting（React `lazy`/Vue 异步组件）。
    - 图片/列表懒加载：`loading="lazy"` 或 IntersectionObserver。
    - 第三方脚本懒加载：用户交互后再加载。
- 注意点：预取/预加载（prefetch/preload）、chunk 颗粒度、首屏关键路径不要懒。

### 5) 虚拟列表（Virtual List）的理解

- 核心：只渲染可视区附近的少量 DOM，其他用“占位高度”撑开滚动条。
- 关键实现：
    - 计算可视区起止 index（`scrollTop` / `itemHeight` 或通过二分查找）。
    - 上下 buffer（overscan）减少滚动抖动。
    - 用一个“content 容器”做 `transform: translateY(...)` 来定位渲染窗口。

### 6) 不定高虚拟列表怎么做

- 难点：`itemHeight` 不固定，`scrollTop -> index` 不能用除法。
- 常见方案：
    1) 估算高度 + 动态修正：初始化用预估高度，渲染后测量真实高度（ResizeObserver/`getBoundingClientRect`），维护 `heightMap`。
    2) 前缀和（offsets）：维护每个 item 的累计高度 `prefixSum`，用二分查找定位当前起始 index。
    3) 锚点（anchor）保持：当上方 item 高度被修正时，调整 `scrollTop` 抵消跳动。
- 工程取舍：估算越准，首次滚动越稳；测量越多，性能开销越大。

### 7) 跨域（CORS）怎么处理

- 正解：服务端返回 CORS 响应头：
    - `Access-Control-Allow-Origin`（不能用 `*` 搭配 credentials）
    - 预检 OPTIONS：`Access-Control-Allow-Methods/Headers`，必要时 `Access-Control-Max-Age`。
- 带 cookie：前端 `credentials: 'include'` / `withCredentials: true`，后端 `Access-Control-Allow-Credentials: true` 且 origin 需明确。
- 其他：反向代理/同源网关（Nginx、DevServer proxy）、JSONP（仅 GET 且不推荐）、postMessage（iframe 场景）。

### 8) 域名总变、又不方便让后端加 allowlist，怎么办

- 研发/本地最常用：前端开发代理，把请求变成“同源”再转发到后端。
    - Vite：`server.proxy`
    - Webpack devServer：`devServer.proxy`
- 或者：本地起一个反向代理（Nginx/Node 中转），统一固定一个本地域名（如 `api.local.test`）
    - 再配 hosts 让它稳定指向 127.0.0.1。
- 说明：浏览器的 CORS 是强约束，前端无法“绕过”，只能通过“同源代理/网关”或“让服务端放行”。

### 9) ES6+ Array 的遍历方法

- 回调式：`forEach`（无返回）、`map`（映射）、`filter`、`reduce`、`some`、`every`、`find/findIndex`、`flatMap`。
- 迭代器：`for...of`、`entries()`、`keys()`、`values()`。
- 注意：`forEach` 不能 `break/continue`；需要可中断用 `for...of` 或普通 for。

### 10) Webpack vs Vite

- Dev 模式：
    - Webpack 以“打包”为中心（bundle 后再服务），项目大时冷启动/热更新可能更慢。
    - Vite 以“原生 ESM + 按需编译”为中心（依赖预构建 + 按需加载），冷启动和 HMR 通常更快。
- Build：
    - Webpack 自己产物；Vite build 通常用 Rollup 做生产打包。
- 生态：Webpack loader/plugin 体系成熟；Vite 插件偏 Rollup 生态，配置更轻。

### 11) Pinia 多模块 Store 的常见组织方式

- 一个模块一个 `defineStore`：按领域拆分（user、cart、settings），各自文件导出 `useXxxStore`。
- 组合式写法（推荐）：store 内用 `ref/computed/actions`，跨 store 通过 `const user = useUserStore()` 组合，不要搞“巨石 store”。
- 目录结构示例：
    - `src/stores/user.ts`
    - `src/stores/cart.ts`
    - `src/stores/index.ts` 统一 re-export
- 初始化：入口 `app.use(createPinia())`。

### 12) HTTPS vs HTTP

- 安全：HTTPS = HTTP + TLS，加密传输、防窃听/篡改，支持证书校验（服务器身份）。
- 性能：TLS 有握手开销，但 HTTP/2/HTTP/3 往往只在 HTTPS 下可用，实际性能常更好。
- 能力：Service Worker、一些 Web API 更偏向要求 HTTPS（或 localhost 例外）。

### 13) Next.js vs React

- 定位：React 是 UI 库（负责组件/状态/渲染）；Next.js 是基于 React 的全栈框架（规定工程结构与渲染/路由/构建范式）。
- 路由与约定：React 本身不带路由；Next.js 提供文件路由（App Router/Pages Router）、布局与数据加载约定。
- 渲染能力：React 主要是客户端渲染能力；Next.js 提供 SSR/SSG/ISR、Streaming、（App Router 下）Server Components/Server Actions 等服务端能力。
- 全栈能力：Next.js 内置 API Routes（或 Route Handlers）、中间件、缓存与部署集成；React 本身不提供后端能力。
- 性能与工程化：Next.js 集成打包/分包、图片优化、预取、运行时与缓存策略；React 项目通常需要自行选型（Vite/Webpack、路由、SSR 框架等）。



## 做题

1. 半径为 50px，并且边宽为 1 px 黑边的圆
2. [Promise 输出题](./output.js)
3. 实现一个 sleep 函数，可以达到以下功能
```js
function main() {
    console.log(1)
    await sleep(1000) // 单位为 ms
    console.log(2)
}
```

## 做题参考解

### 1) 圆（radius=50px，border=1px 黑色）

```html
<div class="circle"></div>
```

```css
.circle {
    width: 100px;
    height: 100px;
    border: 1px solid #000;
    border-radius: 50%;
}
```

### 2) Promise 输出题

- 结论：`1 2 5 3 4`
- 原因：
    - 同步：先打印 `1`，Promise executor 同步执行：先 `resolve()` 再打印 `2`，然后打印 `5`。
    - 微任务：`then(() => console.log(3))` 属于 microtask，在本轮同步结束后执行。
    - 宏任务：`setTimeout(..., 0)` 属于 macrotask，在微任务清空后执行。

### 3) sleep(ms)

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
    console.log(1)
    await sleep(1000)
    console.log(2)
}
```