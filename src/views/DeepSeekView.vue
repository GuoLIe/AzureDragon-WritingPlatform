<template>
  <div class="deepseek-page">
    <!-- Password gate -->
    <template v-if="!unlocked">
      <div class="password-gate">
        <n-card title="DeepSeek 对话" style="width: 360px;">
          <n-space vertical>
            <n-text depth="3">请输入访问密钥</n-text>
            <n-input
              v-model:value="passwordInput"
              type="password"
              placeholder="输入密钥"
              @keyup.enter="handleUnlock"
            />
          </n-space>
          <template #action>
            <n-space justify="end">
              <n-button type="primary" @click="handleUnlock">确认</n-button>
            </n-space>
          </template>
        </n-card>
      </div>
    </template>

    <!-- Main content -->
    <template v-else>
      <!-- Top bar -->
      <div class="top-bar">
        <n-space align="center" :size="12">
          <n-tag v-if="proxyStatus.running" type="success" size="small">反代运行中</n-tag>
          <n-tag v-else type="default" size="small">反代已停止</n-tag>
          <n-input
            v-model:value="proxyToken"
            placeholder="DeepSeek Bearer Token"
            size="small"
            style="width: 260px;"
          />
          <n-button
            v-if="!proxyStatus.running"
            size="small"
            type="primary"
            :loading="proxyStarting"
            :disabled="!proxyToken.trim()"
            @click="handleStartProxy"
          >
            启动反代
          </n-button>
          <n-button
            v-else
            size="small"
            type="error"
            @click="handleStopProxy"
          >
            停止
          </n-button>
          <n-button
            v-if="proxyStatus.running"
            size="small"
            @click="handleAddProvider"
          >
            添加为 Provider
          </n-button>
          <n-divider vertical />
          <n-select
            v-model:value="selectedModel"
            :options="modelOptions"
            size="small"
            style="width: 160px;"
          />
          <n-button size="small" @click="handleNewChat" :disabled="streaming">
            新对话
          </n-button>
        </n-space>
      </div>

      <!-- Messages area -->
      <div class="messages-area" ref="messagesContainer">
        <div v-if="messages.length === 0" class="empty-chat">
          <n-text depth="3" style="font-size: 16px;">开始一个新的 DeepSeek 对话</n-text>
        </div>

        <div
          v-for="(msg, idx) in messages"
          :key="idx"
          :class="['message-row', msg.role === 'user' ? 'user-row' : 'assistant-row']"
        >
          <div :class="['message-bubble', msg.role === 'user' ? 'user-bubble' : 'assistant-bubble']">
            <!-- Reasoning (thinking) -->
            <template v-if="msg.reasoning">
              <div class="reasoning-block" @click="toggleReasoning(idx)">
                <span class="reasoning-label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                  思考过程
                </span>
                <span class="reasoning-toggle">{{ expandedReasoning[idx] ? '收起' : '展开' }}</span>
              </div>
              <div v-if="expandedReasoning[idx]" class="reasoning-content" v-html="renderMarkdown(msg.reasoning)"></div>
            </template>

            <!-- Main content -->
            <div v-if="msg.content" class="message-content" v-html="renderMarkdown(msg.content)"></div>
            <span v-if="msg.role === 'assistant' && !msg.content && streaming && idx === messages.length - 1" class="typing-cursor">▌</span>
          </div>
        </div>
      </div>

      <!-- Input area -->
      <div class="input-area">
        <n-input
          v-model:value="userInput"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 6 }"
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          @keydown="handleKeydown"
          :disabled="!proxyStatus.running"
        />
        <n-button
          v-if="streaming"
          type="error"
          size="small"
          @click="handleStop"
          style="margin-left: 8px; flex-shrink: 0;"
        >
          停止
        </n-button>
        <n-button
          v-else
          type="primary"
          size="small"
          :disabled="!userInput.trim() || !proxyStatus.running"
          @click="handleSend"
          style="margin-left: 8px; flex-shrink: 0;"
        >
          发送
        </n-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, nextTick, onMounted } from 'vue'
import { useMessage } from 'naive-ui'
import { marked } from 'marked'
import { deepseekProxy } from '@/utils/fileAPI'
import { useAIStore } from '@/stores/ai'

