import type { AIProvider, AIMessage, AIStreamCallbacks } from '@/types/ai'

export interface CallAIOptions {
  signal?: AbortSignal
  /** 超时毫秒数，超时后自动中断请求 */
  timeoutMs?: number
}

/**
 * 调用 OpenAI 兼容接口，支持流式输出
 */
export async function callAI(
  config: AIProvider,
  messages: AIMessage[],
  options?: CallAIOptions,
  callbacks?: AIStreamCallbacks
): Promise<string> {
  const url = config.baseUrl.replace(/\/+$/, '') + '/v1/chat/completions'

  const body = {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    top_p: config.topP,
    stream: true
  }

  // 超时控制：结合外部 signal 和 timeoutMs
  const controller = new AbortController()
  const { signal: externalSignal, timeoutMs } = options || {}

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason)
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true })
    }
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs && timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), timeoutMs)
  }

  console.log('[callAI] 请求:', url, 'model:', config.model, timeoutMs ? `timeout:${timeoutMs}ms` : '')

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    console.log('[callAI] 响应状态:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API 请求失败: ${response.status} ${errorText}`)
    }

    if (!response.body) {
      throw new Error('响应体为空')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    let chunkCount = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        console.log('[callAI] 流结束, chunks:', chunkCount, '总长度:', fullText.length)
        break
      }

      chunkCount++
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue

        try {
          const json = JSON.parse(trimmed.slice(6))
          const delta = json.choices?.[0]?.delta
          if (delta?.content) {
            fullText += delta.content
            callbacks?.onToken?.(delta.content)
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }

    callbacks?.onComplete?.(fullText)
    clearTimeout(timeoutId)
    return fullText
  } catch (error) {
    clearTimeout(timeoutId)
    const err = error instanceof Error ? error : new Error(String(error))
    console.log('[callAI] 错误:', err.message)
    callbacks?.onError?.(err)
    throw err
  }
}

/**
 * 非流式调用（用于测试连接等简单场景）
 */
export async function callAINonStream(
  config: AIProvider,
  messages: AIMessage[]
): Promise<string> {
  const url = config.baseUrl.replace(/\/+$/, '') + '/v1/chat/completions'

  const body = {
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: Math.min(config.maxTokens, 100),
    stream: false
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API 请求失败: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}
