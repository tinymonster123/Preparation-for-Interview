## 一. 每日八股大学习

1. **从输入URL到页面渲染发生了什么？** 掌握程度：[ Done ]
   面试官问这个问题，一般是想考察我对浏览器整体工作流程的理解。我会按照顺序来回答：
   * **第一步：网络请求阶段**。浏览器会先做 DNS 解析，把域名解析为 IP，然后建立 TCP 三次握手，再通过 HTTP/HTTPS 发起请求。
   * **第二步：服务端返回响应**。通常返回 HTML 文档，文档中如果引用了其他静态资源（CSS/JS/图片），浏览器会继续发请求。
   * **第三步：解析和构建阶段**。浏览器一边解析 HTML 生成 DOM，一边解析 CSS 生成 CSSOM，两者结合生成 Render Tree。如果 JS 脚本没有加 `defer/async`，它会阻塞 DOM 构建。
   * **第四步：渲染阶段**。浏览器计算布局（Reflow）、绘制（Paint）、然后合成（Composite）最终呈现在屏幕上。
     如果有追问，我会再强调一点：实际项目中我们会利用 **缓存、CDN、懒加载** 来优化加载和渲染速度。
   
2. **什么情况下会引起重排（Reflow）？** 掌握程度：[ Done ]
   这个问题主要考察对浏览器渲染性能的理解。我的回答思路是：

   * 当涉及 **元素尺寸、位置、结构发生变化** 时，会触发重排。例如修改宽高、margin、padding、隐藏显示（`display: none`）。
   * DOM 节点的增删、内容变化（文字大小）也会触发。
   * 另外一种情况是 **强制读取布局信息**，比如访问 `offsetTop`、`getComputedStyle`，浏览器必须先计算最新的布局再返回结果。
     在实际开发中，我们会通过 **合并多次操作、使用 transform/opacity 替代位置和尺寸变化** 来减少 Reflow。

3. **CSS中的几种定位（position）有什么区别？** 掌握程度：[ Done ]
   我会先逐一解释：

   * `static`：默认定位，不受 top/left 影响。
   * `relative`：相对自身原始位置偏移，但仍占据文档流。
   * `absolute`：相对最近的非 static 祖先定位，脱离文档流。
   * `fixed`：相对视口定位，不随页面滚动。
   * `sticky`：结合 relative 和 fixed，滚动到一定位置后“粘住”。
     实际应用中，`absolute` 和 `fixed` 常用于浮层、弹窗，`sticky` 常用于导航栏吸顶。

4. **了解CDN吗？如何更新CDN中的内容？** 掌握程度：[ Done ]
   我理解 CDN 是一种分布式缓存加速方案，可以把静态资源分发到离用户最近的节点，提高加载速度。
   * **更新方式**主要有两种：
   
     1. 在前端构建时为文件加上 **hash 值**，一旦文件改动就会生成新 URL，自动绕过缓存。
     2. 通过 CDN 服务商的 **缓存刷新 API** 主动清理旧文件。
        在项目中，我一般推荐第一种方式，自动化程度更高。
   
