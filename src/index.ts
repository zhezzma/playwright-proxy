import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import process from 'process'
import fs from 'fs'
import { config } from 'dotenv'
import { UnifiedRequestHandler } from './unified-request-handler.js'

// 加载环境变量
config()

const app = new Hono()
// 浏览器实例
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3';

// 启动浏览器实例
async function launchBrowser() {
  // 从环境变量读取headless配置，默认为true
  const headless = process.env.HEADLESS === 'false' ? false : true

  const browser = await chromium.launch({
    headless: headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', // 禁用自动化特征
      '--disable-infobars',
      '--window-size=1920,1080'
    ],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, // 使用系统 Chromium
  })

  console.log(`🌐 浏览器启动: ${headless ? 'headless' : 'headed'}`)
  return browser
}


// 添加静态文件服务
app.use('/public/*', serveStatic({ root: './' }))

// 通用代理请求处理函数
async function handleProxyRequest(c: any) {
  const url = c.req.query('url')
  if (!url) {
    return c.text('Missing url parameter', 400)
  }

  console.log(`🚀 开始处理代理请求: ${c.req.method} ${url}`)

  let browser: Browser | null = null
  let page: Page | null = null
  let handler: UnifiedRequestHandler | null = null

  try {
    browser = await launchBrowser()
    page = await browser.newPage()
    // 创建统一请求处理器
    handler = new UnifiedRequestHandler(page)

    // 准备请求参数
    const method = c.req.method
    const headers = Object.fromEntries(c.req.raw.headers)
    const body = method !== 'GET' ? await c.req.text() : undefined

    // 清理不需要的请求头
    delete headers['host']
    delete headers['connection']
    delete headers['content-length']
    delete headers['accept-encoding']
    delete headers['x-playwright-api-request']
    delete headers['x-direct-url']
    delete headers['x-forwarded-for']
    delete headers['x-forwarded-port']
    delete headers['x-forwarded-proto']

    // 设置浏览器User-Agent
    headers['user-agent'] = userAgent

    console.log(`📋 请求详情: ${method} ${url}`)
    console.log(`📦 请求头数量: ${Object.keys(headers).length}`)
    console.log(`📄 请求体大小: ${body ? body.length : 0} 字节`)

    // 使用统一处理器处理请求
    const responseData = await handler.handleRequest(url, method, headers, body)

    console.log(`✅ 代理请求处理完成: ${responseData.status}`)
    return responseData

  } catch (error: any) {
    console.error('❌ 代理请求处理失败:', error)
    return new Response('Internal Server Error', {
      status: 500,
      headers: new Headers({
        'content-type': 'text/plain'
      })
    })
  }
  finally {
    // 清理资源
    if (handler) {
      await handler.cleanup()
    }
    if (page) {
      await page.close().catch(() => { })
    }
    if (browser) {
      await browser.close().catch(() => { })
    }
  }
}

// 修改点 1: 处理根路由直接返回 index.html 内容，而不是重定向
app.get('/', async (c) => {
  // 如果有url参数，则交给通用处理器处理
  const url = c.req.query('url')
  if (url) {
    // 转发到通用处理器
    return await handleProxyRequest(c)
  }

  try {
    const htmlContent = fs.readFileSync('./index.html', 'utf-8')
    return c.html(htmlContent)
  } catch (error) {
    console.error('读取index.html失败:', error)
    return c.text('无法读取主页', 500)
  }
})
// 处理所有 HTTP 方法
app.all('*', handleProxyRequest)

// 清理函数
async function cleanup() {
  process.exit(0)
}

// 监听进程退出信号
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

const port = Number(process.env.PORT || '7860');
// 启动服务器
serve({
  fetch: app.fetch,
  port: port
},
  (info) => {
    console.log(`Server is running on port  http://localhost:${info.port}`)
  }
)