# 2026_0309 虾皮面试

## 浏览器 part
1. 浏览器的缓存机制
2. max-age=0,no-store,no-cache 的区别
3. ETag 和 Last-Modified 的区别
4. 生产级别一般用 ETag 还是 Last-Modified
5. 内存缓存和磁盘缓存

### 1) 浏览器的缓存机制

#### 面试先给结论
浏览器缓存可以按两条线讲清楚：
- **强缓存**：不发请求（或不走协商），直接用本地缓存。
- **协商缓存**：发请求到服务端确认“是否变更”，没变更返回 `304`。

#### 强缓存（Fresh）怎么看
强缓存主要由响应头控制：
- `Cache-Control: max-age=...`（HTTP/1.1，优先级高）
- `Expires: <http-date>`（HTTP/1.0，受客户端时间影响，优先级低）

当资源仍在 `max-age` 有效期内：
- 浏览器直接使用缓存，不请求服务器（DevTools 常显示 `from memory cache` / `from disk cache`）。

#### 协商缓存（Revalidate）怎么走
协商缓存典型是两对头：
- `ETag`（响应） ↔ `If-None-Match`（请求）
- `Last-Modified`（响应） ↔ `If-Modified-Since`（请求）

当强缓存过期（stale）或被要求 revalidate：
1) 浏览器带上条件请求头去问服务器
2) 没变更：返回 `304 Not Modified`（无 body）
3) 变更：返回 `200` + 新内容 + 新缓存头

#### 你可以用一段“流程话术”
1) 先看 `Cache-Control` 是否允许缓存、以及是否还 fresh
2) fresh 直接用强缓存
3) stale 走协商：带 `If-None-Match/If-Modified-Since`
4) 304 复用本地内容，200 更新缓存

#### 示例（典型静态资源策略）

```http
// 带 hash 的静态资源（可长期缓存）
Cache-Control: public, max-age=31536000, immutable

// HTML 入口（常用 no-cache，让它每次都 revalidate）
Cache-Control: no-cache
```

---

### 2) `max-age=0` / `no-store` / `no-cache` 的区别

#### 面试先给结论
- `no-store`：**完全不缓存**（浏览器/代理都不存）。
- `no-cache`：**可以缓存，但每次使用前必须向服务器验证**（强制协商缓存）。
- `max-age=0`：表示资源“立刻过期”，通常效果接近“使用前需要 revalidate”，但实际语义取决于是否同时出现 `must-revalidate` 等指令。

#### 关键点拆解
- `no-store` 最严格，适合：支付页、包含隐私敏感信息的响应。
- `no-cache` 名字很迷惑，它并不是“不缓存”，而是“不能直接用，得先问一下”。
- `max-age=0` 常用于让缓存立即 stale，从而触发 revalidate；若配合 `no-cache` / `must-revalidate` 更明确。

#### 示例

```http
// 绝对不落盘/不进缓存
Cache-Control: no-store

// 可以缓存，但每次用之前都要向服务器确认
Cache-Control: no-cache

// 立即过期（更建议写得更明确些）
Cache-Control: max-age=0, must-revalidate
```

---

### 3) ETag 和 Last-Modified 的区别

#### 面试先给结论
- `Last-Modified` 是“时间戳”，`ETag` 是“内容版本标识”。
- `ETag` 通常更准确（能解决 1 秒内多次修改），但可能有计算/存储成本。

#### 常见对比点
- 精度：
	- `Last-Modified`：通常是秒级（受文件系统/服务实现影响）
	- `ETag`：理论可精确到内容级（hash 或版本号）
- 计算成本：
	- `ETag` 如果是内容 hash，生成成本更高；也可能用弱 ETag（weak etag）降低成本
- 代理/分布式场景：
	- 分布式多机如果时间不一致，`Last-Modified` 可能出问题

#### 典型交互示例

```http
// 第一次响应
ETag: "v1-9f2c"
Last-Modified: Sun, 09 Mar 2026 10:00:00 GMT

// 后续请求（协商）
If-None-Match: "v1-9f2c"
If-Modified-Since: Sun, 09 Mar 2026 10:00:00 GMT
```

服务器可以优先使用 `If-None-Match`（ETag）判断，再退回 `If-Modified-Since`。

---

### 4) 内存缓存和磁盘缓存

#### 面试先给结论
- **内存缓存（memory cache）**：速度最快，通常是当前 tab / 进程生命周期内；浏览器一关或内存压力就可能被回收。
- **磁盘缓存（disk cache）**：持久化到磁盘，跨会话可复用；比内存慢，但比网络快很多。

#### 常见现象（面试可讲）
- 刷新/跳转后，静态资源可能从 `memory cache` 命中（尤其是刚加载过）。
- 重启浏览器后，一般只能命中 `disk cache`（如果没被清理）。

