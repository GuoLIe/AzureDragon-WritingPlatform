<template>
  <div class="volumes-page">
    <!-- Left: Tree Panel -->
    <div class="tree-panel">
      <div class="tree-header">
        <n-space :size="6" align="center">
          <span style="font-weight: 600; font-size: 15px;">卷与章节</span>
          <n-button
            size="tiny"
            type="warning"
            quaternary
            :loading="writingAll"
            @click="handleOneClickWriteAll"
          >
            一键成文全部
          </n-button>
          <n-button
            v-if="selectedVolumeId"
            size="tiny"
            type="primary"
            quaternary
            @click="handleOneClickWrite(selectedVolumeId)"
          >
            一键成文本卷
          </n-button>
          <n-button
            size="tiny"
            type="info"
            quaternary
            @click="showPlotHooks = true"
          >
            埋点管理
          </n-button>
        </n-space>
        <n-space :size="4">
          <n-button size="tiny" quaternary @click="showManagement = !showManagement">
            {{ showManagement ? '树状视图' : '管理' }}
          </n-button>
          <n-button size="tiny" quaternary @click="refreshTree">
            <template #icon>
              <n-icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg></n-icon>
            </template>
            刷新
          </n-button>
          <n-button size="tiny" type="primary" @click="showCreateVolume = true">+ 卷</n-button>
        </n-space>
      </div>

      <div class="tree-body">
        <n-empty
          v-if="volumeStore.volumes.length === 0"
          description="还没有卷"
          size="small"
          style="margin-top: 40px;"
        >
          <template #extra>
            <n-space>
              <n-button size="small" @click="showCreateVolume = true">创建新卷</n-button>
              <n-button size="small" :loading="splitting" @click="handleAutoSplit">AI 分卷</n-button>
            </n-space>
          </template>
        </n-empty>

        <n-tree
          v-else
          :key="treeKey"
          block-line
          :data="treeData"
          :selected-keys="selectedKeys"
          :on-load="handleTreeLoad"
          :render-suffix="renderTreeSuffix"
          :node-props="nodeProps"
          @update:selected-keys="handleSelect"
        />
      </div>
    </div>

    <!-- Right: Content Area -->
    <div class="content-area">
      <!-- Management mode: card grid -->
      <template v-if="showManagement">
        <div class="page">
          <div class="page-header">
            <h2 class="page-title">卷管理</h2>
            <n-space>
              <n-button :loading="splitting" @click="handleAutoSplit">AI 自动分卷</n-button>
              <n-button type="primary" @click="showCreateVolume = true">创建新卷</n-button>
            </n-space>
          </div>

          <div class="card-grid">
            <div
              v-for="vol in volumeStore.volumes"
              :key="vol.id"
              class="glass-card"
            >
              <div class="card-header">
                <n-ellipsis :line-clamp="1" style="font-weight: 600; font-size: 15px;">{{ vol.name }}</n-ellipsis>
                <n-popconfirm @positive-click.stop="handleDeleteVolume(vol)">
                  <template #trigger>
                    <n-button quaternary circle size="small" @click.stop>
                      <template #icon>
                        <n-icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></n-icon>
                    </template>
                    </n-button>
                  </template>
                  确定删除「{{ vol.name }}」吗？
                </n-popconfirm>
              </div>
              <div class="card-body">
                <n-ellipsis :line-clamp="2" style="font-size: 13px; color: #5C5C5C;">
                  {{ vol.description || '暂无描述' }}
                </n-ellipsis>
                <div style="font-size: 12px; color: rgba(91, 140, 90, 0.6); margin-top: 6px;">
                  目标: {{ formatWordCount(vol.targetWordCount) }}
                </div>
                <n-space :size="8" style="margin-top: 8px;">
                  <n-button
                    size="tiny"
                    type="primary"
                    quaternary
                    @click.stop="handleOneClickWrite(vol.id)"
                  >
                    一键成文
                  </n-button>
                  <n-button
                    size="tiny"
                    quaternary
                    @click.stop="handleExportVolume(vol.id)"
                  >
                    导出TXT
                  </n-button>
                </n-space>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Chapter editor -->
      <template v-else-if="selectedVolumeId && selectedChapterId">
        <chapter-edit-panel
          :volume-id="selectedVolumeId"
          :chapter-id="selectedChapterId"
          @deleted="handleChapterDeleted"
        />
      </template>

      <!-- Volume outline editor -->
      <template v-else-if="selectedVolumeId && showVolumeOutline">
        <volume-outline-panel
          :volume-id="selectedVolumeId"
        />
      </template>

      <!-- Empty state -->
      <template v-else>
        <div class="empty-content">
          <n-empty description="点击卷查看卷纲，点击章节开始编辑" size="large" />
        </div>
      </template>
    </div>

    <!-- Create Volume Modal -->
    <n-modal v-model:show="showCreateVolume" preset="card" title="创建新卷" style="width: 480px;">
      <n-form :model="volumeForm" label-placement="left" label-width="80">
        <n-form-item label="卷名">
          <n-input v-model:value="volumeForm.name" placeholder="例: 第一卷：少年出山" />
        </n-form-item>
        <n-form-item label="描述">
          <n-input v-model:value="volumeForm.description" type="textarea" :rows="3" placeholder="这卷主要讲什么..." />
        </n-form-item>
        <n-form-item label="目标字数">
          <n-input-number v-model:value="volumeForm.targetWordCount" :min="10000" :step="50000" style="width: 100%;" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-space justify="end">
          <n-button @click="showCreateVolume = false">取消</n-button>
          <n-button type="primary" @click="handleCreateVolume">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Create Chapter Modal -->
    <n-modal v-model:show="showCreateChapter" preset="dialog" title="新建章节">
      <n-input v-model:value="newChapterTitle" placeholder="章节标题，例: 第一章 少年出山" />
      <template #action>
        <n-space>
          <n-button @click="showCreateChapter = false">取消</n-button>
          <n-button type="primary" @click="handleCreateChapter">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Auto Split Result Modal -->
    <n-modal v-model:show="showSplitResult" preset="card" title="AI 自动分卷结果" style="width: 560px;">
      <n-space vertical size="small">
        <n-card v-for="(v, i) in splitVolumes" :key="i" size="small">
          <n-space vertical size="small">
            <n-input v-model:value="v.name" size="small" placeholder="卷名" />
            <n-input v-model:value="v.description" type="textarea" :rows="2" placeholder="卷描述" />
            <n-input-number v-model:value="v.targetWordCount" size="small" :min="10000" :step="50000" />
          </n-space>
        </n-card>
      </n-space>
      <template #action>
        <n-space justify="end">
          <n-button @click="showSplitResult = false">取消</n-button>
          <n-button type="primary" @click="applySplitVolumes">批量创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- One-Click Write Progress Modal -->
    <n-modal v-model:show="showOneClickProgress" preset="card" :title="'一键成文 — ' + oneClickVolumeName" style="width: 500px;" :mask-closable="false">
      <n-space vertical size="large">
        <n-progress
          type="line"
          :percentage="oneClickTotal > 0 ? Math.round((oneClickCurrent / oneClickTotal) * 100) : 0"
          :show-indicator="true"
          :status="oneClickDone ? 'success' : 'default'"
        />
        <div style="text-align: center;">
          <n-text v-if="!oneClickDone" style="font-size: 14px;">
            {{ oneClickPhase }}：{{ oneClickChapterTitle }}
          </n-text>
          <n-text v-else style="font-size: 14px; color: #18a058;">
            完成！已生成 {{ oneClickResult.generated }} 章，共 {{ formatWordCount(oneClickResult.totalWords) }}
          </n-text>
          <div style="font-size: 12px; color: #999; margin-top: 4px;">
            {{ oneClickCurrent }} / {{ oneClickTotal }}
          </div>
        </div>
      </n-space>
      <template #action>
        <n-space justify="end">
          <n-button v-if="!oneClickDone" type="error" quaternary @click="abortOneClick">停止生成</n-button>
          <n-button v-else type="primary" @click="showOneClickProgress = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Plot Hooks Management Modal -->
    <n-modal v-model:show="showPlotHooks" preset="card" title="埋点管理（伏笔/悬念）" style="width: 700px; max-height: 80vh;" :mask-closable="true">
      <n-space vertical size="small">
        <n-alert v-if="unresolvedCount === 0" type="success" title="没有未解决埋点">
          目前没有未解决的伏笔或悬念。
        </n-alert>

        <n-tabs type="line" default-value="unresolved">
          <n-tab-pane name="unresolved" :tab="`未解决 (${unresolvedCount})`">
            <n-list v-if="unresolvedHooks.length > 0" style="max-height: 400px; overflow-y: auto;">
              <n-list-item v-for="hook in unresolvedHooks" :key="hook.id">
                <template #suffix>
                  <n-button size="tiny" type="success" secondary @click="markResolved(hook.id)">
                    已解决
                  </n-button>
                  <n-button size="tiny" type="error" quaternary @click="deletePlotHook(hook.id)" style="margin-left: 4px;">
                    删除
                  </n-button>
                </template>
                <n-thing>
                  <template #header>
                    <n-space align="center" size="small">
                      <n-tag :type="hookTypeTag(hook.type)" size="tiny">{{ hookTypeLabel(hook.type) }}</n-tag>
                      <span style="font-size: 13px;">{{ hook.description }}</span>
                    </n-space>
                  </template>
                  <template #description>
                    <span style="font-size: 12px; color: #999;">
                      出自《{{ hook.volumeName }} · {{ hook.chapterTitle }}》
                      — {{ formatDate(hook.createdAt) }}
                    </span>
                  </template>
                </n-thing>
              </n-list-item>
            </n-list>
            <n-empty v-else description="暂无未解决埋点" size="small" />
          </n-tab-pane>
          <n-tab-pane name="resolved" :tab="`已解决 (${resolvedCount})`">
            <n-list v-if="resolvedHooks.length > 0" style="max-height: 400px; overflow-y: auto;">
              <n-list-item v-for="hook in resolvedHooks" :key="hook.id">
                <n-thing>
                  <template #header>
                    <n-space align="center" size="small">
                      <n-tag :type="hookTypeTag(hook.type)" size="tiny">{{ hookTypeLabel(hook.type) }}</n-tag>
                      <span style="font-size: 13px; text-decoration: line-through; color: #999;">{{ hook.description }}</span>
                    </n-space>
                  </template>
                  <template #description>
                    <span style="font-size: 12px; color: #999;">
                      出自《{{ hook.volumeName }} · {{ hook.chapterTitle }}》
                      → 解决于《{{ hook.resolvedIn }}》
                    </span>
                  </template>
                </n-thing>
              </n-list-item>
            </n-list>
            <n-empty v-else description="暂无已解决埋点" size="small" />
          </n-tab-pane>
        </n-tabs>
      </n-space>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, h, onMounted } from 'vue'
