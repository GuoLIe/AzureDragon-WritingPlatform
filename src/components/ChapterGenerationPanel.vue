<template>
  <div class="gen-panel">
    <n-button
      size="small"
      block
      type="primary"
      :loading="chapterStore.loading"
      style="margin-bottom: 12px;"
      @click="handleAutoPipeline"
    >
      一键自动生成
    </n-button>
    <n-steps vertical :current="currentStep" size="small">
      <!-- Step 1: Generate Outline -->
      <n-step title="生成细纲">
        <template #description>
          <n-space vertical size="small" style="margin-top: 8px;">
            <n-button size="small" block :loading="chapterStore.loading" @click="handleGenOutline">
              生成细纲
            </n-button>
            <n-input
              v-if="outlineResult"
              v-model:value="outlineResult"
              type="textarea"
              :autosize="{ minRows: 4, maxRows: 12 }"
              placeholder="细纲内容"
            />
            <n-button v-if="outlineResult" size="small" type="primary" block @click="acceptOutline">
              应用细纲
            </n-button>
          </n-space>
        </template>
      </n-step>

      <!-- Step 2: Generate Content -->
      <n-step title="生成正文">
        <template #description>
          <n-space vertical size="small" style="margin-top: 8px;">
            <n-button
              size="small"
              block
              :loading="chapterStore.loading"
              :disabled="!chapterOutline"
              @click="handleGenContent"
            >
              生成正文
            </n-button>
            <n-progress
              v-if="generatingContent"
              type="line"
              :show-indicator="false"
              status="success"
            />
            <n-text v-if="generatingContent" depth="3" style="font-size: 12px;">
              正在生成... {{ streamingText.length }} 字
            </n-text>
          </n-space>
        </template>
      </n-step>

      <!-- Step 3: Polish -->
      <n-step title="AI 润色">
        <template #description>
          <n-space vertical size="small" style="margin-top: 8px;">
            <n-button
              size="small"
              block
              :loading="chapterStore.loading"
              :disabled="!hasContent"
              @click="handlePolish"
            >
              AI 润色
            </n-button>
          </n-space>
        </template>
      </n-step>

      <!-- Step 4: De-AI -->
      <n-step title="去 AI 味">
        <template #description>
          <n-space vertical size="small" style="margin-top: 8px;">
            <n-button
              size="small"
              block
              :loading="chapterStore.loading"
              :disabled="!hasContent"
              @click="handleDeAI"
            >
              去 AI 味
            </n-button>
          </n-space>
        </template>
      </n-step>
    </n-steps>

    <!-- Pipeline Result Preview -->
    <n-card v-if="aiPreview" :title="previewTitle" size="small" style="margin-top: 12px;">
      <n-input
        v-model:value="aiPreview"
        type="textarea"
        :autosize="{ minRows: 6, maxRows: 20 }"
      />
      <template #action>
        <n-space justify="end">
          <n-button size="small" @click="aiPreview = ''">关闭</n-button>
          <n-button v-if="canApplyPreview" size="small" type="primary" @click="acceptAIPreview">应用</n-button>
        </n-space>
      </template>
    </n-card>

    <!-- Abort Button -->
    <n-button
      v-if="chapterStore.loading"
      block
      type="error"
      quaternary
      size="small"
      style="margin-top: 8px;"
      @click="abortGeneration"
    >
      停止生成
    </n-button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMessage } from 'naive-ui'
import { useChapterStore } from '@/stores/chapter'
import { useVolumeStore } from '@/stores/volume'

const props = defineProps<{
  volumeId: string
  chapterId: string
  chapterOutline: string
  hasContent: boolean
}>()

const emit = defineEmits<{
  'update:outline': [value: string]
  'update:content': [value: string]
  'update:title': [value: string]
  'set-status': [status: string]
}>()

const message = useMessage()
const chapterStore = useChapterStore()
const volumeStore = useVolumeStore()

const volumeOutline = computed(() => {
  const vol = volumeStore.volumes.find(v => v.id === props.volumeId)
  return vol?.outline || ''
})

const currentStep = ref(1)
const outlineResult = ref('')
const aiPreview = ref('')
const streamingText = ref('')
const generatingContent = ref(false)
const previewTitle = ref('AI 输出预览')
const canApplyPreview = ref(true)
let abortController: AbortController | null = null

function abortGeneration() {
  abortController?.abort()
  abortController = null
  generatingContent.value = false
}

async function handleAutoPipeline() {
  outlineResult.value = ''
  try {
    await chapterStore.generateOutline(props.volumeId, props.chapterId, volumeOutline.value, (token) => {
      outlineResult.value += token
    })
    currentStep.value = 1
  } catch (e: any) {
    if (e.name !== 'AbortError') message.error('细纲生成失败: ' + e.message)
    return
  }

  emit('update:outline', outlineResult.value)

  streamingText.value = ''
  generatingContent.value = true
  try {
    await chapterStore.generateContent(
      props.volumeId,
      props.chapterId,
      outlineResult.value,
      (token) => {
        streamingText.value += token
        emit('update:content', streamingText.value)
      }
    )
    currentStep.value = 2
    emit('set-status', 'generated')
    message.success('自动生成完成：细纲 + 正文已生成')
  } catch (e: any) {
    if (e.name !== 'AbortError') message.error('正文生成失败: ' + e.message)
  } finally {
    generatingContent.value = false
  }
}

async function handleGenOutline() {
  outlineResult.value = ''
  try {
    await chapterStore.generateOutline(props.volumeId, props.chapterId, volumeOutline.value, (token) => {
      outlineResult.value += token
    })
    currentStep.value = 1
  } catch (e: any) {
    if (e.name !== 'AbortError') message.error('生成失败: ' + e.message)
  }
}

function acceptOutline() {
  emit('update:outline', outlineResult.value)
  message.success('细纲已应用')
  currentStep.value = 2
}

async function handleGenContent() {
  streamingText.value = ''
  generatingContent.value = true
  try {
    await chapterStore.generateContent(
      props.volumeId,
      props.chapterId,
      props.chapterOutline,
      (token) => {
        streamingText.value += token
        emit('update:content', streamingText.value)
      }
    )
    currentStep.value = 2
    emit('set-status', 'generated')
  } catch (e: any) {
    if (e.name !== 'AbortError') message.error('生成失败: ' + e.message)
  } finally {
    generatingContent.value = false
  }
}

async function handlePolish() {
  aiPreview.value = ''
  previewTitle.value = 'AI 润色结果'
  canApplyPreview.value = true
  try {
    await chapterStore.polishContent(
      chapterStore.currentContent,
      (token) => {
        aiPreview.value += token
      }
    )
    currentStep.value = 3
  } catch (e: any) {
    message.error('润色失败: ' + e.message)
  }
}

async function handleDeAI() {
  aiPreview.value = ''
  previewTitle.value = '去 AI 味结果'
  canApplyPreview.value = true
  try {
    await chapterStore.deAIContent(
      chapterStore.currentContent,
      (token) => {
        aiPreview.value += token
      }
    )
    currentStep.value = 4
    emit('set-status', 'de_ai')
  } catch (e: any) {
    message.error('去AI味失败: ' + e.message)
  }
}

function acceptAIPreview() {
  emit('update:content', aiPreview.value)
  aiPreview.value = ''
  message.success('已应用 AI 输出')
}
</script>

<style scoped>
.gen-panel {
  padding: 16px;
  overflow-y: auto;
  height: 100%;
}
</style>
