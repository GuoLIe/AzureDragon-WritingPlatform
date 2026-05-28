<template>
  <div class="volume-outline-page">
    <div class="editor-header">
      <n-space align="center">
        <h3 style="margin: 0;">{{ volume?.name }} - 卷纲</h3>
        <n-text depth="3" style="font-size: 12px;">{{ wordCount }} 字</n-text>
      </n-space>
      <n-space>
        <n-button size="small" :loading="chapterStore.loading" @click="handleGenOutline">
          AI 生成卷纲
        </n-button>
        <n-button size="small" type="primary" @click="handleSave">保存</n-button>
      </n-space>
    </div>

    <div class="editor-body">
      <n-input
        v-model:value="outlineText"
        type="textarea"
        placeholder="在此编写卷纲，描述本卷各章节的主要内容..."
        @blur="handleSave"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useVolumeStore } from '@/stores/volume'
import { useChapterStore } from '@/stores/chapter'
import { countWords } from '@/utils/wordCount'

const props = defineProps<{
  volumeId: string
}>()

const message = useMessage()
const volumeStore = useVolumeStore()
const chapterStore = useChapterStore()

const volume = computed(() => volumeStore.volumes.find(v => v.id === props.volumeId))
const outlineText = ref('')

const wordCount = computed(() => countWords(outlineText.value))

watch(() => props.volumeId, (id) => {
  const vol = volumeStore.volumes.find(v => v.id === id)
  outlineText.value = vol?.outline || ''
}, { immediate: true })

async function handleSave() {
  if (!props.volumeId) return
  await volumeStore.updateVolume(props.volumeId, { outline: outlineText.value })
  message.success('卷纲已保存')
}

async function handleGenOutline() {
  if (!volume.value?.description) {
    message.warning('请先填写卷描述')
    return
  }
  outlineText.value = ''
  try {
    await chapterStore.generateVolumeOutline(volume.value.description, (token) => {
      outlineText.value += token
    })
  } catch (e: any) {
    message.error('生成失败: ' + e.message)
  }
}
</script>

<style scoped>
.volume-outline-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--n-border-color);
  flex-shrink: 0;
}

.editor-body {
  flex: 1;
  overflow: hidden;
  padding: 16px;
  display: flex;
  flex-direction: column;
}

.editor-body :deep(.n-input) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.editor-body :deep(.n-input .n-input-wrapper) {
  flex: 1;
  display: flex;
}

.editor-body :deep(.n-input textarea) {
  flex: 1;
  resize: none;
}
</style>
