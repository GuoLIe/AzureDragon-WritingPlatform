<template>
  <div class="editor-page" v-if="chapter">
    <div class="editor-header">
      <n-space align="center">
        <n-input
          v-model:value="chapter.title"
          style="width: 300px;"
          placeholder="章节标题"
          @blur="handleSave"
        />
        <n-tag size="small" :type="getStatusType(chapter.status)">
          {{ CHAPTER_STATUS_LABELS[chapter.status] }}
        </n-tag>
      </n-space>
      <n-space :size="6">
        <n-button size="small" type="primary" ghost :loading="chapterStore.loading" @click="handleAutoPipeline">一键自动生成</n-button>
        <n-button size="small" :loading="chapterStore.loading" @click="handleGenOutline">生成细纲</n-button>
        <n-button size="small" :loading="chapterStore.loading" :disabled="!chapter.outline" @click="handleGenContent">生成正文</n-button>
        <n-button size="small" :loading="chapterStore.loading" :disabled="!content" @click="handlePolish">AI润色</n-button>
        <n-button size="small" :loading="chapterStore.loading" :disabled="!content" @click="handleDeAI">去AI味</n-button>
        <n-button size="small" type="primary" @click="handleSave">保存</n-button>
        <n-popconfirm @positive-click="handleDelete">
          <template #trigger>
            <n-button size="small" type="error" quaternary>删除</n-button>
          </template>
          确定删除此章节吗？
        </n-popconfirm>
        <n-button size="small" quaternary @click="showChat = !showChat">
          {{ showChat ? '收起讨论' : 'AI 讨论' }}
        </n-button>
      </n-space>
    </div>

    <div class="editor-body">
      <div class="editor-tabs">
        <n-tabs v-model:value="activeTab" type="line" class="fill-tabs">
          <n-tab-pane name="content" tab="正文">
            <div class="tab-fill">
              <!-- AI Tools Bar -->
              <div class="ai-tools-bar">
                <n-space :size="8">
                  <n-button size="small" :loading="chapterStore.loading" :disabled="!content" @click="handleGenSummary">
                    摘要
                  </n-button>
                  <n-button size="small" :loading="chapterStore.loading" :disabled="!content" @click="handleConsistency">
                    一致性检查
                  </n-button>
                  <n-button size="small" :loading="chapterStore.loading" @click="handleWritingAssistant">
                    卡文助手
                  </n-button>
                  <n-button size="small" :loading="chapterStore.loading" :disabled="!chapter.outline" @click="handleGenTitle">
                    AI 标题
                  </n-button>
                </n-space>
              </div>

              <!-- AI Result Preview -->
              <n-card v-if="aiPreview" :title="aiPreviewTitle" size="small" style="margin: 8px 0;">
                <n-input
                  v-model:value="aiPreview"
                  type="textarea"
                  :autosize="{ minRows: 4, maxRows: 12 }"
                />
                <template #action>
                  <n-space justify="end">
                    <n-button size="small" @click="aiPreview = ''">关闭</n-button>
                    <n-button v-if="aiPreviewCanApply" size="small" type="primary" @click="applyAIPreview">应用</n-button>
                  </n-space>
                </template>
              </n-card>

              <!-- Title Options -->
              <n-card v-if="titleOptions.length > 0" title="AI 标题建议" size="small" style="margin: 8px 0;">
                <n-space :size="8">
                  <n-button
                    v-for="(t, i) in titleOptions"
                    :key="i"
                    size="small"
                    quaternary
                    @click="applyTitle(t)"
                  >
                    {{ t }}
                  </n-button>
                </n-space>
              </n-card>

              <!-- Editor -->
              <div class="editor-content">
                <markdown-editor
                  v-model="content"
                  :show-preview="false"
                  @save="handleSave"
                />
              </div>
            </div>
          </n-tab-pane>
          <n-tab-pane name="outline" tab="细纲">
            <div class="tab-fill">
              <n-input
                v-model:value="chapter.outline"
                type="textarea"
                placeholder="在此编写章节细纲..."
                @blur="handleSave"
                style="flex: 1; min-height: 120px;"
              />
              <!-- Plot Hooks Reference -->
              <template v-if="hasHooksToShow">
                <n-divider style="margin: 8px 0;" />
                <div class="hook-ref-panel">
                  <div style="font-size: 12px; font-weight: 600; color: #FF9800; margin-bottom: 6px;">🎯 埋点参考</div>

                  <!-- Hooks planted in this chapter -->
                  <div v-if="currentChapterHooks.length > 0" style="margin-bottom: 8px;">
                    <div style="font-size: 11px; color: #999; margin-bottom: 4px;">本章设置的埋点：</div>
                    <n-space :size="4" wrap>
                      <n-tag
                        v-for="hook in currentChapterHooks"
                        :key="hook.id"
                        :type="hookTypeTag(hook.type)"
                        size="tiny"
                        closable
                        @close="handleDeleteHook(hook.id)"
                      >
                        {{ hookTypeLabel(hook.type) }}：{{ hook.description }}
                      </n-tag>
                    </n-space>
                  </div>

                  <!-- Unresolved hooks from other chapters -->
                  <div v-if="unresolvedPreviousHooks.length > 0">
                    <div style="font-size: 11px; color: #999; margin-bottom: 4px;">
                      前面章节未解决埋点（建议在细纲中考虑回收）：
                    </div>
                    <n-space :size="4" wrap>
                      <n-tag
                        v-for="hook in unresolvedPreviousHooks"
                        :key="hook.id"
                        :type="hookTypeTag(hook.type)"
                        size="tiny"
                        :bordered="false"
                      >
                        {{ hookTypeLabel(hook.type) }}：{{ hook.description }}（出自《{{ hook.volumeName }}·{{ hook.chapterTitle }}》）
                      </n-tag>
                    </n-space>
                  </div>
                </div>
              </template>
            </div>
          </n-tab-pane>
        </n-tabs>
      </div>
      <chapter-chat-panel
        v-if="showChat"
        :chapter-content="content"
        :chapter-title="chapter?.title || ''"
        @close="showChat = false"
      />
    </div>
  </div>

  <!-- Plot Hooks Confirmation Modal -->
  <n-modal v-model:show="showHookConfirm" preset="card" title="📌 未解决埋点参考" style="width: 600px; max-height: 70vh;">
    <n-space vertical size="small">
      <n-text depth="3" style="font-size: 13px;">
        以下埋点尚未解决，建议在细纲中考虑回收这些伏笔：
      </n-text>

      <n-list v-if="unresolvedPreviousHooks.length > 0" style="max-height: 350px; overflow-y: auto;">
        <n-list-item v-for="hook in unresolvedPreviousHooks" :key="hook.id">
          <n-thing>
            <template #header>
              <n-space align="center" size="small">
                <n-tag :type="hookTypeTag(hook.type)" size="tiny">{{ hookTypeLabel(hook.type) }}</n-tag>
                <n-tag v-if="hook.volumeId === props.volumeId" size="tiny" type="success" bordered>
                  建议在本章解决
                </n-tag>
                <span style="font-size: 13px;">{{ hook.description }}</span>
              </n-space>
            </template>
            <template #description>
              <span style="font-size: 12px; color: #999;">
                出自「{{ hook.volumeName }} · {{ hook.chapterTitle }}」
              </span>
            </template>
          </n-thing>
        </n-list-item>
      </n-list>
      <n-empty v-else description="没有未解决埋点" size="small" />

      <n-space justify="end" style="margin-top: 8px;">
        <n-button @click="showHookConfirm = false">取消</n-button>
        <n-button type="primary" @click="confirmGenOutline">继续生成细纲</n-button>
      </n-space>
    </n-space>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useChapterStore } from '@/stores/chapter'