5. **项目中如何实现登录？登录状态是如何保存的？** 掌握程度：[ ]
   登录实现架构：

   这个项目采用了 NextAuth.js v5（Beta版）作为核心认证框架，结合 PostgreSQL 数据库和 JWT 策略来实现登录功能。

   * **认证配置**：
     核心技术栈：
     - NextAuth.js v5 作为认证框架
     - PostgreSQL 数据库适配器 @auth/pg-adapter
     - bcryptjs 用于密码哈希验证
     - Zod 进行表单验证

     支持的登录方式：
     1. 凭据登录：邮箱+密码
     2. OAuth 登录：GitHub 第三方登录

   * **登录状态保存机制**：
     会话策略：
     ```javascript
     session: {
       strategy: "jwt",           // 使用 JWT 令牌策略
       maxAge: 30 * 24 * 60 * 60, // 30 天过期时间
     }
     ```

     状态保存层级：
     1. **JWT 令牌层**：
        - 用户 ID、邮箱存储在 JWT 中
        - OAuth 的 access_token 也会保存
        - 令牌通过 HttpOnly Cookie 自动管理
     2. **会话层**：
        - 从 Cookie 中提取 sessionToken
        - 将用户信息注入到 session 对象
        - 支持多环境的安全 Cookie 配置
     3. **数据库层**：
        - 使用 PostgreSQL 存储用户账户信息
        - 支持 OAuth 账户关联

   * **客户端状态管理**：
     组件层面的状态处理：
     ```javascript
     // SessionProvider 包装（homepage/page.tsx:42-46）
     <SessionProvider>
       <AuthTopBar />
     </SessionProvider>

     // Hook 使用（sessionTopBar/index.tsx:7）
     const { data: session } = useSession();

     // 条件渲染逻辑：
     // 根据认证状态显示不同导航栏
     const isAuthenticated = status === "authenticated";
     return isAuthenticated ? <SessionTopBar /> : <TopBar />;
     ```

   * **登录流程实现**：
     前端验证 → 后端认证 → 状态更新

     1. **表单验证**（login-form.tsx:34-49）：
        - 使用 Zod schema 进行客户端验证
        - 实时错误提示
     2. **认证请求**（login-form.tsx:52-56）：
        - 提交表单数据到后端进行认证
     3. **状态同步**（login-form.tsx:67-68）：
        - 登录成功后，前端路由跳转到首页并刷新状态

   * **安全性考虑**：
     密码安全：
     - bcryptjs 哈希存储（auth.ts:70）
     - 数据库查询参数化防 SQL 注入

     会话安全：
     - CSRF 保护（NextAuth 内置）
     - 安全 Cookie 配置
     - 生产环境 SSL 强制

     令牌管理：
     - HttpOnly Cookie 防 XSS
     - 自动令牌刷新
     - 可配置的过期时间

   * **用户体验优化**：
     - 加载状态：登录按钮 disabled 状态
     - 错误处理：详细的错误消息显示
     - 重定向：登录后自动跳转
     - 持久化：30 天免登录

     这种架构的优势是：安全性高、开发效率高、可扩展性强，既支持传统的用户名密码登录，也支持现代的 OAuth 社交登录，是现代 Web应用的最佳实践。
   
6. **Token 和（本地）存储（Storage）有什么区别？** 掌握程度：[ Done ]

   * **Token**：是一种身份凭证，用来标识用户身份，通常由后端签发。
   * **Storage**：是浏览器的存储机制，比如 LocalStorage、SessionStorage。
     关系就是：**Token 可以被存储在 Storage 或 Cookie 里**，但本质上两者不是一个维度的东西。

7. **如何实现单点登录（同一账号后登录的设备会踢出先登录的）？** 掌握程度：[ ]
   我会解释为：

   * 服务端在数据库记录当前账号的有效 Token。
   * 当新的设备登录时，旧的 Token 标记为无效。
   * 旧设备再发起请求时，发现 Token 已失效，就会被强制退出。
     在一些系统里，还会加上 WebSocket 通知，实现实时下线提示。

8. **什么是 OPTIONS 预检请求？** 掌握程度：[ Done ]
   这是跨域请求里经常出现的：

   * 当浏览器要发一个复杂请求（比如 Content-Type 是 application/json，或者有自定义 header），它会先发一个 **OPTIONS 请求**，确认服务端是否允许跨域。
   * 只有服务端返回正确的 CORS 头部，浏览器才会发真正的请求。
     在面试时我会补充：预检请求是浏览器自动完成的，前端无法跳过。

9. **如何实现跨域？** 掌握程度：[ ]
   我会先说最常见的方案：

   * **CORS**：服务端设置 `Access-Control-Allow-Origin`。
   * **JSONP**：只支持 GET，请求时通过 script 标签。
   * **反向代理**：比如 Nginx 把请求转发到目标服务器。
   * 其他方式还有 `postMessage`、WebSocket。
     在项目里，CORS + 反向代理是最常用的组合。

