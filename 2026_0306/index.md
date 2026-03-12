## 搜狐面试遇到的八股

1. forEach 跳出循环
2. flex 的三个参数
3. JS 数组去重
4. JS 数组扁平化
5. Pinia 数据存储层
6. 首屏渲染的手段
7. Promise.all 失败返回的结果
8. let/const/var 的区别
9. CDN 的优缺点

---

## 1) forEach 跳出循环

### 结论
- `forEach` 里**不能**用 `break/continue` 跳出；`return` 只能结束当前回调，**不会**结束外层循环。
- 要“可中断”，用 `for...of` / 普通 `for`；或者用 `some/every/find` 这类**可提前结束**的数组方法。

### 代码

#### 1.1 `forEach` 里 `return` 不会中断

```js
const arr = [1, 2, 3, 4];

arr.forEach((x) => {
	if (x === 3) return; // 只结束这一次回调
	console.log('forEach:', x);
});

// 输出：1,2,4（并没有在 3 处“跳出循环”）
```

#### 1.2 用 `for...of` + `break` 真正跳出

```js
const arr = [1, 2, 3, 4];

for (const x of arr) {
	if (x === 3) break;
	console.log('for...of:', x);
}

// 输出：1,2（到 3 时直接结束循环）
```

#### 1.3 用 `some` / `every` 提前结束（函数式写法）

```js
const arr = [1, 2, 3, 4];

arr.some((x) => {
	console.log('some:', x);
	return x === 3; // 返回 true => 停止遍历
});
```

---

## 2) flex 的三个参数

### 结论
`flex` 是简写：

$$flex = flex\text{-}grow\ \ flex\text{-}shrink\ \ flex\text{-}basis$$

- `flex-grow`：有剩余空间时，按比例“长大”
- `flex-shrink`：空间不足时，按比例“缩小”
- `flex-basis`：分配空间前的“基准尺寸”（类似初始宽度/高度，主轴方向）

### 代码 + 解释

```html
<style>
	.row { display: flex; width: 600px; border: 1px solid #ccc; }
	.a { flex: 1 1 200px; background: #f5f5f5; }
	.b { flex: 2 1 200px; background: #e9e9e9; }
</style>

<div class="row">
	<div class="a">A</div>
	<div class="b">B</div>
</div>
```

- 两个 item 的 `basis` 都是 `200px`，总基准 400px，小于容器 600px，有 200px 剩余。
- `grow` 比例是 1:2，所以多出来的 200px 会按 1/3 与 2/3 分给 A/B。

### 常见速记
- `flex: 1` 等价于 `flex: 1 1 0%`（不同浏览器/规范实现细节有差异，但面试常按这个理解）
- `flex: auto` 等价于 `flex: 1 1 auto`
- `flex: none` 等价于 `flex: 0 0 auto`

---

## 3) JS 数组去重

### 结论
- 基础类型（number/string/boolean/null/undefined/symbol/bigint）去重：优先 `Set`。
- 对象去重：需要“判等规则”，常用 `Map` 按 `id` 等 key 去重。

### 代码

#### 3.1 `Set`（最常用）

```js
const arr = [1, 1, 2, 3, 3];
const unique = [...new Set(arr)];
console.log(unique); // [1,2,3]
```

解释：`Set` 只保留唯一值，判等规则是 SameValueZero（和 `===` 类似，但 `NaN` 等于 `NaN`）。

#### 3.2 `filter + indexOf`（不推荐大数组）

```js
const arr = [1, 1, 2, 3, 3];
const unique = arr.filter((x, i) => arr.indexOf(x) === i);
```

解释：每个元素都 `indexOf` 一次，时间复杂度接近 $O(n^2)$。

#### 3.3 对象数组按 `id` 去重

```js
const users = [
	{ id: 1, name: 'a' },
	{ id: 1, name: 'a2' },
	{ id: 2, name: 'b' },
];

const map = new Map();
for (const u of users) map.set(u.id, u); // 后写覆盖前写

const unique = [...map.values()];
console.log(unique);
// [{id:1,name:'a2'},{id:2,name:'b'}]
```

---

## 4) JS 数组扁平化

### 结论
- 现代写法：`arr.flat(depth)`，无限层用 `flat(Infinity)`。
- 手写：递归或栈都行。

### 代码

#### 4.1 `flat(Infinity)`

```js
const arr = [1, [2, [3, [4]]]];
console.log(arr.flat(Infinity)); // [1,2,3,4]
```

#### 4.2 递归实现（面试常考）

```js
function flatten(input) {
	const res = [];
	for (const item of input) {
		if (Array.isArray(item)) res.push(...flatten(item));
		else res.push(item);
	}
	return res;
}

console.log(flatten([1, [2, [3]]])); // [1,2,3]
```