import { useVolumeStore } from '@/stores/volume'
import { usePlotHookStore } from '@/stores/plothook'
import { CHAPTER_STATUS_LABELS } from '@/types/chapter'
import type { ChapterStatus, PlotHook } from '@/types/chapter'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import ChapterChatPanel from '@/components/ChapterChatPanel.vue'

const props = defineProps<{
  volumeId: string
  chapterId: string
}>()

const emit = defineEmits<{
  deleted: []
}>()

const message = useMessage()
const chapterStore = useChapterStore()
const volumeStore = useVolumeStore()

const activeTab = ref('content')
const showChat = ref(false)

// AI tools state
const aiPreview = ref('')
const aiPreviewTitle = ref('')
const aiPreviewCanApply = ref(false)
const titleOptions = ref<string[]>([])

const chapter = computed(() =>
  chapterStore.chapters.find(c => c.id === props.chapterId)
)

const volumeOutline = computed(() => {
  const vol = volumeStore.volumes.find(v => v.id === props.volumeId)
  return vol?.outline || ''
})

const content = ref('')

onMounted(async () => {
  if (volumeStore.volumes.length === 0) {
    await volumeStore.loadVolumes()
  }
  if (chapterStore.chapters.length === 0) {
    await chapterStore.loadChapters(props.volumeId)
  }
  if (chapter.value) {
    await chapterStore.loadChapterContent(props.volumeId, chapter.value.filename)
    content.value = chapterStore.currentContent
  }
  // Load plot hooks
  loadPlotHooks()
})