10. **前端常见的网络攻击有哪些？如何防御？** 掌握程度：[ ]
    我会分两类重点说明：

    * **XSS（跨站脚本攻击）**：攻击者注入恶意脚本。防御方式：对输入输出进行转义、使用 CSP、禁止 innerHTML 拼接。
    * **CSRF（跨站请求伪造）**：利用用户已登录的身份发起请求。防御方式：CSRF Token、SameSite Cookie、Referer 校验。
      这样回答能让面试官感受到我不仅知道概念，还清楚应对手段。

11. **Flex布局和Grid布局有什么区别？Flex弹性布局的实现原理是什么？** 掌握程度：[ Done ]
    我会从定位出发来回答：

* Flex 是 **一维布局**，更适合处理行或列方向的分布问题；Grid 是 **二维布局**，能同时处理行和列。
* Flex 的核心原理是：父容器把可用空间按一定规则（`flex-grow / flex-shrink / flex-basis`）分配给子元素，这样子元素可以根据空间大小自动伸缩。
* 实际开发中，我会选择 Flex 来做导航栏、按钮组，而 Grid 更适合做复杂的后台管理页面布局。

12. **如何实现并发请求？Promise.all 的实现原理是什么？** 掌握程度：[ Done ]
    我一般会这样回答：

* 在前端，常见的并发请求方式就是直接发多个 Ajax/fetch，然后用 `Promise.all` 来等待结果。
* `Promise.all` 的原理比较简单：它接收一个 Promise 数组，只有当所有 Promise 都 resolve 时才会返回结果，如果有一个 reject，就会立即返回错误。
* 如果面试官追问，我会提到 `Promise.allSettled` 可以避免单个失败导致整体失败，更适合一些不强依赖的场景。

13. **async/await 和 Promise 有什么区别？了解它和 Generator 的关系吗？** 掌握程度：[ ]
    我会先讲差异：

* `Promise` 是回调链式调用，代码会有一定嵌套。
* `async/await` 是语法糖，基于 Promise 实现，写起来更像同步代码，逻辑更清晰。
* 它和 Generator 有点像，Generator 也是通过 `yield` 来暂停函数执行，但需要手动调用 `next()`；而 async/await 内部帮我们做了自动迭代，开发体验更好。

14. **是否实现过动画效果？（引申到性能优化）** 掌握程度：[ ]
    我会这样组织：

* 在前端常用的动画方式有两类：CSS 动画（transition、animation）和 JS 动画（requestAnimationFrame）。
* 对性能优化，我会特别强调：**尽量避免频繁触发重排**，像 `transform` 和 `opacity` 是推荐属性，因为它们只会触发合成层，不会影响布局。
* 在项目中实现过的例子，比如页面切换的过渡动画、骨架屏加载动画。

15. **描述一下 React 的生命周期。** 掌握程度：[ ]
    如果是类组件，我会这样描述：

* **挂载阶段**：constructor → render → componentDidMount
* **更新阶段**：shouldComponentUpdate → render → componentDidUpdate
* **卸载阶段**：componentWillUnmount
  在函数组件里，生命周期通过 Hooks 来体现，比如 `useEffect` 可以模拟挂载/卸载。
  面试中我还会加一句：新版本更推荐用 Hooks，因为逻辑更容易拆分复用。

16. **描述一下 Redux 的数据流。** 掌握程度：[ ]
    Redux 是一个单向数据流模型：

* View 通过 dispatch 发出 Action；
* Reducer 根据 Action 计算出新的 state；
* Store 更新状态；
* 组件通过订阅获取新状态。
  我会补充说：单向数据流的好处是状态可预测、方便调试和回溯。

17. **React 后续版本（相对于旧版）做了哪些重要优化或更新？** 掌握程度：[ ]
    我会从两个核心点回答：