解释：遇到数组就递归展开；遇到非数组就直接收集。

#### 4.3 栈实现（避免深递归栈溢出）

```js
function flattenIter(input) {
	const stack = [...input];
	const res = [];

	while (stack.length) {
		const item = stack.pop();
		if (Array.isArray(item)) stack.push(...item);
		else res.push(item);
	}

	return res.reverse();
}
```

---

## 5) Pinia 数据存储层

### 结论（你可以这样回答）
- Pinia 是 Vue 的状态管理方案：把“跨组件共享、需要缓存、需要统一修改入口”的数据放在 store。
- 常见分层：
	- **UI/组件层**：只负责展示与触发 action
	- **Store 层（Pinia）**：state/getters/actions，集中管理业务状态
	- **Service/API 层**：负责请求与数据适配（store 调用 service）

### 代码（典型写法：store 管状态，service 管请求）

#### 5.1 Service 层

```js
// services/userService.js
export async function fetchUser(id) {
	const res = await fetch(`/api/user/${id}`);
	if (!res.ok) throw new Error('fetchUser failed');
	return res.json();
}
```

#### 5.2 Store 层

```js
// stores/user.js
import { defineStore } from 'pinia';
import { fetchUser } from '../services/userService';

export const useUserStore = defineStore('user', {
	state: () => ({
		user: null,
		loading: false,
		error: null,
	}),
	getters: {
		userName: (s) => s.user?.name ?? 'anonymous',
	},
	actions: {
		async loadUser(id) {
			this.loading = true;
			this.error = null;
			try {
				this.user = await fetchUser(id);
			} catch (e) {
				this.error = e;
			} finally {
				this.loading = false;
			}
		},
	},
});
```

#### 5.3 组件层使用

```vue
<script setup>
import { onMounted } from 'vue';
import { useUserStore } from './stores/user';

const store = useUserStore();
onMounted(() => store.loadUser(1));
</script>

<template>
	<div v-if="store.loading">loading...</div>
	<div v-else-if="store.error">{{ String(store.error) }}</div>
	<div v-else>{{ store.userName }}</div>
</template>
```

面试加分点：
- 异步请求状态（loading/error）放 store 便于多个组件共享
- 需要持久化（localStorage）时用插件（如 pinia-plugin-persistedstate），但要注意隐私与过期策略

---

## 6) 首屏渲染的手段

### 结论（从“减少关键路径”回答）
首屏优化核心是：
- **更快拿到可用 HTML/CSS**（更早展示）
- **减少首屏必须执行的 JS**（更少阻塞）
- **让关键资源更快到达**（更短关键链路）

### 常用手段清单
- SSR/SSG（服务端/构建时直接出 HTML，减少白屏）
- 代码分割（路由级、组件级按需加载）
- 关键资源优化：压缩（gzip/br）、HTTP 缓存、CDN、preload 关键字体/首屏图片
- JS 侧：`defer/async`、减少第三方脚本、Tree Shaking、按需 polyfill
- 体验侧：骨架屏/占位（让用户更早看到结构）

### 代码示例：路由/组件级懒加载（减少首屏 JS）

```js
// Vue Router 示例（路由级代码分割）
const routes = [
	{
		path: '/heavy',
		component: () => import('./pages/HeavyPage.vue'),
	},
];
```

解释：首屏不访问 `/heavy` 时，对应 chunk 不会下载与执行，从而降低首屏 JS 体积。

### 代码示例：非关键逻辑延后执行

```js
// 把非关键初始化放到浏览器空闲时间
requestIdleCallback(() => {
	// 统计、非首屏组件初始化等
});
```

---

## 7) Promise.all 失败返回的结果

### 结论
- `Promise.all([...])`：只要有一个 promise **reject**，整体就会立刻 **reject**，reject 的 reason 是**第一个发生 reject 的那个原因**。
- 其他 promise 不会被取消（JS 原生 promise 没有取消机制），只是你拿不到它们的结果了。

### 代码

#### 7.1 任意一个失败：整体失败

```js
const p1 = Promise.resolve(1);
const p2 = Promise.reject(new Error('boom'));
const p3 = new Promise((resolve) => setTimeout(() => resolve(3), 100));

Promise.all([p1, p2, p3])
	.then((res) => console.log('ok', res))
	.catch((err) => console.log('fail', err.message));

// 输出：fail boom
// 注意：p3 仍然会在后台 resolve，只是 Promise.all 已经 reject 了
```

#### 7.2 想“全都返回结果（不因失败中断）”：用 `Promise.allSettled`

```js
const results = await Promise.allSettled([p1, p2, p3]);
console.log(results);
// [{status:'fulfilled', value:1}, {status:'rejected', reason: ...}, {status:'fulfilled', value:3}]
```

#### 7.3 想 `all` 但不失败：把每个 promise 包一层