const message = useMessage()
const aiStore = useAIStore()

// Password gate
const UNLOCK_KEY = 'deepseek-unlocked'
const PASSWORD = '123'
const unlocked = ref(sessionStorage.getItem(UNLOCK_KEY) === 'true')
const passwordInput = ref('')

function handleUnlock() {
  if (passwordInput.value === PASSWORD) {
    sessionStorage.setItem(UNLOCK_KEY, 'true')
    unlocked.value = true
    message.success('验证通过')
  } else {
    message.error('密钥错误')
  }
}

// Proxy management
const proxyToken = ref('')
const proxyStarting = ref(false)
const proxyStatus = ref({ running: false, pid: null as number | null })

onMounted(async () => {
  try {
    // Load saved config (token + model) and auto-start proxy
    const config = await deepseekProxy.loadConfig()
    if (config.token) {
      proxyToken.value = config.token
    }
    if (config.model) {
      selectedModel.value = config.model
    }
    // Auto-start proxy if token exists
    if (config.token) {
      const status = await deepseekProxy.status()
      if (!status.running) {
        proxyStarting.value = true
        const result = await deepseekProxy.start(config.token)
        if (result.success) {
          proxyStatus.value = { running: true, pid: result.pid || null }
        }
        proxyStarting.value = false
      } else {
        proxyStatus.value = status
      }
    } else {
      proxyStatus.value = await deepseekProxy.status()
    }
  } catch { /* ignore */ }
})

async function handleStartProxy() {
  if (!proxyToken.value.trim()) {
    message.warning('请输入 DeepSeek Bearer Token')
    return
  }
  proxyStarting.value = true
  try {
    const result = await deepseekProxy.start(proxyToken.value.trim())
    if (result.success) {
      proxyStatus.value = { running: true, pid: result.pid || null }
      // Save config (token + model) for next session
      await deepseekProxy.saveConfig({
        token: proxyToken.value.trim(),
        model: selectedModel.value
      })
      message.success('DeepSeek 反代已启动（配置已保存）')
    } else {
      message.error('启动失败: ' + (result.error || '未知错误'))
    }
  } catch (e: any) {
    message.error('启动失败: ' + e.message)
  } finally {
    proxyStarting.value = false
  }
}

async function handleStopProxy() {
  try {
    await deepseekProxy.stop()
    proxyStatus.value = { running: false, pid: null }
    message.success('已停止')
  } catch (e: any) {
    message.error('停止失败: ' + e.message)
  }
}

async function handleAddProvider() {
  await aiStore.addProvider({
    name: 'DeepSeek 网页反代',
    baseUrl: 'http://127.0.0.1:5317',
    apiKey: 'any-token',
    model: selectedModel.value,
    temperature: 0.7,
    maxTokens: 8192,
    topP: 0.95,
    contextSize: 64000,
    isActive: false
  })
  message.success('已添加为 Provider')
}

// Model selection
const selectedModel = ref('deepseek-v4-flash')
const modelOptions = [
  { label: 'deepseek-v4-flash', value: 'deepseek-v4-flash' },
  { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro' },
]

// Auto-save config when model changes
watch(selectedModel, async (val) => {
  if (proxyToken.value.trim()) {
    await deepseekProxy.saveConfig({
      token: proxyToken.value.trim(),
      model: val
    })
  }
})

// Chat state
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  timestamp: number
}

const messages = ref<ChatMessage[]>([])
const userInput = ref('')
const streaming = ref(false)
const messagesContainer = ref<HTMLElement>()
const expandedReasoning = reactive<Record<number, boolean>>({})
let abortController: AbortController | null = null

// Markdown rendering
marked.setOptions({ breaks: true, gfm: true })

function renderMarkdown(text: string): string {
  return marked.parse(text) as string
}