* **Fiber 架构**：支持任务可中断，解决旧版本渲染一旦开始就无法打断的问题，提高了流畅度。
* **Hooks**：用函数式方式管理状态和副作用，避免了 class 组件生命周期过于复杂的问题。
  如果有时间，我会再补充 Concurrent Mode 和 Suspense。

18. **useMemo 的作用是什么？** 掌握程度：[ Done ]

变化时才会重新计算，避免重复执行开销大的逻辑。
* 常见场景：列表数据的复杂计算、函数的稳定引用。
* 类似于 Vue 的 computed 属性。

19. **Git 常用命令有哪些？rebase 和 merge，stash，cherry-pick 的作用和区别是什么？** 掌握程度：[ Done ]
    我会这样答：

* **merge**：合并分支，保留所有历史。
* **rebase**：把当前分支提交“搬到”另一分支，历史更干净，但需要小心冲突。
* **stash**：临时保存未提交改动，用于切换分支时不想丢失进度。
* **cherry-pick**：挑选某个提交应用到当前分支，常用于补丁修复。
* 在团队协作中，merge 更安全，rebase 更优雅。

20. **Webpack 和 Vite 有什么区别？Vite 为什么快？HMR 原理？** 掌握程度：[ ]
    我会回答：

* Webpack 是打包为主，基于 bundle 思路，开发时构建速度比较慢。
* Vite 基于 ESBuild + 原生 ESM，开发时不需要整体打包，启动快很多。
* HMR（热更新）的原理是：只替换修改过的模块，利用 WebSocket 通知浏览器刷新对应模块，而不是整个页面刷新。

21. **长列表性能优化（虚拟列表）** 掌握程度：[ ]
    我会分场景说明：

* **定高场景**：可以直接用容器高度 / 单项高度来计算应该渲染哪些元素，简单高效。
* **不定高场景**：需要用预估高度，实际渲染时再动态调整高度。
* 如果出现滚动条抖动问题，可以用占位符缓冲区，或者异步修正高度。
  面试时我还会提：虚拟列表本质上是减少实际渲染节点数。

22. **除了长列表，还做过哪些性能优化或亮点？** 掌握程度：[ ]
    我会结合常见点来回答：

* 撤销/重做功能：用操作栈记录变化，而不是每次都保存全量数据，可以大大减少内存消耗。
* 代码分割、懒加载、图片懒加载、缓存优化（localStorage/IndexedDB）。
  这样回答能让面试官觉得我对性能优化有系统性思考。

23. **ref 和 reactive 的区别** 掌握程度：[ ]

* `ref` 用于基本类型，返回一个 `.value` 包装。
* `reactive` 用于对象/数组，返回一个 Proxy 响应式对象。
* 语义上 ref 更轻量，reactive 更适合复杂数据。

24. **ref 可以大量替换成 reactive 吗？** 掌握程度：[ ]
    我会回答：

* 理论上很多场景都可以，但不是所有情况都合适。
* 基本类型用 reactive 包装不直观，而且解构时会丢失响应性。
* 所以官方推荐：基本类型用 ref，对象用 reactive。

25. **为什么 Vue 和 React 都实现了自己的路由？** 掌握程度：[ ]
    我会解释：

* 原生浏览器的路由能力有限，只能做页面跳转。
* 前端框架需要实现 SPA 的无刷新切换，还要支持懒加载、嵌套路由、导航守卫等功能。
* 所以必须有自己的一套路由系统。

26. **为什么不用 a 标签直接跳转？** 掌握程度：[ ]

* a 标签会导致页面整体刷新，用户体验不好。
* 前端路由通过拦截点击事件，结合 History API 来实现无刷新跳转，性能和体验更好。

27. **浏览器为什么支持单页面路由？** 掌握程度：[ ]

* 因为提供了 History API（pushState、replaceState），让前端可以操控 URL 而不触发刷新。
* 这是为 SPA 提供的基础能力。

28. **使用 history 导航时页面真的切换了吗？** 掌握程度：[ ]

* 其实没有真正切换页面。只是修改了地址栏 URL，同时触发了浏览器的历史事件。
* 前端框架监听到这个事件后，渲染对应组件，给用户一种“切换页面”的感觉。