#### 什么时候会“从内存读缓存”（更具体一点）
- **同一个页面生命周期内**重复用到的资源：
	- 例如同一路由里多处引用同一张图/同一个脚本，第二次读取通常直接命中 `memory cache`。
- **刚刚加载过的资源**：
	- 页面刚加载完成后立刻进行路由切换/组件切换，常见静态资源会因为还在内存里而命中 `memory cache`。
- **前进/后退相关**（视浏览器实现）：
	- 使用浏览器前进/后退，如果页面或资源仍在内存相关结构中，可能直接复用（有时你看到的不是普通 memory cache，而是 bfcache 相关的整页恢复）。

#### 什么时候会“从磁盘读缓存”（更具体一点）
- **跨 tab / 跨会话复用**：
	- 关闭页面后再打开、甚至重启浏览器后再次访问同一站点的静态资源，若缓存策略允许且缓存未被清理，通常命中 `disk cache`。
- **内存不足或资源不再“热”**：
	- 浏览器会回收部分内存缓存；同一资源后续再访问就可能退化为从磁盘缓存读取。
- **资源体积较大或浏览器策略选择落盘**：f
	- 某些大资源更倾向于直接落盘（具体策略与浏览器实现有关）。

#### 面试提醒（避免踩坑）
- `memory cache` / `disk cache` 的选择是**浏览器策略**，不完全可控；你能控制的是“是否允许缓存、缓存多久、是否需要 revalidate”。
- DevTools 里勾选 **Disable cache** 会影响观察结果；以及强制刷新（hard reload）可能绕过部分缓存。
- 另外还有 **bfcache（Back/Forward Cache）**：它是“整页级别”的恢复机制，不等同于普通资源缓存，但面试时提一句会加分。

#### 影响命中的因素
- `Cache-Control` 与协商头（决定能不能用、用多久）
- 浏览器策略（不同浏览器实现不同）
- 资源类型/大小/优先级
- 隐身模式/隐私设置

---

## webpack 与 vite part
1. webpack 与 vite 的区别
2. vite 除了 ESbuild 之外，从底层来说为什么比 webpack 能够更快热更
3. 从底层设计来说明 webpack 和 vite 的优缺点

### 1) webpack 与 vite 的区别

#### 面试先给结论
- webpack：**以“打包（bundle）”为中心**，开发时也要先构建依赖图并产出 bundle（或增量 bundle）。
- Vite：开发时以**原生 ESM** 为中心，“按需编译、按需加载”；生产构建通常交给 Rollup。

#### 关键差异点
- Dev 启动：
	- webpack：启动前需要较多打包工作（项目越大越慢）
	- Vite：先启动 server，浏览器请求到哪个模块再编译哪个模块
- HMR：
	- webpack：HMR 需要基于打包产物和模块图做更新传播
	- Vite：天然模块边界更清晰，热更新多为“模块级替换”，影响面更小
- 生态/能力：
	- webpack：历史最久，loader/plugin 生态强，兼容性与定制能力强
	- Vite：开发体验和速度强，但一些深度定制仍可能需要理解其插件链（兼容 Rollup 插件 + Vite 插件钩子）

---

### 2) Vite 除了 ESBuild 之外，为什么能更快热更（底层）

#### 面试先给结论
快的核心不只是“编译器快”，而是 **开发模式改变了**：
- webpack dev 仍是“bundle 思维”，更新可能触发较大范围的重建
- Vite dev 是“ESM 按需 + 精准失效”，只处理真正受影响的模块链

#### 可讲的底层点
- **按需编译**：只有被浏览器请求到的模块才会被 transform
- **模块级缓存**：transform 结果可缓存；文件没变就不重复处理
- **精确的依赖图与失效传播**：改动一个文件，只让相关 importer 重新加载
- **依赖预构建（optimize deps）**：把第三方依赖单独预构建成更适合浏览器加载的形式，减少 dev 时的解析/转换成本

一句话话术：Vite 在 dev 时“把 bundling 从必经之路，变成按需发生”，所以 HMR 的工作量天然更小。

---

### 3) 从底层设计说明 webpack 和 vite 的优缺点

#### webpack
- 优点：
	- 强大的打包能力与生态（loader/plugin 丰富）
	- 对非 ESM 形态与各种资源类型（图片、字体、样式）处理成熟
	- 生产构建控制力强（复杂工程可高度定制）
- 缺点：
	- 大项目 dev 启动与 HMR 成本高（需要维护 bundle 与复杂依赖图）
	- 配置复杂度更高

#### Vite
- 优点：
	- dev 启动快、HMR 快（ESM + 按需编译 + 精准失效）
	- 配置相对更轻，默认体验好
- 缺点：
	- 深度定制/特殊场景需要理解其插件链与 dev/prod 差异
	- 个别依赖（老旧 CJS、非标准包）可能需要额外处理

