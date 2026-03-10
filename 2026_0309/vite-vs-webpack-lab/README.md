# Vite vs Webpack 对照实验指南

> 用同一份源码，在 Webpack 和 Vite 中分别运行，亲眼观察差异。

## 快速开始

```bash
cd vite-vs-webpack-lab

# 安装依赖（两个项目分别安装）
cd webpack-demo && npm install && cd ..
cd vite-demo && npm install && cd ..

# 分别启动 dev server（两个终端）
# 终端 1:
cd webpack-demo && npm run dev    # → http://localhost:3001

# 终端 2:
cd vite-demo && npm run dev       # → http://localhost:3002
```

---

## 实验 1：Dev 启动速度对比

### 操作
分别记录两个项目 `npm run dev` 从回车到"ready"的耗时。

### 观察点
- **Webpack**：启动前要扫描依赖图、打包所有模块，然后才能 serve
- **Vite**：几乎瞬间启动 server，因为它**不打包**——等浏览器请求时才编译

### 面试话术
> "Vite dev 启动快的本质不是编译器快，而是架构不同——Webpack 先 bundle 再 serve，Vite 先 serve 再按需 transform。"

---

## 实验 2：Network 面板 — 模块加载方式对比

### 操作
两个项目都打开 Chrome DevTools → Network 面板，刷新页面。

### 观察点

**Webpack（http://localhost:3001）：**
- Network 中只有 **1-2 个 JS 文件**（如 `main.js`、`vendors.js`）
- 所有模块都被**打包成 bundle**
- 看不到 `app.js`、`utils.js` 这些独立文件

**Vite（http://localhost:3002）：**
- Network 中能看到 **多个独立的 JS 请求**：`index.js`、`app.js`、`heavy.js`、`utils.js`
- 每个源文件对应一个 HTTP 请求
- 响应头中有 `Content-Type: application/javascript`，浏览器用**原生 ESM** 执行

### 面试话术
> "打开 Network 面板一目了然——Webpack dev 环境下浏览器拿到的是打包好的 bundle，Vite dev 环境下浏览器直接请求的是原始模块文件，由 Vite server 按需 transform 后返回。"

---

## 实验 3：HMR 速度对比

### 操作
1. 两个项目都打开浏览器控制台
2. 修改 `src/app.js` 中的 `HMR_TEST` 字符串，保存
3. 观察控制台输出和页面更新速度

### 观察点
- **Webpack**：HMR 需要重新打包受影响的 chunk，可能有明显延迟
- **Vite**：只需要重新 transform 被修改的那个文件，其他模块完全不动

### 进阶观察
打开 Network 面板，保存文件后：
- **Webpack**：推送一个热更新 chunk（`main.xxxx.hot-update.js`）
- **Vite**：推送的是**单个模块文件**（`/src/app.js?t=时间戳`），体积更小

---

## 实验 4：动态 import() 与代码分割

### 操作
1. 打开 Network 面板，清空
2. 点击页面上的"点击触发动态 import"按钮
3. 观察 Network 中新增的请求

### 观察点

**Webpack：**
- 新增一个 chunk 文件请求（如 `src_lazy-module_js.chunk.js`）
- 这个 chunk 是 Webpack 在打包阶段就根据 `import()` 边界预先分割好的

**Vite：**
- 新增一个请求 `/src/lazy-module.js`
- 就是原始文件，没有额外的 chunk wrapper

### 面试话术
> "两者都支持基于 import() 的代码分割，但机制不同：Webpack 在构建时就分割好 chunk 文件，Vite dev 模式下就是直接请求源文件——因为本来就没有 bundle，何谈分割？"

---

## 实验 5：生产构建对比

### 操作
```bash
# Webpack 生产构建
cd webpack-demo && npm run build
ls -la dist/

# Vite 生产构建
cd vite-demo && npm run build
ls -la dist/assets/
```

### 观察点
1. **产物结构**：两者生产构建都会产出打包后的 JS 文件（Vite 用 Rollup 打包）
2. **Tree Shaking**：`utils.js` 中的 `unusedFunction` 是否被移除？
   ```bash
   # 搜索产物中是否包含 unusedFunction
   grep -r "unusedFunction" webpack-demo/dist/
   grep -r "unusedFunction" vite-demo/dist/
   ```
3. **代码分割**：`lazy-module.js` 是否被分割为独立 chunk？
4. **文件名 hash**：用于长期缓存

### 面试话术
> "Vite 的 dev 和 prod 用了不同的工具链——dev 用 esbuild transform + 原生 ESM，prod 用 Rollup 打包。这是 Vite 的一个缺点：dev 和 prod 的行为可能存在细微差异。Webpack 则 dev 和 prod 都走同一套打包流程，一致性更好。"

---

## 实验 6：依赖预构建（Vite 特有）

### 操作
给 Vite 项目加一个 npm 依赖来观察预构建：

```bash
cd vite-demo
npm install lodash-es
```

修改 `src/app.js`，在顶部加一行：
```js
import { debounce } from 'lodash-es';
```

然后重启 `npm run dev`。

### 观察点
1. 终端输出中会看到 `Pre-bundling dependencies: lodash-es`
2. 浏览器 Network 面板中，`lodash-es` 不是几百个独立文件请求，而是被预构建成**一个文件**
3. 预构建产物缓存在 `node_modules/.vite/` 目录下

### 为什么需要预构建？
- `lodash-es` 内部有几百个小模块文件
- 如果不预构建，浏览器需要发几百个 HTTP 请求逐个加载
- Vite 用 esbuild 将第三方依赖预打包成单个文件，解决"请求瀑布"问题

### 面试话术
> "Vite 的'不打包'只针对你的业务代码。对于 node_modules 中的第三方依赖，Vite 启动时会用 esbuild 做一次预构建（dep pre-bundling），将它们打包成浏览器友好的 ESM 格式，避免几百个模块请求的瀑布问题。"

---

## 核心结论速查表

| 维度 | Webpack | Vite |
|------|---------|------|
| Dev 架构 | Bundle 后 serve | Serve 后按需 transform |
| Dev 模块格式 | 自定义 bundle（`__webpack_require__`） | 原生 ESM（浏览器直接执行） |
| HMR 范围 | 重新打包受影响的 chunk | 只 transform 修改的文件 |
| 第三方依赖 | 统一打包 | 预构建（esbuild）+ 缓存 |
| 生产构建 | Webpack 自身 | Rollup |
| Dev/Prod 一致性 | 高（同一工具链） | 有差异（dev: esbuild, prod: Rollup） |
| 配置复杂度 | 高 | 低 |
| 生态 | 最成熟（loader/plugin 丰富） | 快速增长，兼容 Rollup 插件 |