```js
function safe(p) {
	return p.then(
		(value) => ({ ok: true, value }),
		(error) => ({ ok: false, error })
	);
}

const res = await Promise.all([safe(p1), safe(p2), safe(p3)]);
console.log(res);
```

---

## 8) let / const / var 的区别

### 结论（面试版）
- **作用域**：`var` 是函数作用域；`let/const` 是块级作用域（`{}`）。
- **提升（hoist）**：三者都会“声明提升”，但 `let/const` 有 **TDZ（暂时性死区）**，在声明前访问会直接报错；`var` 会变成 `undefined`。
- **重复声明**：同一作用域内 `var` 允许重复声明；`let/const` 不允许。
- **全局对象属性**：浏览器里全局 `var a` 会挂到 `window.a`；`let/const` 不会。
- **赋值**：`const` 必须初始化且不能重新赋值；但**对象/数组内容仍可变**（只是不允许改“引用”）。

### 代码 + 解释

#### 8.1 块级作用域 vs 函数作用域

```js
function demo() {
	if (true) {
		var x = 1;
		let y = 2;
		const z = 3;
	}

	console.log(x); // 1（var：函数作用域）
	console.log(y); // ReferenceError（let：块级作用域）
	console.log(z); // ReferenceError（const：块级作用域）
}
demo();
```

#### 8.2 提升 + TDZ

```js
console.log(a); // undefined（var 提升后默认值是 undefined）
var a = 10;

console.log(b); // ReferenceError（TDZ：声明前不可访问）
let b = 20;
```

解释：`let/const` 在作用域开始时就已经“被创建”，但在执行到声明语句前都处于 TDZ。

#### 8.3 `const` 不是“深度不可变”

```js
const obj = { count: 0 };
obj.count += 1; // ✅ 可以修改内容

obj = { count: 100 }; // ❌ TypeError：不能给 const 变量重新赋值
```

#### 8.4 循环里闭包经典坑（`var` vs `let`）

```js
for (var i = 0; i < 3; i++) {
	setTimeout(() => console.log('var:', i), 0);
}
// var: 3, 3, 3

for (let j = 0; j < 3; j++) {
	setTimeout(() => console.log('let:', j), 0);
}
// let: 0, 1, 2
```

解释：`let` 在 `for` 循环每次迭代会创建一个新的绑定（更容易写对异步）。

---

## 9) CDN 的优缺点

### 结论
CDN（Content Delivery Network）核心就是：把资源缓存到离用户更近的边缘节点，减少回源与网络 RTT。

### 优点
- **更低延迟**：就近命中边缘节点，首屏静态资源更快到达。
- **更高吞吐/更稳**：源站压力下降，抗突发流量能力更强。
- **更好的可用性**：多节点容灾；部分 CDN 带健康检查、自动切换。
- **安全能力**：常见自带 DDoS 防护、WAF、TLS 终止等（看服务商与套餐）。
- **带宽成本优化**：源站出网带宽减少（但 CDN 自身有费用）。

### 缺点 / 风险
- **缓存一致性难题**：更新发布后可能命中旧缓存，需要版本化/刷新策略。
- **调试复杂**：多层缓存（浏览器/代理/CDN）导致“我改了怎么没生效”。
- **成本与供应商绑定**：按流量/请求计费；迁移、策略配置有成本。
- **动态内容收益有限**：强动态/个性化接口通常不适合缓存（除非做边缘计算/细粒度缓存）。
- **安全与合规**：第三方节点、日志与跨境分发可能涉及合规要求；也要防止缓存投毒等风险。

### 代码/配置思路：解决“更新不生效”（最常用）

#### 9.1 资源版本化（推荐）

```html
<!-- 文件名带 hash，每次构建变更都会产生新文件名 -->
<script src="/assets/app.3f2c1a.js"></script>
<link rel="stylesheet" href="/assets/app.91ab0c.css" />
```

解释：CDN 可以大胆缓存很久（长 TTL），因为文件名变了就是新资源。

#### 9.2 配合缓存头（让 CDN/浏览器正确缓存）

```http
// 对“带 hash 的静态资源”（可长期缓存）
Cache-Control: public, max-age=31536000, immutable

// 对 HTML（入口文件，尽量不要缓存或短缓存）
Cache-Control: no-cache
```

解释：HTML 一旦缓存旧版本会导致加载到旧的资源清单；而带 hash 的静态资源适合长缓存。

#### 9.3 加分点：第三方资源用 SRI 防篡改

```html
<script
	src="https://cdn.example.com/lib.min.js"
	integrity="sha384-BASE64_HASH"
	crossorigin="anonymous"
></script>
```

解释：浏览器会校验内容 hash，不匹配就拒绝执行，降低 CDN/链路被篡改的风险。