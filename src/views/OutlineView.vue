<template>
  <div class="outline-page">
    <div class="outline-tabs-header">
      <n-tabs v-model:value="activeTab" type="line" @update:value="handleTabChange">
        <n-tab-pane v-for="type in outlineTypes" :key="type" :name="type" :tab="type" />
      </n-tabs>
    </div>
    <div class="outline-tab-content">
      <div class="outline-content">
        <div class="editor-area">
          <n-input
            v-model:value="contents[activeTab]"
            type="textarea"
            placeholder="在此编写大纲..."
            @blur="handleSave"
          />
          <div class="editor-footer">
            <n-text depth="3" style="font-size: 12px;">
              {{ wordCount }} 字 | Ctrl+S 保存
            </n-text>
          </div>
        </div>
        <div class="ai-panel">
          <n-space vertical>
            <n-button block :loading="outlineStore.loading" @click="handlePolish">
              AI 润色
            </n-button>
            <n-button block :loading="outlineStore.loading" @click="handleExpand">
              AI 扩写
            </n-button>
          </n-space>

          <!-- AI Result Preview -->
          <n-card v-if="aiResult" title="AI 输出" size="small" style="margin-top: 16px;">
            <n-input
              v-model:value="aiResult"
              type="textarea"
              :autosize="{ minRows: 10, maxRows: 30 }"
            />
            <template #action>
              <n-space justify="end">
                <n-button size="small" @click="aiResult = ''">丢弃</n-button>
                <n-button size="small" @click="appendAIResult">追加</n-button>
                <n-button size="small" type="primary" @click="acceptAIResult">应用</n-button>
              </n-space>
            </template>
          </n-card>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useMessage } from 'naive-ui'
import { useOutlineStore, type OutlineType } from '@/stores/outline'
import { countWords } from '@/utils/wordCount'

const message = useMessage()
const outlineStore = useOutlineStore()

const outlineTypes: OutlineType[] = ['总纲', '世界观', '支线']
const activeTab = ref<OutlineType>('总纲')
const aiResult = ref('')

const contents = outlineStore.contents

const wordCount = computed(() => countWords(contents[activeTab.value]))

onMounted(async () => {
  for (const type of outlineTypes) {
    await outlineStore.loadOutline(type)
  }
})

function handleTabChange(type: OutlineType) {
  // auto-save previous tab
  handleSave()
}

function handleSave() {
  outlineStore.saveOutline(activeTab.value, contents[activeTab.value])
}

async function handlePolish() {
  if (!contents[activeTab.value].trim()) {
    message.warning('请先编写大纲内容')
    return
  }
  try {
    aiResult.value = ''
    const result = await outlineStore.polishOutline(activeTab.value, (token) => {
      aiResult.value += token
    })
    if (!result) aiResult.value = result
  } catch (e: any) {
    message.error('润色失败: ' + e.message)
  }
}

async function handleExpand() {
  if (!contents[activeTab.value].trim()) {
    message.warning('请先编写大纲内容')
    return
  }
  try {
    aiResult.value = ''
    await outlineStore.expandOutline(activeTab.value, (token) => {
      aiResult.value += token
    })
  } catch (e: any) {
    message.error('扩写失败: ' + e.message)
  }
}

function acceptAIResult() {
  contents[activeTab.value] = aiResult.value
  handleSave()
  aiResult.value = ''
  message.success('已应用 AI 输出')
}

function appendAIResult() {
  const current = contents[activeTab.value].trimEnd()
  const append = aiResult.value.trim()
  contents[activeTab.value] = current ? current + '\n\n' + append : append
  handleSave()
  aiResult.value = ''
  message.success('已追加 AI 输出到' + activeTab.value)
}
</script>

<style scoped>
.outline-page {
  position: absolute;
  inset: 0;
  padding: 24px;
  display: flex;
  flex-direction: column;
}

.outline-tabs-header {
  flex-shrink: 0;
}

.outline-tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.outline-content {
  display: flex;
  gap: 16px;
  height: 100%;
}

.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.editor-area :deep(.n-input) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.editor-area :deep(.n-input .n-input-wrapper) {
  flex: 1;
  display: flex;
}

.editor-area :deep(.n-input textarea) {
  flex: 1;
  resize: none;
}

.editor-footer {
  padding: 8px 0;
}

.ai-panel {
  width: 240px;
  flex-shrink: 0;
  overflow-y: auto;
}
</style>