import { NTag, NButton, NDropdown, NIcon, useMessage } from 'naive-ui'
import type { TreeOption } from 'naive-ui'
import { useVolumeStore } from '@/stores/volume'
import { useChapterStore } from '@/stores/chapter'
import { useProjectStore } from '@/stores/project'
import { useAIStore } from '@/stores/ai'
import { callAI } from '@/api/ai'
import { renderPrompt, BUILTIN_TEMPLATES } from '@/utils/promptTemplates'
import { CHAPTER_STATUS_LABELS } from '@/types/chapter'
import { fileAPI } from '@/utils/fileAPI'
import type { Volume, ChapterStatus, ChapterMeta, PlotHook } from '@/types/chapter'
import ChapterEditPanel from '@/components/ChapterEditPanel.vue'
import VolumeOutlinePanel from '@/components/VolumeOutlinePanel.vue'
import { usePlotHookStore } from '@/stores/plothook'

const message = useMessage()
const volumeStore = useVolumeStore()
const chapterStore = useChapterStore()
const projectStore = useProjectStore()
const aiStore = useAIStore()

// Tree refresh
const treeKey = ref(0)
async function refreshTree() {
  // Reload volumes from disk
  await volumeStore.loadVolumes()
  // Pre-load chapters for all volumes so tree shows children without expand
  await Promise.all(volumeStore.volumes.map(vol =>
    chapterStore.loadChaptersForVolume(vol.id)
  ))
  // Increment key to force NTree remount
  treeKey.value++
}