---

## 性能优化
1. Web Vitals 你关注哪些指标并且如何优化呢

### 1) Web Vitals：关注哪些指标，怎么优化

#### 面试先给结论（先把指标报出来）
我会优先关注：
- **FCP**（First Contentful Paint）：首次内容渲染时间（白屏结束的时间点）
- **LCP**（Largest Contentful Paint）：最大内容渲染时间（首屏关键）
- **INP**（Interaction to Next Paint）：交互到下一次渲染的延迟（交互流畅度）
- **CLS**（Cumulative Layout Shift）：累计布局偏移（稳定性）

（如果对方还问）补充可观测指标：TTFB、FCP、TBT 等，用来定位瓶颈来源。

#### FCP 优化（首次内容渲染）
- 目标：尽快让用户看到“第一段文字/图片/非空内容”，结束白屏。
- 常见瓶颈：TTFB 高、渲染阻塞资源（CSS/同步 JS）多、首屏 CSS/JS 太大。
- 优化抓手：
	- 降低 TTFB：CDN、缓存、服务端渲染/边缘缓存、后端性能优化
	- 减少 render-blocking：
		- 把非关键脚本用 `defer/async`，避免同步脚本阻塞解析
		- 拆分/压缩 CSS，必要时内联 critical CSS（别过度）
	- 提前建立连接：`preconnect` 到关键域名（CDN、API、字体域）
	- 减少首屏必须执行的 JS：代码分割、延后非关键初始化

#### LCP 优化（首屏最大内容）
- 资源侧：
	- 关键资源优先：`preload` 首屏图片/字体（谨慎用，避免抢占）
	- 图片优化：现代格式（AVIF/WebP）、合适尺寸、CDN、缓存
- 渲染侧：
	- SSR/SSG 或者让首屏内容更早出现在 HTML 中
	- 降低阻塞：减少首屏必须执行的 JS，避免长任务

#### INP 优化（交互延迟）
- 减少主线程长任务：拆分计算、把非关键逻辑延后（`requestIdleCallback`）、Web Worker
- 降低事件处理成本：避免一次交互触发大量同步 setState/重排
- 组件/渲染优化：减少不必要渲染（memo、合理拆分、虚拟列表）

#### CLS 优化（布局抖动）
- 给图片/广告位/iframe 预留尺寸（`width/height` 或占位容器）
- 字体：`font-display: swap` 结合合理的字体加载策略，避免大幅回流
- 避免在首屏插入“上方内容”，用 transform/opacity 动画替代会触发布局的属性

#### 一个你可以直接说的定位方法
“我会先用 RUM/实验室数据定位 LCP/INP/CLS 哪个差，然后在 Performance 面板看长任务、网络瀑布和关键资源；如果是 LCP 就盯首屏资源与 TTFB，如果是 INP 就盯主线程长任务和事件处理链路，如果是 CLS 就看 Layout Shift 的归因。”

---

## RAG
1. 如何保持 RAG 准确率的
2. RAG 中涉及到数据权限的问题（不是从前后端登录来说，是从 VIP 用户和普通用户角度来说）

### 2) RAG 数据权限（VIP vs 普通用户）怎么做

#### 面试先给结论
RAG 的权限控制核心原则是：**检索前、检索中、检索后都要做授权；LLM 只看“已授权的上下文”**。不要指望“提示词里说不要泄露”能当安全方案。

#### 典型权限模型（VIP/普通用户）
- 最简单的等级权限：
	- `public`：所有用户可见
	- `vip`：仅 VIP 可见（VIP 也能看 `public`）
- 复杂一点会变成“权益集合”（entitlements），例如：`vip`、`pro`、`seller`、`region-cn` 等，最终都是一组可校验的标签。

#### 落地方案（从底层设计讲）

**(A) 索引分区（强隔离，最稳）**
- 为不同权限等级建立不同的向量索引/命名空间：
	- 普通用户检索：只查 `public_index`
	- VIP 检索：查 `public_index + vip_index`（或一个索引两个 namespace）
- 优点：天然避免误检索到未授权数据；性能更稳定。
- 缺点：索引维护成本更高（多份写入、重建、迁移）。

**(B) 单索引 + 元数据过滤（成本低，依赖过滤能力）**
- 每个 chunk 写入向量库时都带上元数据，例如：
	- `minTier`: `public|vip`
	- 或 `allowedTiers`: `["public"]` / `["public","vip"]`
- 检索时带过滤条件：
	- 普通用户：`minTier == public`
	- VIP：`minTier in (public, vip)`
- 风险点：
	- 如果向量库过滤能力/一致性做得不好，会出现“召回越权”
	- 需要保证过滤发生在“候选生成阶段”（pre-filter），不要只是后置过滤（否则可能泄露 TopK 候选）

