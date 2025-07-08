# Playwright Proxy

一个基于 Playwright 和 Hono 的智能代理服务器，支持浏览器指纹伪装和流式响应处理。

## 特性

- 🎭 **浏览器指纹伪装**: 使用真实浏览器发送请求，避免服务端指纹检测
- 🌊 **流式响应支持**: 智能检测并实时转发流式响应（SSE、Stream等）
- 🔄 **请求转发**: 支持所有 HTTP 方法的请求转发
- 🛡️ **反检测机制**: 内置多种反自动化检测脚本
- 🎯 **reCAPTCHA 集成**: 支持 GenSpark reCAPTCHA 令牌获取
- ⚡ **高性能**: 基于 Hono 框架，轻量级高性能

## 技术架构

### 核心组件

- **Hono**: 轻量级 Web 框架
- **Playwright**: 浏览器自动化工具
- **Node.js Fetch**: 网络请求处理

### 工作原理

1. **浏览器请求**: 使用 Playwright 创建真实浏览器环境
2. **路由拦截**: 拦截目标请求并用 fetch 重新发送
3. **响应处理**: 智能检测流式/普通响应并相应处理
4. **数据转发**: 实时转发响应数据到客户端

## 快速开始

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器
npx playwright install chromium

# 启动开发服务器
npm run dev

# 或直接启动
npm start
```

```bash
# 访问服务器
open http://localhost:7860
```

## 配置

### 环境变量

```bash
# 端口配置（可选，默认 7860）
PORT=7860

# Chromium 可执行文件路径（可选）
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium
```

## 使用方法

### API 接口

#### 1. 通用代理接口

**请求格式:**
```
METHOD /?url=<target_url>
```

**示例:**
```bash
# GET 请求
curl "http://localhost:7860/?url=https://api.example.com/data"

# POST 请求
curl -X POST "http://localhost:7860/?url=https://api.example.com/submit" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

#### 2. GenSpark reCAPTCHA 令牌

**接口:** `GET /genspark`

**功能:** 获取 GenSpark 网站的 reCAPTCHA 令牌

**响应:**
```json
{
  "code": 200,
  "message": "获取令牌成功",
  "token": "03AGdBq2..."
}
```

### 流式响应处理

代理服务器会自动检测以下类型的流式响应：
- `text/event-stream` (Server-Sent Events)
- `application/stream`

对于流式响应，数据会实时转发，无需等待完整响应。

## 项目结构

```
playwright-proxy/
├── src/
│   └── index.ts          # 主服务器文件
├── public/               # 静态文件目录
├── index.html           # 主页面
├── package.json
└── README.md
```

## 核心功能详解

### 1. 浏览器指纹伪装

```typescript
// 反检测脚本注入
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
  window.navigator.chrome = { runtime: {} }
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
})
```

### 2. 智能请求处理

- **请求头清理**: 自动移除可能暴露代理身份的请求头
- **浏览器环境**: 使用真实浏览器 User-Agent 和环境
- **地理位置伪装**: 模拟纽约地理位置

### 3. 流式响应检测

```typescript
const contentType = fetchResponse.headers.get('content-type') || ''
if (contentType.includes('text/event-stream') || contentType.includes('application/stream')) {
  // 返回流对象，实时转发
  return { status, headers, stream: fetchResponse.body }
} else {
  // 返回完整响应
  return { status, headers, body: Buffer.from(await fetchResponse.arrayBuffer()) }
}
```

## 开发

### 本地开发

```bash
# 开发模式（如果配置了）
npm run dev

# 或直接运行
npm start
```

### 构建

```bash
# TypeScript 编译
npx tsc

# 或使用构建脚本（如果配置了）
npm run build
```

## 注意事项

1. **资源消耗**: 每个请求都会创建新的浏览器页面，注意资源管理
2. **超时设置**: 默认请求超时为 10 分钟，可根据需要调整
3. **并发限制**: 建议控制并发请求数量，避免系统资源耗尽
4. **安全考虑**: 生产环境请添加适当的访问控制和速率限制

## 故障排除

### 常见问题

1. **Chromium 启动失败**
   - 确保已安装 Playwright 浏览器：`npx playwright install chromium`
   - 检查系统依赖是否完整

2. **请求超时**
   - 检查目标服务器是否可访问
   - 调整超时设置

3. **内存占用过高**
   - 检查浏览器页面是否正确关闭
   - 考虑添加页面池管理

## 技术细节

### 请求流程

1. 客户端发送请求到代理服务器
2. 代理服务器创建 Playwright 浏览器页面
3. 设置路由拦截器，拦截目标 URL 请求
4. 使用 `route.fulfill()` 向浏览器返回伪造响应
5. 同时使用 `fetch()` 重新发送真实请求
6. 检测响应类型（流式 vs 普通）
7. 实时转发响应数据到客户端

### 反检测机制

- 禁用 `webdriver` 属性
- 伪造 `navigator.plugins`
- 注入 `chrome` 对象
- 设置真实的语言偏好
- 使用真实的地理位置和时区

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

### v1.0.0
- 初始版本发布
- 支持基本代理功能
- 集成浏览器指纹伪装
- 支持流式响应处理