// Selection state
const selectedVolumeId = ref<string | null>(null)
const selectedChapterId = ref<string | null>(null)
const showVolumeOutline = ref(false)
const selectedKeys = computed(() => {
  if (selectedChapterId.value) return [`ch-${selectedChapterId.value}`]
  if (selectedVolumeId.value && showVolumeOutline.value) return [`vol-${selectedVolumeId.value}`]
  return []
})

// Management mode
const showManagement = ref(false)

// Volume creation
const showCreateVolume = ref(false)
const volumeForm = reactive({
  name: '',
  description: '',
  targetWordCount: 200000
})

// Chapter creation
const showCreateChapter = ref(false)
const newChapterTitle = ref('')
const createChapterVolumeId = ref<string | null>(null)

// Auto split
const splitting = ref(false)
const showSplitResult = ref(false)
const splitVolumes = ref<Array<{ name: string; description: string; targetWordCount: number }>>([])

// One-click write
const showOneClickProgress = ref(false)
const oneClickVolumeName = ref('')
const oneClickCurrent = ref(0)
const oneClickTotal = ref(0)
const oneClickPhase = ref('')
const oneClickChapterTitle = ref('')
const oneClickDone = ref(false)
const oneClickResult = ref({ generated: 0, totalWords: 0 })

onMounted(() => volumeStore.loadVolumes())

