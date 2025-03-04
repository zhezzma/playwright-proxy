import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { chromium, type Browser, type BrowserContext, type Route, type Page } from 'playwright'
import process from 'process'
import fs from 'fs'

const app = new Hono()

// 浏览器实例
let browser: Browser | null = null
let gensparkContext: BrowserContext | null = null

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3';
// 初始化浏览器
async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, // 使用系统 Chromium
    })
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
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      geolocation: { longitude: -73.935242, latitude: 40.730610 }, // 纽约坐标，可根据需要调整
      permissions: ['geolocation'],
      javaScriptEnabled: true,
      bypassCSP: true, // 绕过内容安全策略
      colorScheme: 'light',
      acceptDownloads: true,
    })
  }

  return gensparkContext
}

// 验证响应头值是否有效
function isValidHeaderValue(value: string): boolean {
  // 检查值是否为空或包含无效字符
  if (!value || typeof value !== 'string') return false;
  // 检查是否包含换行符或回车符
  if (/[\r\n]/.test(value)) return false;
  return true;
}

// 处理请求转发
async function handleRequest(url: string, method: string, headers: any, body?: any) {
  const browser = await initBrowser()
  const page = await browser.newPage()

  try {
    // 只移除确实需要移除的请求头
    delete headers['host']
    delete headers['connection']
    delete headers['content-length']
    delete headers['accept-encoding']
    // 移除cf相关的头
    delete headers['cdn-loop']
    delete headers['cf-connecting-ip']
    delete headers['cf-connecting-o2o']
    delete headers['cf-ew-via']
    delete headers['cf-ray']
    delete headers['cf-visitor']
    delete headers['cf-worker']

    //移除其他无效的请求头
    delete headers['x-direct-url']
    delete headers['x-forwarded-for']
    delete headers['x-forwarded-port']
    delete headers['x-forwarded-proto']

    headers['user-agent'] = userAgent

    console.log('处理请求:', method, url, headers, body)
    // 设置请求拦截器
    await page.route('**/*', async (route: Route) => {
      const request = route.request()
      if (request.url() === url) {
        await route.continue({
          method: method,
          headers: {
            ...request.headers(),
            ...headers
          },
          postData: body
        })
      } else {
        // 允许其他资源加载
        await route.continue()
      }
    })

    // 配置页面请求选项
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded', // 改为更快的加载策略
      timeout: 600000
    })

    if (!response) {
      throw new Error('未收到响应')
    }

    // 等待页面加载完成
    await page.waitForLoadState('networkidle', { timeout: 600000 }).catch(() => {
      console.log('等待页面加载超时，继续处理')
    })

    // 获取响应数据
    const status = response.status()
    const responseHeaders = response.headers()

    // 确保移除可能导致解码问题的响应头
    delete responseHeaders['content-encoding']
    delete responseHeaders['content-length']

    // 过滤无效的响应头
    const validHeaders: Record<string, string> = {}
    for (const [key, value] of Object.entries(responseHeaders)) {
      if (isValidHeaderValue(value as string)) {
        validHeaders[key] = value as string
      } else {
        console.warn(`跳过无效的响应头: ${key}: ${value}`)
      }
    }

    // 直接获取响应体的二进制数据
    const responseBody = await response.body()

    console.log('请求处理完成:', status, responseBody.toString())

    await page.close()

    return {
      status,
      headers: validHeaders,
      body: responseBody
    }
  } catch (error: any) {
    await page.close()
    console.error('请求处理错误:', error)
    throw new Error(`请求失败: ${error.message}`)
  }
}


// 添加静态文件服务
app.use('/public/*', serveStatic({ root: './' }))

// 修改点 1: 处理根路由直接返回 index.html 内容，而不是重定向
app.get('/', async (c) => {
  try {
    const htmlContent = fs.readFileSync('./index.html', 'utf-8')
    return c.html(htmlContent)
  } catch (error) {
    console.error('读取index.html失败:', error)
    return c.text('无法读取主页', 500)
  }
})

// 修改点 2: 添加 /genspark 路由来获取reCAPTCHA令牌
app.get('/genspark', async (c) => {

  const headers = Object.fromEntries(c.req.raw.headers)
  // Get the cookie string from headers
  const cookieString = headers.cookie || '';
  // Parse cookies into an array of objects with name and value properties
  const cookies = cookieString.split(';').map(cookie => {
    const [name, value] = cookie.trim().split('=');
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
    await gensparkPage.waitForTimeout(1000)
    //刷新页面以确保获取新令牌
    await gensparkPage.goto('https://www.genspark.ai/agents?type=moa_chat', {
      waitUntil: 'networkidle',
      timeout: 3600000
    })
    await gensparkPage.waitForTimeout(1000)
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
    }).catch(error => {
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

// 处理所有 HTTP 方法
app.all('*', async (c) => {
  const url = c.req.query('url')
  if (!url) {
    return c.text('Missing url parameter', 400)
  }

  try {
    const method = c.req.method
    const headers = Object.fromEntries(c.req.raw.headers)
    const body = method !== 'GET' ? await c.req.text() : undefined

    const result = await handleRequest(url, method, headers, body)

    // 创建标准响应
    const response = new Response(result.body, {
      status: result.status,
      headers: new Headers({
        ...result.headers,
        'content-encoding': 'identity'  // 显式设置不使用压缩
      })
    })

    return response
  } catch (error) {
    console.error('Error:', error)
    return new Response('Internal Server Error', {
      status: 500,
      headers: new Headers({
        'content-type': 'text/plain'
      })
    })
  }
})

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
console.log(`Server is running on port  http://localhost:${port}`)

// 启动服务器
serve({
  fetch: app.fetch,
  port: port
})