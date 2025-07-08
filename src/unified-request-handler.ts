import type { Page } from 'playwright'

/**
 * 统一的请求处理器，支持流式和普通请求
 * 所有请求处理逻辑都在浏览器内部执行，保持浏览器指纹
 * 参考 StreamInterceptor 模式实现真正的流式处理
 */
export class UnifiedRequestHandler {
  /** @readonly */
  private uniqueId: string
  private isInjected = false

  /**
   * @param page Playwright 页面对象
   */
  constructor(private page: Page) {
    this.uniqueId = `handler_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  private info(message: string) {
    console.log(`[INFO] ${new Date().toISOString()} ${message}`)
  }

  private error(message: string) {
    console.error(`[ERROR] ${new Date().toISOString()} ${message}`)
  }

  /**
   * 处理代理请求
   * @param {string} targetUrl 目标URL
   * @param {string} method HTTP方法
   * @param {Record<string, string>} headers 请求头
   * @param {string} body 请求体
   * @returns {Promise<Response>} 响应对象
   */
  async handleRequest(targetUrl: string, method: string, headers: Record<string, string>, body?: string): Promise<Response> {
    try {
      await this._inject()

      this.info(`[UnifiedHandler] 处理请求: ${method} ${targetUrl}`)

      // 首先检查是否为流式请求
      const isStreamRequest = this._isStreamRequest(headers, targetUrl)

      if (isStreamRequest) {
        // 流式请求：使用拦截器模式
        return await this._handleStreamRequest(targetUrl, method, headers, body)
      } else {
        // 普通请求：直接在浏览器内处理
        return await this._handleRegularRequest(targetUrl, method, headers, body)
      }

    } catch (err: any) {
      this.error(`[UnifiedHandler] 请求处理失败: ${err.message}`)
      return new Response(`请求处理失败: ${err.message}`, {
        status: 500,
        headers: { 'content-type': 'text/plain' }
      })
    }
  }

  /**
   * 判断是否为流式请求
   * @private
   */
  private _isStreamRequest(headers: Record<string, string>, url: string): boolean {
    const accept = headers['accept'] || ''
    const contentType = headers['content-type'] || ''

    // 检查常见的流式请求特征
    return accept.includes('text/event-stream') ||
           accept.includes('application/stream') ||
           url.includes('/stream') ||  // httpbin.org/stream 等
           url.includes('chat/completions') ||
           url.includes('v1/completions') ||
           url.includes('generate') ||
           url.includes('streaming') ||
           (contentType.includes('application/json') && url.includes('stream'))
  }

  /**
   * 过滤不安全的请求头
   * @private
   */
  private _filterUnsafeHeaders(headers: Record<string, string>): Record<string, string> {
    // 浏览器不允许设置的不安全请求头列表
    const unsafeHeaders = new Set([
      'accept-charset',
      'accept-encoding',
      'access-control-request-headers',
      'access-control-request-method',
      'connection',
      'content-length',
      'cookie',
      'cookie2',
      'date',
      'dnt',
      'expect',
      'host',
      'keep-alive',
      'origin',
      'referer',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
      'user-agent',
      'via',
      // Sec- 开头的请求头
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      'sec-ch-ua-platform',
      'sec-fetch-dest',
      'sec-fetch-mode',
      'sec-fetch-site',
      'sec-fetch-user'
    ])

    const safeHeaders: Record<string, string> = {}

    Object.entries(headers).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase()
      if (!unsafeHeaders.has(lowerKey) && !lowerKey.startsWith('proxy-') && !lowerKey.startsWith('sec-')) {
        safeHeaders[key] = value
      } else {
        this.info(`[UnifiedHandler] 过滤不安全请求头: ${key}`)
      }
    })

    return safeHeaders
  }

  /**
   * 处理流式请求 - 简化版本，直接在浏览器内处理
   * @private
   */
  private async _handleStreamRequest(targetUrl: string, method: string, headers: Record<string, string>, body?: string): Promise<Response> {
    this.info(`[UnifiedHandler] 处理流式请求: ${method} ${targetUrl}`)

    // 过滤不安全的请求头
    const safeHeaders = this._filterUnsafeHeaders(headers)

    // 在浏览器内部执行流式请求处理
    const result = await this.page.evaluate(async ({ targetUrl, method, headers, body }: {
      targetUrl: string,
      method: string,
      headers: Record<string, string>,
      body?: string
    }) => {
      console.log('🌊 浏览器内发送流式请求:', method, targetUrl)

      return new Promise<{
        status: number,
        statusText: string,
        headers: Record<string, string>,
        chunks: string[]
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        const chunks: string[] = []
        let lastSentLength = 0
        let responseHeaders: Record<string, string> = {}

        xhr.addEventListener('progress', () => {
          const fullResponseText = xhr.responseText || ''
          const newChunk = fullResponseText.slice(lastSentLength)

          if (newChunk) {
            chunks.push(newChunk)
            lastSentLength = fullResponseText.length
          }
        })

        xhr.addEventListener('readystatechange', () => {

          console.log('   📦 流数据状态变化:', xhr.readyState)
          if (xhr.readyState === 2) {
            // 获取响应头
            const headerString = xhr.getAllResponseHeaders()
            headerString.split('\r\n').forEach(line => {
              const [key, value] = line.split(': ')
              if (key && value) {
                responseHeaders[key.toLowerCase()] = value
              }
            })
          }
          
          if (xhr.readyState === 4) {
            console.log('   🏁 流数据读取完成')
            // 确保获取最后的数据块
            const finalResponseText = xhr.responseText || ''
            const finalChunk = finalResponseText.slice(lastSentLength)
            if (finalChunk) {
              chunks.push(finalChunk)
            }

            resolve({
              status: xhr.status,
              statusText: xhr.statusText,
              headers: responseHeaders,
              chunks: chunks
            })
          }
        })

        xhr.addEventListener('error', () => {
          reject(new Error('XHR request failed'))
        })

        xhr.addEventListener('abort', () => {
          reject(new Error('XHR request aborted'))
        })

        // 发起请求
        xhr.open(method, targetUrl, true)

        // 设置请求头 - 使用 try-catch 来处理不安全的请求头
        Object.entries(headers).forEach(([key, value]) => {
          try {
            xhr.setRequestHeader(key, value)
          } catch (error: any) {
            console.warn(`无法设置请求头 ${key}: ${error.message}`)
          }
        })

        xhr.send(body)
      })
    }, {
      targetUrl,
      method,
      headers: safeHeaders,
      body
    })

    // 创建流式响应
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of result.chunks) {
          controller.enqueue(new TextEncoder().encode(chunk))
        }
        controller.close()
      }
    })

    return new Response(stream, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers
    })
  }

  /**
   * 处理普通请求
   * @private
   */
  private async _handleRegularRequest(targetUrl: string, method: string, headers: Record<string, string>, body?: string): Promise<Response> {
    this.info(`[UnifiedHandler] 处理普通请求: ${method} ${targetUrl}`)

    // 过滤不安全的请求头
    const safeHeaders = this._filterUnsafeHeaders(headers)

    // 在浏览器内部执行请求处理，返回序列化的响应数据
    const result = await this.page.evaluate(async ({ targetUrl, method, headers, body }: {
      targetUrl: string,
      method: string,
      headers: Record<string, string>,
      body?: string
    }) => {
      console.log('🌐 浏览器内发送请求:', method, targetUrl)

      const options: RequestInit = {
        method: method,
        headers: headers
      }

      if (body && method !== 'GET') {
        options.body = body
      }

      const response = await fetch(targetUrl, options)

      // 序列化响应头
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      // 读取完整内容
      const arrayBuffer = await response.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: Array.from(uint8Array) // 转换为普通数组以便序列化
      }
    }, {
      targetUrl,
      method,
      headers: safeHeaders,
      body
    })

    // 构造 Response 对象
    const bodyBuffer = new Uint8Array(result.body)
    return new Response(bodyBuffer, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers
    })
  }



  /**
   * 注入必要的脚本到页面
   * @private
   */
  private async _inject() {
    if (this.isInjected) return

    this.info(`[UnifiedHandler] 注入请求处理脚本 (ID: ${this.uniqueId})`)

    // 导航到空白页面确保环境干净
    await this.page.goto('about:blank')

    this.isInjected = true
    this.info(`[UnifiedHandler] 脚本注入完成 (ID: ${this.uniqueId})`)
  }
  
  /**
   * 清理资源
   */
  async cleanup() {
    this.info(`[UnifiedHandler] 清理资源 (ID: ${this.uniqueId})`)
    this.isInjected = false
  }
}