// Tree data
const treeData = computed<TreeOption[]>(() =>
  volumeStore.volumes.map(vol => ({
    key: `vol-${vol.id}`,
    label: vol.name,
    volumeId: vol.id,
    isLeaf: false,
    children: chapterStore.chaptersByVolume[vol.id]
      ? chapterStore.chaptersByVolume[vol.id].map(ch => ({
          key: `ch-${ch.id}`,
          label: ch.title,
          chapterId: ch.id,
          volumeId: vol.id,
          isLeaf: true,
          chData: ch
        }))
      : undefined
  }))
)

// Lazy load chapters when volume node is expanded
async function handleTreeLoad(node: TreeOption) {
  const volId = node.volumeId as string
  await chapterStore.loadChaptersForVolume(volId)
}

// Tree node click
function handleSelect(keys: Array<string | number>, options: Array<TreeOption | null>) {
  if (keys.length === 0) {
    selectedVolumeId.value = null
    selectedChapterId.value = null
    showVolumeOutline.value = false
    return
  }
  const key = keys[0] as string
  if (key.startsWith('ch-')) {
    const opt = options[0]
    if (opt) {
      selectedVolumeId.value = opt.volumeId as string
      selectedChapterId.value = opt.chapterId as string
      showVolumeOutline.value = false
      showManagement.value = false
    }
  } else if (key.startsWith('vol-')) {
    const opt = options[0]
    if (opt) {
      selectedVolumeId.value = opt.volumeId as string
      selectedChapterId.value = null
      showVolumeOutline.value = true
      showManagement.value = false
    }
  }
}

// Node props for context menu
function nodeProps({ option }: { option: TreeOption }) {
  return {
    onContextmenu(e: MouseEvent) {
      e.preventDefault()
    }
  }
}

// Custom suffix rendering
function renderTreeSuffix({ option }: { option: TreeOption }) {
  if (option.chapterId) {
    const ch = option.chData as ChapterMeta | undefined
    if (!ch) return null
    return h('span', { style: 'display: inline-flex; align-items: center; gap: 6px; margin-left: 8px;' }, [
      h(NTag, { size: 'tiny', bordered: false, type: getStatusType(ch.status) }, () => CHAPTER_STATUS_LABELS[ch.status]),
      h('span', { style: 'font-size: 11px; color: #999;' }, formatWordCount(ch.wordCount))
    ])
  }
  // Volume node - show add chapter + one-click generate buttons
  return h('span', { style: 'margin-left: 8px; display: inline-flex; gap: 2px;' }, [
    h(NButton, {
      size: 'tiny',
      quaternary: true,
      circle: true,
      onClick: (e: MouseEvent) => {
        e.stopPropagation()
        createChapterVolumeId.value = option.volumeId as string
        showCreateChapter.value = true
      }
    }, { default: () => '+' }),
    h(NButton, {
      size: 'tiny',
      quaternary: true,
      type: 'primary',
      onClick: (e: MouseEvent) => {
        e.stopPropagation()
        handleOneClickWrite(option.volumeId as string)
      }
    }, { default: () => '成文' }),
    h(NButton, {
      size: 'tiny',
      quaternary: true,
      onClick: (e: MouseEvent) => {
        e.stopPropagation()
        handleExportVolume(option.volumeId as string)
      }
    }, { default: () => '导出' })
  ])
}

function getStatusType(status: ChapterStatus): 'default' | 'success' | 'info' | 'warning' {
  const map: Record<ChapterStatus, 'default' | 'success' | 'info' | 'warning'> = {
    outline: 'default', generated: 'info', polished: 'warning', de_ai: 'success', final: 'success'
  }
  return map[status]
}

function formatWordCount(count: number) {
  return count >= 10000 ? `${(count / 10000).toFixed(1)}万字` : `${count}字`
}