watch(() => props.chapterId, async (newId) => {
  if (!newId) return
  activeTab.value = 'content'
  aiPreview.value = ''
  titleOptions.value = []
  if (chapterStore.chapters.length === 0) {
    await chapterStore.loadChapters(props.volumeId)
  }
  const ch = chapterStore.chapters.find(c => c.id === newId)
  if (ch) {
    await chapterStore.loadChapterContent(props.volumeId, ch.filename)
    content.value = chapterStore.currentContent
  }
})

// Plot hooks reference
const hookStore = usePlotHookStore()
const allHooks = computed(() => hookStore.hooks)

const currentChapterHooks = computed(() =>
  allHooks.value.filter(h => h.chapterId === props.chapterId)
)

const unresolvedPreviousHooks = computed(() =>
  allHooks.value.filter(h =>
    h.chapterId !== props.chapterId && h.status === 'unresolved'
  )
)

const hasHooksToShow = computed(() =>
  currentChapterHooks.value.length > 0 || unresolvedPreviousHooks.value.length > 0
)

function hookTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    foreshadowing: '伏笔', mystery: '悬念', setup: '设定铺垫',
    cliffhanger: '结尾悬念', promise: '承诺'
  }
  return labels[type] || type
}

function hookTypeTag(type: string): 'warning' | 'info' | 'primary' | 'error' | 'success' {
  const tags: Record<string, 'warning' | 'info' | 'primary' | 'error' | 'success'> = {
    foreshadowing: 'warning', mystery: 'info', setup: 'primary',
    cliffhanger: 'error', promise: 'success'
  }
  return tags[type] || 'default'
}

async function loadPlotHooks() {
  try {
    await hookStore.loadHooks()
  } catch { /* non-critical */ }
}

async function handleDeleteHook(hookId: string) {
  await hookStore.deleteHook(hookId)
}

function getStatusType(status: ChapterStatus): 'default' | 'success' | 'info' | 'warning' {
  const map: Record<ChapterStatus, 'default' | 'success' | 'info' | 'warning'> = {
    outline: 'default', generated: 'info', polished: 'warning', de_ai: 'success', final: 'success'
  }
  return map[status]
}

async function handleSave() {
  if (!chapter.value) return
  chapterStore.currentContent = content.value
  await chapterStore.saveChapterContent(props.volumeId, chapter.value)
  message.success('已保存')
}

// Pipeline buttons
async function handleAutoPipeline() {
  // Step 1: Generate outline
  chapter.value!.outline = ''
  try {
    await chapterStore.generateOutline(props.volumeId, props.chapterId, volumeOutline.value, (token) => {
      chapter.value!.outline += token
    })
  } catch (e: any) {
    if (e.name !== 'AbortError') message.error('细纲生成失败: ' + e.message)
    return
  }

  // Step 2: Generate content
  content.value = ''
  try {
    await chapterStore.generateContent(props.volumeId, props.chapterId, chapter.value!.outline, (token) => {
      content.value += token
    })
    chapter.value!.status = 'generated'
    await handleSave()
    message.success('一键生成完成')
  } catch (e: any) {
    if (e.name === 'TypeError' && e.message === 'Failed to fetch') {
      message.error('正文生成失败：无法连接到 AI 服务，请检查 API 地址和网络连接')
    } else if (e.name !== 'AbortError') {
      message.error('正文生成失败: ' + e.message)
    }
  }
}

const showHookConfirm = ref(false)

async function handleGenOutline() {
  // Load plot hooks and check for unresolved hooks
  await loadPlotHooks()
  if (unresolvedPreviousHooks.value.length > 0) {
    showHookConfirm.value = true
  } else {
    // No unresolved hooks, proceed directly
    await doGenOutline()
  }
}

async function confirmGenOutline() {
  showHookConfirm.value = false
  await doGenOutline()
}

async function doGenOutline() {
  try {
    chapter.value!.outline = ''
    await chapterStore.generateOutline(props.volumeId, props.chapterId, volumeOutline.value, (token) => {
      chapter.value!.outline += token
    })
    await handleSave()
    message.success('细纲已生成')
  } catch (e: any) {
    if (e.name !== 'AbortError') message.error('生成失败: ' + e.message)
  }
}

async function handleGenContent() {
  const originalContent = content.value
  try {
    content.value = ''
    await chapterStore.generateContent(props.volumeId, props.chapterId, chapter.value!.outline, (token) => {
      content.value += token
    })
    chapter.value!.status = 'generated'
    await handleSave()
    message.success('正文已生成')
  } catch (e: any) {
    // Restore original content on failure
    if (content.value === '') content.value = originalContent
    if (e.name === 'TypeError' && e.message === 'Failed to fetch') {
      message.error('生成失败：无法连接到 AI 服务，请检查 API 地址和网络连接')
    } else if (e.name !== 'AbortError') {
      message.error('生成失败: ' + e.message)
    }
  }
}