function toggleReasoning(idx: number) {
  expandedReasoning[idx] = !expandedReasoning[idx]
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function handleNewChat() {
  messages.value = []
  userInput.value = ''
  // Clear session on proxy side to start a fresh conversation
  fetch(`http://127.0.0.1:5317/api/clear/${selectedModel.value}`, { method: 'POST' }).catch(() => {})
}

function handleStop() {
  abortController?.abort()
  abortController = null
  streaming.value = false
}

async function handleSend() {
  const text = userInput.value.trim()
  if (!text || !proxyStatus.value.running || streaming.value) return

  // Add user message
  messages.value.push({ role: 'user', content: text, timestamp: Date.now() })
  userInput.value = ''
  scrollToBottom()

  // Add empty assistant message
  const assistantMsg: ChatMessage = { role: 'assistant', content: '', reasoning: '', timestamp: Date.now() }
  messages.value.push(assistantMsg)
  scrollToBottom()

  streaming.value = true
  abortController = new AbortController()

  // Build messages for API (exclude timestamp)
  const apiMessages = messages.value
    .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
    .slice(0, -1) // exclude the empty assistant message
    .map(m => ({ role: m.role, content: m.content }))

  try {
    const response = await fetch('http://127.0.0.1:5317/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel.value,
        messages: apiMessages,
        stream: true,
        continue_conversation: true,
      }),
      signal: abortController.signal,
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`${response.status} ${errText}`)
    }

    if (!response.body) throw new Error('响应体为空')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

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
          if (!delta) continue

          if (delta.reasoning_content) {
            assistantMsg.reasoning = (assistantMsg.reasoning || '') + delta.reasoning_content
          }
          if (delta.content) {
            assistantMsg.content += delta.content
          }
          scrollToBottom()
        } catch { /* skip unparseable */ }
      }
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') {
      message.error('请求失败: ' + e.message)
      assistantMsg.content += '\n\n[请求中断: ' + e.message + ']'
    }
  } finally {
    streaming.value = false
    abortController = null
    scrollToBottom()
  }
}
</script>

<style scoped>
.deepseek-page {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.password-gate {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.top-bar {
  flex-shrink: 0;
  padding: 8px 16px;
  background: rgba(237, 232, 220, 0.95);
  border-bottom: 1px solid rgba(91, 123, 90, 0.12);
}

.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty-chat {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.message-row {
  display: flex;
}

.user-row {
  justify-content: flex-end;
}

.assistant-row {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 75%;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.user-bubble {
  background: rgba(91, 140, 90, 0.08);
  border: 1px solid rgba(91, 140, 90, 0.15);
  border-bottom-right-radius: 2px;
}

.assistant-bubble {
  background: rgba(245, 240, 230, 0.8);
  border: 1px solid rgba(91, 123, 90, 0.1);
  border-bottom-left-radius: 2px;
}

.reasoning-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  margin-bottom: 8px;
  background: rgba(91, 123, 90, 0.04);
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}

.reasoning-block:hover {
  background: rgba(91, 123, 90, 0.08);
}

.reasoning-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #5C5C5C;
}

.reasoning-toggle {
  font-size: 11px;
  color: rgba(91, 140, 90, 0.6);
}

.reasoning-content {
  padding: 8px 10px;
  margin-bottom: 8px;
  font-size: 13px;
  color: #5C5C5C;
  font-style: italic;
  border-left: 2px solid rgba(91, 123, 90, 0.15);
  max-height: 300px;
  overflow-y: auto;
}

.message-content :deep(pre) {
  background: rgba(245, 240, 230, 0.6);
  border: 1px solid rgba(91, 123, 90, 0.1);
  border-radius: 6px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 8px 0;
}

.message-content :deep(code) {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 13px;
}

.message-content :deep(p) {
  margin: 4px 0;
}

.message-content :deep(p:first-child) {
  margin-top: 0;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-content :deep(ul),
.message-content :deep(ol) {
  padding-left: 20px;
  margin: 4px 0;
}

.message-content :deep(blockquote) {
  border-left: 3px solid rgba(91, 140, 90, 0.25);
  padding-left: 12px;
  color: #5C5C5C;
  margin: 8px 0;
}

.typing-cursor {
  animation: blink 1s step-end infinite;
  color: #5B8C5A;
}

@keyframes blink {
  50% { opacity: 0; }
}

.input-area {
  flex-shrink: 0;
  padding: 12px 16px;
  background: rgba(237, 232, 220, 0.95);
  border-top: 1px solid rgba(91, 123, 90, 0.12);
  display: flex;
  align-items: flex-end;
}

.input-area :deep(.n-input) {
  background: rgba(245, 240, 230, 0.8);
}
</style>