// Volume actions
async function handleCreateVolume() {
  if (!volumeForm.name.trim()) {
    message.warning('请输入卷名')
    return
  }
  await volumeStore.createVolume({ ...volumeForm })
  showCreateVolume.value = false
  volumeForm.name = ''
  volumeForm.description = ''
  refreshTree()
  message.success('创建成功')
}

async function handleDeleteVolume(vol: Volume) {
  await volumeStore.deleteVolume(vol)
  if (selectedVolumeId.value === vol.id) {
    selectedVolumeId.value = null
    selectedChapterId.value = null
  }
  refreshTree()
  message.success('已删除')
}

async function handleChapterDeleted() {
  selectedVolumeId.value = null
  selectedChapterId.value = null
  await refreshTree()
}

// Chapter actions
async function handleCreateChapter() {
  if (!newChapterTitle.value.trim()) {
    message.warning('请输入标题')
    return
  }
  const volId = createChapterVolumeId.value
  if (!volId) return

  const vol = volumeStore.volumes.find(v => v.id === volId)
  await chapterStore.loadChaptersForVolume(volId, vol?.name)
  const ch = await chapterStore.createChapter(volId, newChapterTitle.value, vol?.name)
  if (ch) {
    showCreateChapter.value = false
    newChapterTitle.value = ''
    refreshTree()
    message.success('章节已创建')
  }
}

// Auto split
async function handleAutoSplit() {
  if (!aiStore.activeProvider) {
    message.warning('请先在设置中配置 AI Provider')
    return
  }
  if (!projectStore.currentProjectName) return

  splitting.value = true
  try {
    const dir = await projectStore.getProjectDir()
    let outline = ''
    try {
      outline = await fileAPI.readFile(
        await fileAPI.pathJoin(dir, 'outline', '总纲.md')
      )
    } catch {
      message.warning('请先编写总纲')
      return
    }

    const prompt = renderPrompt(BUILTIN_TEMPLATES.AUTO_VOLUME_SPLIT, { outline })
    const result = await callAI(aiStore.activeProvider, [
      { role: 'system', content: '你是一名专业的小说编辑。请以纯JSON格式输出。' },
      { role: 'user', content: prompt }
    ])

    const jsonMatch = result.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('AI 返回格式不正确')
    const data = JSON.parse(jsonMatch[0])
    if (!Array.isArray(data) || data.length === 0) throw new Error('AI 未返回有效的分卷数据')

    splitVolumes.value = data.map((v: any) => ({
      name: v.name || '',
      description: v.description || '',
      targetWordCount: v.targetWordCount || 200000
    }))
    showSplitResult.value = true
  } catch (e: any) {
    message.error('自动分卷失败: ' + (e.message || '未知错误'))
  } finally {
    splitting.value = false
  }
}

async function applySplitVolumes() {
  for (const v of splitVolumes.value) {
    if (!v.name.trim()) continue
    await volumeStore.createVolume(v)
  }
  showSplitResult.value = false
  refreshTree()
  message.success(`已创建 ${splitVolumes.value.length} 个卷`)
}

// One-click write all volumes
const writingAll = ref(false)

async function handleOneClickWriteAll() {
  if (!aiStore.activeProvider) {
    message.warning('请先在设置中配置 AI Provider')
    return
  }

  oneClickVolumeName.value = '全部卷'
  oneClickCurrent.value = 0
  oneClickTotal.value = 0
  oneClickPhase.value = ''
  oneClickChapterTitle.value = ''
  oneClickDone.value = false
  oneClickResult.value = { generated: 0, totalWords: 0 }
  showOneClickProgress.value = true
  writingAll.value = true

  try {
    const result = await chapterStore.generateAllNovelContent((info) => {
      oneClickVolumeName.value = info.volumeName
      oneClickCurrent.value = info.current
      oneClickTotal.value = info.total
      oneClickPhase.value = info.phase
      oneClickChapterTitle.value = info.chapterTitle
    })
    oneClickResult.value = result
    oneClickDone.value = true
    refreshTree()
    message.success(`一键成文完成：${result.generated} 章，共 ${formatWordCount(result.totalWords)}`)
  } catch (e: any) {
    if (e.message !== 'stopped') {
      message.error('生成失败: ' + e.message)
    }
    showOneClickProgress.value = false
  } finally {
    writingAll.value = false
  }
}

