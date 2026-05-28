<template>
  <div class="editor-wrapper">
    <div class="editor-toolbar">
      <n-button-group size="small">
        <n-button @click="insertFormat('**', '**')" title="粗体">B</n-button>
        <n-button @click="insertFormat('*', '*')" title="斜体"><i>I</i></n-button>
        <n-button @click="insertFormat('\n> ', '')" title="引用">"</n-button>
        <n-button @click="insertFormat('\n---\n', '')" title="分割线">—</n-button>
      </n-button-group>
      <n-space align="center">
        <n-text depth="3" style="font-size: 12px;">{{ wordCount }} 字</n-text>
        <n-text v-if="saving" depth="3" style="font-size: 12px;">保存中...</n-text>
        <n-text v-else-if="lastSaved" depth="3" style="font-size: 12px; color: var(--n-primary-color);">已保存</n-text>
      </n-space>
    </div>
    <div class="editor-body">
      <textarea
        ref="textareaRef"
        :value="modelValue"
        @input="handleInput"
        @keydown.ctrl.s.prevent="handleSave"
        class="editor-textarea"
        :placeholder="placeholder"
      />
      <div class="editor-preview" v-if="showPreview">
        <div class="preview-content" v-html="renderedPreview" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { marked } from 'marked'
import { countWords } from '@/utils/wordCount'

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  showPreview?: boolean
}>(), {
  placeholder: '开始写作...',
  showPreview: true
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'save': []
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const saving = ref(false)
const lastSaved = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

const wordCount = computed(() => countWords(props.modelValue))

const renderedPreview = computed(() => {
  return marked.parse(props.modelValue || '*暂无内容*') as string
})

function handleInput(e: Event) {
  const value = (e.target as HTMLTextAreaElement).value
  emit('update:modelValue', value)
  lastSaved.value = false

  // Auto-save after 2 seconds of inactivity
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    handleSave()
  }, 2000)
}

function handleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saving.value = true
  emit('save')
  setTimeout(() => {
    saving.value = false
    lastSaved.value = true
  }, 300)
}

function insertFormat(before: string, after: string) {
  const ta = textareaRef.value
  if (!ta) return
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const text = props.modelValue
  const selected = text.slice(start, end)
  const newText = text.slice(0, start) + before + selected + after + text.slice(end)
  emit('update:modelValue', newText)
  nextTick(() => {
    ta.selectionStart = start + before.length
    ta.selectionEnd = start + before.length + selected.length
    ta.focus()
  })
}

// Scroll to bottom when content changes (for streaming)
watch(() => props.modelValue.length, () => {
  if (textareaRef.value) {
    const { scrollHeight, clientHeight, scrollTop } = textareaRef.value
    if (scrollHeight - clientHeight - scrollTop < 100) {
      textareaRef.value.scrollTop = scrollHeight
    }
  }
})
</script>

<style scoped>
.editor-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--n-border-color);
  border-radius: 8px;
}

.editor-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--n-border-color);
  background: var(--n-action-color);
}

.editor-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.editor-textarea {
  flex: 1;
  padding: 20px 24px;
  border: none;
  outline: none;
  resize: none;
  font-family: var(--n-font-family-mono);
  font-size: 15px;
  line-height: 1.9;
  background: transparent;
  color: inherit;
}

.editor-preview {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
  border-left: 1px solid var(--n-border-color);
}

.preview-content {
  font-size: 16px;
  line-height: 1.8;
}

.preview-content :deep(p) {
  margin-bottom: 1em;
  text-indent: 2em;
}

.preview-content :deep(h1),
.preview-content :deep(h2),
.preview-content :deep(h3) {
  margin: 1em 0 0.5em;
  text-indent: 0;
}
</style>