async function handlePolish() {
  // Sync latest editor content to store before API call
  chapterStore.currentContent = content.value
  const originalContent = content.value

  try {
    content.value = ''
    await chapterStore.polishContent(chapterStore.currentContent, (token) => {
      content.value += token
    })
    chapter.value!.status = 'polished'
    await handleSave()
    message.success('润色完成')
  } catch (e: any) {
    // Restore original content if API failed and nothing was streamed back
    if (e.name === 'TypeError' && e.message === 'Failed to fetch') {
      message.error('润色失败：无法连接到 AI 服务，请检查 API 地址和网络连接')
    } else {
      message.error('润色失败: ' + e.message)
    }
    if (content.value === '') content.value = originalContent
  }
}

async function handleDeAI() {
  // Sync latest editor content to store before API call
  chapterStore.currentContent = content.value
  const originalContent = content.value

  try {
    content.value = ''
    await chapterStore.deAIContent(chapterStore.currentContent, (token) => {
      content.value += token
    })
    chapter.value!.status = 'de_ai'
    await handleSave()
    message.success('去AI味完成')
  } catch (e: any) {
    // Restore original content if API failed
    if (e.name === 'TypeError' && e.message === 'Failed to fetch') {
      message.error('去AI味失败：无法连接到 AI 服务，请检查 API 地址和网络连接')
    } else {
      message.error('去AI味失败: ' + e.message)
    }
    if (content.value === '') content.value = originalContent
  }
}

async function handleDelete() {
  if (!chapter.value) return
  try {
    await chapterStore.deleteChapter(props.volumeId, props.chapterId)
    emit('deleted')
    message.success('章节已删除')
  } catch (e: any) {
    message.error('删除失败: ' + e.message)
  }
}

// AI Tools
async function handleGenSummary() {
  aiPreview.value = ''
  aiPreviewTitle.value = '章节摘要'
  aiPreviewCanApply.value = false
  try {
    await chapterStore.generateSummary(content.value, (token) => {
      aiPreview.value += token
    })
    message.success('摘要已保存到记忆系统')
  } catch (e: any) {
    message.error('生成摘要失败: ' + e.message)
  }
}

async function handleConsistency() {
  aiPreview.value = ''
  aiPreviewTitle.value = '一致性检查结果'
  aiPreviewCanApply.value = false
  try {
    await chapterStore.checkConsistency(content.value, (token) => {
      aiPreview.value += token
    })
  } catch (e: any) {
    message.error('检查失败: ' + e.message)
  }
}

async function handleWritingAssistant() {
  aiPreview.value = ''
  aiPreviewTitle.value = '卡文助手建议'
  aiPreviewCanApply.value = false
  try {
    await chapterStore.getWritingSuggestions(content.value, (token) => {
      aiPreview.value += token
    })
  } catch (e: any) {
    message.error('获取建议失败: ' + e.message)
  }
}

async function handleGenTitle() {
  titleOptions.value = []
  try {
    const result = await chapterStore.generateTitles(
      chapter.value?.outline || '',
      content.value.slice(0, 500)
    )
    const jsonMatch = result.match(/\[[\s\S]*?\]/)
    if (jsonMatch) {
      const titles = JSON.parse(jsonMatch[0])
      if (Array.isArray(titles)) {
        titleOptions.value = titles
        message.success('已生成标题建议')
      }
    }
  } catch (e: any) {
    message.error('生成标题失败: ' + e.message)
  }
}

function applyTitle(title: string) {
  if (chapter.value) chapter.value.title = title
  titleOptions.value = []
  message.success('已应用标题')
}

function applyAIPreview() {
  content.value = aiPreview.value
  aiPreview.value = ''
  message.success('已应用 AI 输出')
}
</script>

<style scoped>
.editor-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--n-border-color);
  flex-shrink: 0;
}

.editor-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.editor-tabs {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.fill-tabs {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.fill-tabs :deep(.n-tabs-nav) {
  flex-shrink: 0;
}

.fill-tabs :deep(.n-tab-pane) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-fill {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-tools-bar {
  flex-shrink: 0;
  padding: 8px 0;
  border-bottom: 1px solid var(--n-border-color);
}

.editor-content {
  flex: 1;
  overflow: hidden;
}

.tab-fill :deep(.n-input) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.tab-fill :deep(.n-input .n-input-wrapper) {
  flex: 1;
  display: flex;
}

.tab-fill :deep(.n-input textarea) {
  flex: 1;
  resize: none;
}

.hook-ref-panel {
  flex-shrink: 0;
  max-height: 200px;
  overflow-y: auto;
  padding: 4px 0;
  border-top: 1px solid var(--n-border-color);
  margin-top: 4px;
}
</style>