29. **Vue 如何监听路由变化？** 掌握程度：[ ]

* Vue Router 提供了全局导航守卫（beforeEach、afterEach）。
* 组件内部可以通过 watch `$route` 来监听。

30. **原生 JS 如何监听路由变化？** 掌握程度：[ ]

* 监听 `hashchange` 事件。
* 对于 History API，可以监听 `popstate` 事件。

31. **没有 hash 的路由如何监听？** 掌握程度：[ ]

* 就是使用 `popstate` 事件。
* 结合 History API，可以实现无 hash 的路由。

32. **onpopstate 可以监听 pushState 吗？** 掌握程度：[ ]

* 不能。pushState 本身不会触发 popstate。
* 如果需要，可以在调用 pushState 时手动触发一个事件。

33. **TS 泛型的作用，常用场景** 掌握程度：[ ]

* 泛型就是在类型定义时不指定具体类型，而是等使用时再传入。
* 好处是复用性高，类型安全。
* 常见场景：工具函数（如 `identity<T>(arg:T):T`）、请求返回值定义、组件库封装。

34. **axios 二次封装的好处** 掌握程度：[ ]

* 统一配置请34. **axios 二次封装的好处** 掌握程度：[ Done ]
器里做统一错误处理。
* 这样每个业务请求只需要关注数据本身，减少重复代码。

35. **如何标识用户已经登录** 掌握程度：[ ]

* 一般是用 token 或 sessionId。
* 前端存储在 Cookie/LocalStorage，发请求时带上，后端校验合法性。

36. **token 过期如何刷新** 掌握程度：[ ]

* 常见方案是 refresh token。
* access token 过期时，用 refresh token 换取新的 access token。

37. **无感刷新 token** 掌握程度：[ ]

* 在请求或响应拦截器里检测到 401，就自动去刷新 token。
* 刷新成功后重放请求，用户无感知。

38. **响应拦截器的功能** 掌握程度：[ ]

* 统一处理返回数据，比如统一的 success/error 格式。
* 捕获错误、跳转登录页、自动刷新 token。
* 可以用来做全局 loading 状态。
---

## 二. CSS 场景大学习

**实现三列布局（两边固定，中间自适应）**
我会先回答用 Flex：

```css
.container {
  display: flex;
}
.left, .right {
  width: 200px;
}
.center {
  flex: 1;
}
```

然后补充 calc：

```css
.center {
  width: calc(100% - 400px);
}
```

面试时我还会强调：Flex 更灵活，calc 更直观，但要考虑浏览器兼容性。

---

## 三. 算法与代码大学习

1. **封装 Promise 重试函数**
   面试时我会先说设计思路：

   * 不要直接传 Promise，因为 Promise 一旦创建就会执行。
   * 正确做法是传一个返回 Promise 的函数，每次失败重新调用。
     实现代码：

   ```js
   function retryPromise(fn, times) {
     let count = 0;
     return new Promise((resolve, reject) => {
       const run = () => {
         fn()
           .then(resolve)
           .catch(err => {
             if (count < times - 1) {
               count++;
               run();
             } else {
               reject(err);
             }
           });
       };
       run();
     });
   }
   ```

2. **实现对象深拷贝**
   我会分层次回答：

   * 基本情况：如果不是对象，直接返回。
   * 数组和对象递归处理。
   * 循环引用问题可以用 WeakMap 解决。
     代码：

   ```js
   function deepClone(obj, map = new WeakMap()) {
     if (typeof obj !== 'object' || obj === null) return obj;
     if (map.has(obj)) return map.get(obj);
   
     let result = Array.isArray(obj) ? [] : {};
     map.set(obj, result);
   
     for (let key in obj) {
       if (obj.hasOwnProperty(key)) {
         result[key] = deepClone(obj[key], map);
       }
     }
     return result;
   }
   ```

   面试时我会补充：如果有函数、正则、Date 等特殊对象，要分别处理。