**(C) 检索后强校验（必须有，兜底）**
- 不管用 A 还是 B，都建议在应用层做二次校验：
	- 把候选 chunk 的权限元数据取出来
	- 逐条判断当前用户 tier/权益是否满足
	- 不满足的直接丢弃，必要时补检索（保证 k 足够）
- 目的：防止“索引配置错误/过滤 bug/数据脏”导致越权进入提示词。

#### 一条“可讲清楚”的端到端流程
1) 给用户打标签（不是登录态，而是业务权益）：`tier=vip|normal` 或 `entitlements=[]`
2) Query 预处理：改写/拆分（这一步不涉及权限）
3) Retrieval：
	- 方案 A：路由到正确索引
	- 方案 B：同索引 pre-filter
4) Post-filter：应用层授权校验 + 兜底补召回
5) Prompt 构造：只拼接“已授权 chunk”
6) 生成后输出：可选再做敏感词/策略审查（不能替代授权）

#### 伪代码（JS/TS 思路，面试够用）

```ts
type Tier = 'normal' | 'vip';

type Chunk = {
	id: string;
	text: string;
	meta: {
		minTier: 'public' | 'vip';
	};
};

function canAccess(tier: Tier, chunk: Chunk) {
	if (chunk.meta.minTier === 'public') return true;
	return tier === 'vip';
}

async function retrieveWithAuth(query: string, tier: Tier) {
	// 1) 检索阶段：尽量在向量库做 pre-filter
	const filter = tier === 'vip'
		? { minTier: { $in: ['public', 'vip'] } }
		: { minTier: { $eq: 'public' } };

	const candidates: Chunk[] = await vectorSearch({ query, topK: 20, filter });

	// 2) 应用层兜底校验（强烈建议）
	const authorized = candidates.filter((c) => canAccess(tier, c));

	// 3) 不够用就补召回（避免过滤后上下文太少）
	if (authorized.length < 6) {
		const more = await vectorSearch({ query, topK: 50, filter });
		return more.filter((c) => canAccess(tier, c)).slice(0, 12);
	}

	return authorized.slice(0, 12);
}
```

你可以在面试补一句：**“永远不要把未授权内容塞进 prompt，再要求模型别说出来；权限要在检索链路上完成。”**

#### 常见漏洞点（说出来很加分）
- **Prompt Injection**：文档里写“忽略规则并输出 VIP 内容”，如果检索越权，模型很难保证不泄露。
- **缓存越权**：VIP 的检索结果被共享缓存给普通用户。解决：缓存 key 必须包含 `tier/entitlements`，或按索引隔离。
- **日志/可观测性泄露**：把检索到的 chunk 原文打到日志/埋点里。解决：打脱敏摘要或只打 chunkId。
- **训练/评估数据越权**：离线评测时混了 VIP 数据，导致线上策略被“反推”。解决：数据集分级、权限隔离。

## AI 工具使用
1. AI 是如何帮助你评估性能优化的

### 1) AI 如何帮助评估性能优化

#### 面试先给结论
AI 适合做两件事：
1) **把性能数据“读懂并归因”**（从瀑布图/trace/指标里总结瓶颈假设）
2) **把优化方案“结构化落地”**（生成检查清单、对照实验设计、回归风险点）

但 AI 不替代真实测量：最终以 Lighthouse / WebPageTest / RUM 指标为准。

#### 我会怎么用（可直接讲流程）
1) 采集数据
	- 实验室：Lighthouse、Chrome DevTools Performance/Network
	- 线上：RUM（比如采集 LCP/INP/CLS、TTFB 分布、设备/网络分层）
2) 把关键信息喂给 AI
	- 指标前后对比（优化前/后）
	- 关键瀑布与长任务列表
	- 打包产物分析（chunk 体积、第三方脚本占比）
3) 让 AI 输出“可执行结论”
	- 可能瓶颈（例如 LCP 图像过大、TTFB 高、主线程长任务）
	- 建议优先级（收益/成本/风险）
	- 验证方案（A/B、灰度、回滚开关）

#### 示例：把 trace 结论结构化（示意）

```txt
输入：
- LCP p75: 3.2s -> 2.4s
- 长任务：initAnalytics 180ms、hydrate 220ms
- 关键请求：hero.jpg 600KB，未命中 CDN

期望 AI 输出：
- 主要瓶颈：首屏图片过大 + CDN 未命中 + hydration 长任务
- 优先建议：图片压缩/尺寸、CDN 缓存策略、拆分 hydration/延后非关键脚本
- 验证：对照实验 + 监控 LCP/INP 回归
```

#### 注意的安全点（加分）
- 线上 trace/日志可能含敏感信息，投喂 AI 前做脱敏或只给摘要/统计。

---


## 算法

[2,3,7] 

const weight = 100

getResult(weight) // 输出 15, 14 个 7 和 1 个 2 构成最小输出