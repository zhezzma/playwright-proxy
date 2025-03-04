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

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RECAPTCHA_SITE_KEY = "6Leq7KYqAAAAAGdd1NaUBJF9dHTPAKP7DcnaRc66";
const GENSPARK_URL = 'https://www.genspark.ai/agents?type=moa_chat';

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
      userAgent,
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      hasTouch: false,
      locale: 'zh-CN',
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

// 获取reCAPTCHA令牌
async function getReCaptchaToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    return new Promise<string>((resolve, reject) => {
      // @ts-ignore
      window.grecaptcha.ready(function () {
        // @ts-ignore
        grecaptcha.execute(
          RECAPTCHA_SITE_KEY,
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
  });
}

// 处理请求转发
async function handleRequest(url: string, method: string, headers: any, body?: any) {
  const browser = await initBrowser()
  const page = await browser.newPage()

  try {
    // 只移除确实需要移除的请求头
    const filteredHeaders = { ...headers };
    const headersToRemove = [
      'host', 'connection', 'content-length', 'accept-encoding',
      'cdn-loop', 'cf-connecting-ip', 'cf-connecting-o2o', 'cf-ew-via',
      'cf-ray', 'cf-visitor', 'cf-worker', 'x-direct-url',
      'x-forwarded-for', 'x-forwarded-port', 'x-forwarded-proto'
    ];

    headersToRemove.forEach(header => delete filteredHeaders[header]);
    filteredHeaders['user-agent'] = userAgent;

    console.log('处理请求:', method, url, filteredHeaders, body);

    // 设置请求拦截器
    await page.route('**/*', async (route: Route) => {
      const request = route.request();
      if (request.url() === url) {
        await route.continue({
          method: method,
          headers: {
            ...request.headers(),
            ...filteredHeaders
          },
          postData: body
        });
      } else {
        // 允许其他资源加载
        await route.continue();
      }
    });

    // 配置页面请求选项
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded', // 改为更快的加载策略
      timeout: 600000 // 60秒超时，更合理的值
    });

    if (!response) {
      throw new Error('未收到响应');
    }

    // 等待页面加载完成，使用更短的超时时间
    await page.waitForLoadState('networkidle', { timeout: 600000 }).catch(() => {
      console.log('等待页面加载超时，继续处理');
    });

    // 获取响应数据
    const status = response.status();
    const responseHeaders = response.headers();

    // 确保移除可能导致解码问题的响应头
    delete responseHeaders['content-encoding'];
    delete responseHeaders['content-length'];

    // 过滤无效的响应头
    const validHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(responseHeaders)) {
      if (isValidHeaderValue(value as string)) {
        validHeaders[key] = value as string;
      } else {
        console.warn(`跳过无效的响应头: ${key}: ${value}`);
      }
    }

    // 直接获取响应体的二进制数据
    const responseBody = await response.body();

    console.log('请求处理完成:', status);

    await page.close();

    return {
      status,
      headers: validHeaders,
      body: responseBody
    };
  } catch (error: any) {
    await page.close();
    console.error('请求处理错误:', error);
    throw new Error(`请求失败: ${error.message}`);
  }
}

// 解析cookie字符串为对象数组
function parseCookies(cookieString: string) {
  return cookieString.split(';')
    .map(cookie => {
      const [name, value] = cookie.trim().split('=');
      return {
        name,
        value,
        domain: 'www.genspark.ai',
        path: '/'
      };
    })
    .filter(cookie => cookie.name && cookie.value);
}

// 添加静态文件服务
app.use('/public/*', serveStatic({ root: './' }))

// 处理根路由直接返回 index.html 内容，而不是重定向
app.get('/', async (c) => {
  try {
    const htmlContent = fs.readFileSync('./index.html', 'utf-8')
    return c.html(htmlContent)
  } catch (error) {
    console.error('读取index.html失败:', error)
    return c.text('无法读取主页', 500)
  }
})

// 获取reCAPTCHA令牌的路由
app.get('/genspark', async (c) => {
  const headers = Object.fromEntries(c.req.raw.headers);
  const cookieString = headers.cookie || '';
  const cookies = parseCookies(cookieString);

  let page = null;
  let error = null;

  try {
    gensparkContext = await initGensparkContext();

    // 设置cookies
    if (cookies.length > 0) {
      await gensparkContext.clearCookies();
      await gensparkContext.addCookies(cookies);
    }

    page = await gensparkContext.newPage();

    // 导航到Genspark页面
    await page.goto(GENSPARK_URL, {
      waitUntil: 'networkidle',
      timeout: 30000 // 30秒超时，更合理
    });

    // 等待页面加载完成
    await page.waitForTimeout(1000);

    // 获取reCAPTCHA令牌
    const token = await getReCaptchaToken(page);

    if (!token) {
      return c.json({ code: 500, message: '获取令牌失败：令牌为空' });
    }

    return c.json({
      code: 200,
      message: '获取令牌成功',
      token: token
    });
  } catch (e) {
    error = e
    console.error('获取令牌失败:', e);
    return c.json({
      code: 500,
      message: `获取令牌失败: ${e instanceof Error ? e.message : '未知错误'}`
    });
  } finally {
    if (page) {
      await page.close().catch(() => { });
    }

    // 不要在每次请求后关闭上下文，保持它以便重用
    // 只有在出错时才重置上下文
    if (error && gensparkContext) {
      await gensparkContext.close().catch(() => { });
      gensparkContext = null;
    }
  }
});

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
console.log(`Server is running on port http://localhost:${port}`)

// 启动服务器
serve({
  fetch: app.fetch,
  port: port
})
