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
let browser: Browser | null = null
let gensparkContext: BrowserContext | null = null

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3';
// 初始化浏览器
async function initBrowser() {
  if (!browser) {
    // 从环境变量读取headless配置，默认为true
    const headless = process.env.HEADLESS === 'false' ? false : true

    browser = await chromium.launch({
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

    console.log(`🌐 浏览器启动模式: ${headless ? 'headless' : 'headed'}`)
  }
  return browser
}

// 初始化genspark页面
async function initGensparkContext() {
  const browser = await initBrowser()

  if (!gensparkContext) {
    gensparkContext = await browser.newContext({
      userAgent: userAgent,
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
      },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      geolocation: { longitude: -73.935242, latitude: 40.730610 }, // 纽约坐标，可根据需要调整
      permissions: ['geolocation'],
      javaScriptEnabled: true,
      bypassCSP: true, // 绕过内容安全策略
      colorScheme: 'light',
      acceptDownloads: true,
    })

    // 注入反检测脚本
    await gensparkContext.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      //@ts-ignore
      window.navigator.chrome = { runtime: {} }
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
    })
  }

  return gensparkContext
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

  const browser = await initBrowser()
  const page = await browser.newPage()
  // 创建统一请求处理器
  const handler = new UnifiedRequestHandler(page)
  try {


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
    await handler.cleanup()
    await page.close()
  }
}



// 修改点 2: 添加 /genspark 路由来获取reCAPTCHA令牌
app.get('/genspark', async (c) => {

  const headers = Object.fromEntries(c.req.raw.headers)
  // Get the cookie string from headers
  const cookieString = headers.cookie || '';
  // Parse cookies into an array of objects with name and value properties
  const cookies = cookieString.split(';').map(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name.startsWith("_ga")) {
      return { name, value, domain: 'genspark.ai', path: '/' };
    }
    return { name, value, domain: 'www.genspark.ai', path: '/' };
  }).filter(cookie => cookie.name && cookie.value);

  gensparkContext = await initGensparkContext()

  console.log('Cookies:', cookies)
  if (cookies && cookies.length > 0) {
    await gensparkContext.clearCookies()
    await gensparkContext.addCookies(cookies);
  }
  const gensparkPage = await gensparkContext.newPage()
  try {
    //刷新页面以确保获取新令牌
    await gensparkPage.goto('https://www.genspark.ai/agents?type=moa_chat', {
      waitUntil: 'networkidle',
      timeout: 3600000
    })
    // 执行脚本获取令牌
    const token = await gensparkPage.evaluate(() => {
      return new Promise((resolve, reject) => {
        // @ts-ignore
        window.grecaptcha.ready(function () {
          // @ts-ignore
          grecaptcha.execute(
            "6Leq7KYqAAAAAGdd1NaUBJF9dHTPAKP7DcnaRc66",
            { action: 'copilot' },
          ).then(function (token: string) {
            resolve(token)
          }).catch(function (error: Error) {
            reject(error)
          });
        });

        // 设置超时
        setTimeout(() => reject(new Error("获取令牌超时")), 10000);
      });
    }).catch(() => {
      return c.json({ code: 500, message: '获取令牌失败' })
    });
    console.log('token:', token)
    return c.json({ code: 200, message: '获取令牌成功', token: token })
  }
  catch (error) {
    console.error('获取令牌失败:', error)
    if (gensparkContext) {
      await gensparkContext.close().catch(() => { });
      gensparkContext = null;
    }
  }
  finally {
    await gensparkPage.close().catch(() => { });
  }
  console.log('token:', "获取令牌失败")
  return c.json({ code: 500, message: '获取令牌失败' })
})



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
  if (gensparkContext) {
    await gensparkContext.close().catch(() => { });
    gensparkContext = null;
  }

  if (browser) {
    await browser.close().catch(() => { });
    browser = null;
  }
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