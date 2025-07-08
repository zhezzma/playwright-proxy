/**
 * 测试统一代理请求处理器
 */

const PROXY_URL = 'http://localhost:7860'

async function testNormalRequest() {
  console.log('🧪 测试普通请求...')

  try {
    const testUrl = 'https://httpbin.org/json'
    const startTime = Date.now()

    const response = await fetch(`${PROXY_URL}/?url=${encodeURIComponent(testUrl)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    })

    const endTime = Date.now()
    const duration = endTime - startTime

    console.log(`   ✅ 状态码: ${response.status}`)
    console.log(`   ⏱️  响应时间: ${duration}ms`)
    console.log(`   📄 Content-Type: ${response.headers.get('content-type')}`)

    if (response.ok) {
      const data = await response.json()
      console.log(`   📦 响应数据:`, JSON.stringify(data, null, 2).substring(0, 200) + '...')
    } else {
      const text = await response.text()
      console.log(`   ❌ 错误响应:`, text.substring(0, 200))
    }

  } catch (error) {
    console.error('   ❌ 请求失败:', error.message)
  }

  console.log('')
}

async function testPostRequest() {
  console.log('🧪 测试POST请求...')

  try {
    const testUrl = 'https://httpbin.org/post'
    const postData = {
      test: 'unified-proxy',
      timestamp: new Date().toISOString(),
      message: '测试浏览器指纹代理'
    }

    const startTime = Date.now()

    const response = await fetch(`${PROXY_URL}/?url=${encodeURIComponent(testUrl)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(postData)
    })

    const endTime = Date.now()
    const duration = endTime - startTime

    console.log(`   ✅ 状态码: ${response.status}`)
    console.log(`   ⏱️  响应时间: ${duration}ms`)
    console.log(`   📄 Content-Type: ${response.headers.get('content-type')}`)

    if (response.ok) {
      const data = await response.json()
      console.log(`   📦 发送的数据被正确接收:`, data.json ? '✅' : '❌')
      console.log(`   🌐 User-Agent:`, data.headers['User-Agent'] || 'N/A')
    } else {
      const text = await response.text()
      console.log(`   ❌ 错误响应:`, text.substring(0, 200))
    }

  } catch (error) {
    console.error('   ❌ 请求失败:', error.message)
  }

  console.log('')
}

async function testStreamRequest() {
  console.log('🌊 测试流式请求...')

  try {
    // 使用 httpbin.org/stream 端点测试流式响应
    const testUrl = 'https://httpbin.org/stream/3'
    const startTime = Date.now()

    const response = await fetch(`${PROXY_URL}/?url=${encodeURIComponent(testUrl)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    })

    console.log(`   ✅ 状态码: ${response.status}`)
    console.log(`   📄 Content-Type: ${response.headers.get('content-type')}`)
    console.log(`   🌊 Transfer-Encoding: ${response.headers.get('transfer-encoding')}`)

    if (response.ok && response.body) {
      console.log('   📦 开始读取流数据...')
      const reader = response.body.getReader()
      let chunkCount = 0
      let totalBytes = 0

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          chunkCount++
          totalBytes += value.length
          const chunk = new TextDecoder().decode(value)
          console.log(`   📦 数据块 ${chunkCount} (${value.length} bytes):`, chunk.trim().substring(0, 100) + '...')
        }
      } finally {
        reader.releaseLock()
      }

      const endTime = Date.now()
      const duration = endTime - startTime
      console.log(`   ✅ 流式请求完成: ${chunkCount} 个数据块, ${totalBytes} 字节, ${duration}ms`)
    } else {
      const text = await response.text()
      console.log(`   ❌ 错误响应:`, text.substring(0, 200))
    }

  } catch (error) {
    console.error('   ❌ 流式请求失败:', error.message)
  }

  console.log('')
}

async function testOpenAIStyleStream() {
  console.log('🤖 测试 OpenAI 风格流式请求...')

  try {
    // 模拟 OpenAI API 请求（会失败，但可以测试流式检测逻辑）
    const testUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
    const requestBody = {
      model: 'glm-4-flash',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true
    }

    const startTime = Date.now()

    const response = await fetch(`${PROXY_URL}/?url=${encodeURIComponent(testUrl)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 0d8810c3e44bff8192759792e627f1d5.aIubYJQQV4lKxCuB'
      },
      body: JSON.stringify(requestBody)
    })

    const endTime = Date.now()
    const duration = endTime - startTime

    console.log(`   ✅ 状态码: ${response.status}`)
    console.log(`   ⏱️  响应时间: ${duration}ms`)
    console.log(`   📄 Content-Type: ${response.headers.get('content-type')}`)
    console.log(`   🌊 Transfer-Encoding: ${response.headers.get('transfer-encoding')}`)

    if (response.ok && response.body) {
      console.log('   📦 开始读取 OpenAI 风格流数据...')
      const reader = response.body.getReader()
      let chunkCount = 0
      let totalBytes = 0
      let fullContent = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            console.log('   🏁 流数据读取完成')
            break
          }

          chunkCount++
          totalBytes += value.length
          const chunk = new TextDecoder().decode(value)
          fullContent += chunk
          
          console.log(`   📦 数据块 ${chunkCount} (${value.length} bytes):`)
          console.log(`   📝 原始数据: ${JSON.stringify(chunk)}`)
          console.log(`   📄 解码内容: ${chunk}`)
          console.log('   ─'.repeat(50))
          
          // 如果是 SSE 格式，尝试解析每一行
          if (chunk.includes('data:')) {
            const lines = chunk.split('\n')
            lines.forEach((line, index) => {
              if (line.trim()) {
                console.log(`   📋 第${index + 1}行: ${line}`)
                if (line.startsWith('data:')) {
                  try {
                    const jsonStr = line.substring(5).trim()
                    if (jsonStr && jsonStr !== '[DONE]') {
                      const parsed = JSON.parse(jsonStr)
                      console.log(`   🔍 解析的JSON:`, JSON.stringify(parsed, null, 2))
                    }
                  } catch (e) {
                    console.log(`   ⚠️  JSON解析失败: ${e.message}`)
                  }
                }
              }
            })
          }
        }
      } finally {
        reader.releaseLock()
      }

      console.log(`   ✅ OpenAI 风格流式请求完成:`)
      console.log(`   📊 统计信息: ${chunkCount} 个数据块, ${totalBytes} 字节`)
      console.log(`   📝 完整内容长度: ${fullContent.length} 字符`)
      console.log(`   📄 完整内容预览:`)
      console.log('   ' + '='.repeat(60))
      console.log(fullContent)
      console.log('   ' + '='.repeat(60))
    } else {
      const text = await response.text()
      console.log(`   ❌ 错误响应 (${response.status}):`, text)
    }

  } catch (error) {
    console.error('   ❌ OpenAI 风格请求失败:', error.message)
    console.error('   🔍 错误详情:', error)
  }

  console.log('')
}

async function main() {
  console.log('🚀 开始测试统一代理请求处理器\n')

  // await testNormalRequest()
  // await testPostRequest()
  // await testStreamRequest()
  await testOpenAIStyleStream()
  console.log('✅ 所有测试完成!')
}

main().catch(console.error)