// One-click write
async function handleOneClickWrite(volumeId: string) {
  if (!aiStore.activeProvider) {
    message.warning('请先在设置中配置 AI Provider')
    return
  }

  const vol = volumeStore.volumes.find(v => v.id === volumeId)
  if (!vol) {
    message.warning('卷不存在')
    return
  }
  oneClickVolumeName.value = vol?.name || ''
  oneClickCurrent.value = 0
  oneClickTotal.value = 0
  oneClickPhase.value = ''
  oneClickChapterTitle.value = ''
  oneClickDone.value = false
  oneClickResult.value = { generated: 0, totalWords: 0 }
  showOneClickProgress.value = true

  try {
    const result = await chapterStore.generateAllContent(volumeId, (info) => {
      oneClickCurrent.value = info.current
      oneClickTotal.value = info.total
      oneClickPhase.value = info.phase
      oneClickChapterTitle.value = info.chapterTitle
    })
    oneClickResult.value = result
    oneClickDone.value = true
    refreshTree()
    message.success(`一键成文完成：${result.generated} 章，${formatWordCount(result.totalWords)}`)
  } catch (e: any) {
    if (e.message !== 'stopped') {
      message.error('生成失败: ' + e.message)
    }
    showOneClickProgress.value = false
  }
}

async function handleExportVolume(volumeId: string) {
  const vol = volumeStore.volumes.find(v => v.id === volumeId)
  if (!vol) return

  await chapterStore.loadChaptersForVolume(volumeId)
  const chapters = chapterStore.chaptersByVolume[volumeId]
  if (!chapters || chapters.length === 0) {
    message.warning('该卷没有章节')
    return
  }

  // Load all chapter contents
  const dir = await projectStore.getProjectDir()
  let output = ''
  let totalWords = 0

  for (const ch of chapters) {
    try {
      const raw = await fileAPI.readFile(
        await fileAPI.pathJoin(dir, 'volumes', vol.name, ch.filename)
      )
      const body = raw.replace(/^<!--meta:.*?-->\s*/s, '')
      output += body.trim() + '\n\n'
      totalWords += ch.wordCount
    } catch { /* skip */ }
  }

  if (!output.trim()) {
    message.warning('没有可导出的内容')
    return
  }

  const fileName = `${vol.name}.txt`

  // Electron: use save dialog
  const electronAPI = (window as any).electronAPI
  if (electronAPI) {
    const filePath = await electronAPI.saveFileDialog({
      defaultPath: fileName,
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    })
    if (!filePath) return
    await electronAPI.writeFile(filePath, output)
    message.success(`已导出 ${chapters.length} 章，共 ${formatWordCount(totalWords)}`)
  } else {
    // Browser: trigger download
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    message.success(`已导出 ${chapters.length} 章，共 ${formatWordCount(totalWords)}`)
  }
}

function abortOneClick() {
  showOneClickProgress.value = false
  refreshTree()
  message.info('已停止生成')
}

// Plot Hook Management
const showPlotHooks = ref(false)
const hookStore = usePlotHookStore()
const unresolvedHooks = computed<PlotHook[]>(() => hookStore.hooks.filter(h => h.status === 'unresolved'))
const resolvedHooks = computed<PlotHook[]>(() => hookStore.hooks.filter(h => h.status === 'resolved'))
const unresolvedCount = computed(() => unresolvedHooks.value.length)
const resolvedCount = computed(() => resolvedHooks.value.length)

async function loadPlotHooks() {
  await hookStore.loadHooks()
}

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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}

async function markResolved(hookId: string) {
  const hook = hookStore.hooks.find(h => h.id === hookId)
  if (!hook) return
  hookStore.resolveHook(hookId, '手动标记', '')
  message.success('已标记为已解决')
}

async function deletePlotHook(hookId: string) {
  await hookStore.deleteHook(hookId)
  message.success('已删除埋点')
}

// Load hooks when component mounts
onMounted(() => {
  loadPlotHooks()
})
</script>

<style scoped>
.volumes-page {
  position: absolute;
  inset: 0;
  display: flex;
}

.tree-panel {
  width: 320px;
  flex-shrink: 0;
  border-right: 1px solid var(--n-border-color);
  display: flex;
  flex-direction: column;
}

.tree-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--n-border-color);
  flex-shrink: 0;
}

.tree-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.content-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.content-area > * {
  flex: 1;
}

.empty-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 0;
}

.card-body {
  padding: 8px 20px 16px;
}
</style>
