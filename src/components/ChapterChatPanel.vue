<template>
  <div class="chat-panel">
    <!-- Header -->
    <div class="chat-header">
      <span style="font-weight: 600; font-size: 14px;">AI 讨论</span>
      <n-space :size="4">
        <n-button size="tiny" quaternary @click="handleClear">清空</n-button>
        <n-button size="tiny" quaternary @click="emit('close')">
          <template #icon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M6 18L18 6M6 6l12 12"/></svg>
          </template>
        </n-button>
      </n-space>
    </div>

    <!-- Messages -->
    <div class="chat-messages" ref="messagesContainer">
      <div v-if="messages.length === 0" class="empty-chat">
        <n-text depth="3" style="font-size: 13px; text-align: center; padding: 0 20px;">
          与 AI 探讨当前章节内容<br/>剧情、人物、写作风格皆可讨论
        </n-text>
      </div>

      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        :class="['message-row', msg.role === 'user' ? 'user-row' : 'assistant-row']"
      >
        <div :class="['message-bubble', msg.role === 'user' ? 'user-bubble' : 'assistant-bubble']">
          <div
            v-if="msg.content"
            class="message-content"
            v-html="renderMarkdown(msg.content)"
          />
          <span v-if="msg.role === 'assistant' && !msg.content && streaming && idx === messages.length - 1" class="typing-cursor">▌</span>
        </div>
      </div>
    </div>

    <!-- Input -->
    <div class="chat-input">
      <n-input
        v-model:value="userInput"
        type="textarea"
        :autosize="{ minRows: 1, maxRows: 4 }"
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        @keydown="handleKeydown"
        :disabled="!aiStore.activeProvider"
      />
      <n-button
        v-if="streaming"
        type="error"
        size="small"
        quaternary
        @click="handleStop"
        style="margin-left: 6px; flex-shrink: 0;"
      >
        停止
      </n-button>
      <n-button
        v-else
        type="primary"
        size="small"
        quaternary
        :disabled="!userInput.trim() || !aiStore.activeProvider"
        @click="handleSend"
        style="margin-left: 6px; flex-shrink: 0;"
      >
        发送
      </n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { marked } from 'marked'
import { callAI } from '@/api/ai'
import { useAIStore } from '@/stores/ai'
import type { AIMessage } from '@/types/ai'

const props = defineProps<{
  chapterContent: string
  chapterTitle: string
}>()

const emit = defineEmits<{
  close: []
}>()

const message = useMessage()
const aiStore = useAIStore()

// Chat state
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const messages = ref<ChatMessage[]>([])
const userInput = ref('')
const streaming = ref(false)
const messagesContainer = ref<HTMLElement>()
let abortController: AbortController | null = null

// Markdown rendering
marked.setOptions({ breaks: true, gfm: true })

function renderMarkdown(text: string): string {
  return marked.parse(text) as string
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

function handleClear() {
  messages.value = []
  userInput.value = ''
}

function handleStop() {
  abortController?.abort()
  abortController = null
  streaming.value = false
}

async function handleSend() {
  const text = userInput.value.trim()
  if (!text || streaming.value || !aiStore.activeProvider) return

  messages.value.push({ role: 'user', content: text })
  userInput.value = ''
  scrollToBottom()

  const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
  messages.value.push(assistantMsg)
  scrollToBottom()

  streaming.value = true
  abortController = new AbortController()

  // Build API messages with chapter context
  const systemMsg: AIMessage = {
    role: 'system',
    content: '你是一名经验丰富的中文网络小说创作顾问。请根据当前章节内容，帮助作者探讨剧情、人物、写作风格等。回复简洁有深度，使用 Markdown 格式。'
  }

  const contextMsg: AIMessage = {
    role: 'user',
    content: `当前章节「${props.chapterTitle}」内容如下：\n\n${props.chapterContent || '（暂无内容）'}`
  }

  const chatMessages: AIMessage[] = messages.value
    .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
    .slice(0, -1) // exclude the empty assistant message
    .map(m => ({ role: m.role, content: m.content }))

  const apiMessages: AIMessage[] = [systemMsg, contextMsg, ...chatMessages]

  try {
    await callAI(
      aiStore.activeProvider,
      apiMessages,
      { signal: abortController.signal },
      {
        onToken(token) {
          assistantMsg.content += token
          scrollToBottom()
        }
      }
    )
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
.chat-panel {
  width: 380px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--n-border-color);
  background: rgba(237, 232, 220, 0.6);
}

.chat-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--n-border-color);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 13px;
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

.message-content :deep(pre) {
  background: rgba(245, 240, 230, 0.6);
  border: 1px solid rgba(91, 123, 90, 0.1);
  border-radius: 6px;
  padding: 8px 10px;
  overflow-x: auto;
  margin: 6px 0;
  font-size: 12px;
}

.message-content :deep(code) {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
}

.message-content :deep(p) {
  margin: 3px 0;
}

.message-content :deep(p:first-child) {
  margin-top: 0;
}

.message-content :deep(p:last-child) {
  margin-bottom: 0;
}

.message-content :deep(ul),
.message-content :deep(ol) {
  padding-left: 18px;
  margin: 3px 0;
}

.message-content :deep(blockquote) {
  border-left: 3px solid rgba(91, 140, 90, 0.25);
  padding-left: 10px;
  color: #5C5C5C;
  margin: 6px 0;
}

.typing-cursor {
  animation: blink 1s step-end infinite;
  color: #5B8C5A;
}

@keyframes blink {
  50% { opacity: 0; }
}

.chat-input {
  flex-shrink: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--n-border-color);
  display: flex;
  align-items: flex-end;
}

.chat-input :deep(.n-input) {
  background: rgba(255, 255, 255, 0.04);
}
</style>
