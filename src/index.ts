import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { chromium, type Browser, type Route } from 'playwright'
import process from 'process';

const app = new Hono()


// 浏览器实例
let browser: Browser | null = null

// 初始化浏览器
async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ],
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, // 使用系统 Chromium
    })
  }
  return browser
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

    headers['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'

    console.log('处理请求:', method, url, headers, body)
    // 设置请求拦截器
    await page.route('**/*', async (route: Route) => {
      const request = route.request()
      if (request.url() === url) {
        await route.continue({
          method: method,
          headers: headers,
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
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
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
      if (isValidHeaderValue(value)) {
        validHeaders[key] = value
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

// 添加根路由重定向
app.get('/', (c) => {
  return c.redirect('/public/index.html')
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
  if (browser) {
    await browser.close()
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