import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'

const app = new Hono()

// 浏览器实例
let browser: any = null

// 初始化浏览器
async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    })
  }
  return browser
}

// 处理请求转发
async function handleRequest(url: string, method: string, headers: any, body?: any) {
  const browser = await initBrowser()
  const page = await browser.newPage()

  console.log('处理请求:', method, url, headers, body)
  
  try {
    // 只移除确实需要移除的请求头
    delete headers['host']
    delete headers['connection']
    delete headers['content-length']
    // 保留 accept-encoding，让浏览器正确处理压缩
    // delete headers['accept-encoding']
    
    // 设置请求拦截器
    await page.route('**/*', async (route:any) => {
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
      timeout: 30000
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
    
    // 直接获取响应体的二进制数据
    const responseBody = await response.body()

    await page.close()

    return {
      status,
      headers: responseHeaders,
      body: responseBody
    }
  } catch (error:any) {
    await page.close()
    console.error('请求处理错误:', error)
    throw new Error(`请求失败: ${error.message}`)
  }
}

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
const port = 8088
// 启动服务器
serve({
  fetch: app.fetch,
  port: port
})

// 启动服务器
console.log(`Server is running on port  http://localhost:${port}`)
