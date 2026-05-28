<template>
  <div class="graph-page">
    <div class="page-header">
      <h2>人物关系图谱</h2>
      <n-space>
        <n-button :loading="analyzing" @click="handleAnalyzeRelations" type="primary">
          {{ analyzing ? analyzingPhase : '自动整理关系' }}
        </n-button>
        <n-button @click="handleAddRelation">添加关系</n-button>
        <n-select
          v-model:value="layoutType"
          :options="layoutOptions"
          style="width: 120px;"
          size="small"
        />
      </n-space>
    </div>

    <div ref="containerRef" class="graph-container">
      <n-empty v-if="characters.length === 0" description="还没有人物，请先创建人物" style="margin-top: 120px;" />
    </div>

    <!-- Add Relation Modal -->
    <n-modal v-model:show="showAddRelation" preset="dialog" title="添加关系">
      <n-form :model="newRel" label-placement="left" label-width="80">
        <n-form-item label="人物A">
          <n-select v-model:value="newRel.source" :options="charOptions" placeholder="选择人物" />
        </n-form-item>
        <n-form-item label="人物B">
          <n-select v-model:value="newRel.target" :options="charOptions" placeholder="选择人物" />
        </n-form-item>
        <n-form-item label="关系类型">
          <n-select v-model:value="newRel.type" :options="relationTypeOptions" />
        </n-form-item>
        <n-form-item label="描述">
          <n-input v-model:value="newRel.description" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-space>
          <n-button @click="showAddRelation = false">取消</n-button>
          <n-button type="primary" @click="submitRelation">添加</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Analysis Result Modal -->
    <n-modal v-model:show="showAnalysisResult" preset="card" title="AI 分析的人物关系" style="width: 560px;">
      <n-space vertical size="small">
        <div v-if="newRelations.length > 0" style="margin-bottom: 8px;">
          <n-text strong style="color: #18a058;">新增关系 ({{ newRelations.length }})</n-text>
        </div>
        <n-card v-for="(r, i) in newRelations" :key="'new-'+i" size="small">
          <n-space align="center">
            <n-text strong>{{ r.source }}</n-text>
            <n-tag size="small" :color="{ color: RELATIONSHIP_COLORS[r.type as RelationshipType] + '20', textColor: RELATIONSHIP_COLORS[r.type as RelationshipType] }">
              {{ RELATIONSHIP_LABELS[r.type as RelationshipType] || r.type }}
            </n-tag>
            <n-text strong>{{ r.target }}</n-text>
          </n-space>
          <n-text depth="3" style="font-size: 12px; margin-top: 4px; display: block;">{{ r.description }}</n-text>
        </n-card>
        <div v-if="updatedRelations.length > 0" style="margin-top: 12px; margin-bottom: 8px;">
          <n-text strong style="color: #2080f0;">更新关系 ({{ updatedRelations.length }})</n-text>
        </div>
        <n-card v-for="(r, i) in updatedRelations" :key="'upd-'+i" size="small">
          <n-space align="center">
            <n-text strong>{{ r.source }}</n-text>
            <n-tag size="small" :color="{ color: RELATIONSHIP_COLORS[r.type as RelationshipType] + '20', textColor: RELATIONSHIP_COLORS[r.type as RelationshipType] }">
              {{ RELATIONSHIP_LABELS[r.type as RelationshipType] || r.type }}
            </n-tag>
            <n-text strong>{{ r.target }}</n-text>
          </n-space>
          <n-text depth="3" style="font-size: 12px; margin-top: 4px; display: block;">{{ r.description }}</n-text>
        </n-card>
      </n-space>
      <template #action>
        <n-space justify="end">
          <n-button @click="showAnalysisResult = false">取消</n-button>
          <n-button type="primary" @click="applyAnalysisResults">应用全部</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, reactive, nextTick } from 'vue'
import { useMessage } from 'naive-ui'
import { useCharacterStore } from '@/stores/character'
import { useAIStore } from '@/stores/ai'
import { useProjectStore } from '@/stores/project'
import { useChapterStore } from '@/stores/chapter'
import { useVolumeStore } from '@/stores/volume'
import { callAI } from '@/api/ai'
import { renderPrompt, BUILTIN_TEMPLATES } from '@/utils/promptTemplates'
import { RELATIONSHIP_LABELS, RELATIONSHIP_COLORS } from '@/types/character'
import type { RelationshipType } from '@/types/character'
import { Graph } from '@antv/g6'

const message = useMessage()
const characterStore = useCharacterStore()
const aiStore = useAIStore()
const projectStore = useProjectStore()
const chapterStore = useChapterStore()
const volumeStore = useVolumeStore()

const containerRef = ref<HTMLElement | null>(null)
const layoutType = ref('force')
const showAddRelation = ref(false)
const showAnalysisResult = ref(false)
const analyzing = ref(false)
const analyzingPhase = ref('分析中...')
const newRelations = ref<Array<{ source: string; target: string; type: string; description: string; strength: number }>>([])
const updatedRelations = ref<Array<{ source: string; target: string; type: string; description: string; strength: number; existingId: string }>>([])
let graph: Graph | null = null

const characters = characterStore.characters
const relationships = characterStore.relationships

const newRel = reactive({
  source: '',
  target: '',
  type: 'friend' as RelationshipType,
  description: ''
})

const layoutOptions = [
  { label: '力导向', value: 'force' },
  { label: '环形', value: 'circular' },
  { label: '层次', value: 'dagre' }
]

const charOptions = computed(() =>
  characters.map(c => ({ label: c.name || '未命名', value: c.id }))
)

const relationTypeOptions = Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => ({
  label, value
}))

function getGraphData() {
  return {
    nodes: characters.map(c => ({
      id: c.id,
      data: {
        label: c.name || '未命名',
        role: c.role
      },
      style: {
        fill: c.role === 'protagonist' ? '#faad14' : c.role === 'antagonist' ? '#ff4d4f' : '#1890ff',
        labelFill: '#fff',
        labelText: c.name || '?'
      }
    })),
    edges: relationships.map((r, i) => ({
      id: `edge-${r.id || i}`,
      source: r.source,
      target: r.target,
      data: { type: r.type },
      style: {
        stroke: RELATIONSHIP_COLORS[r.type] || '#999',
        lineWidth: Math.max(1, r.strength / 3),
        labelFontSize: 10,
        labelText: RELATIONSHIP_LABELS[r.type]
      }
    }))
  }
}

async function initGraph() {
  if (!containerRef.value || characters.length === 0) return

  if (graph) {
    graph.destroy()
  }

  graph = new Graph({
    container: containerRef.value,
    width: containerRef.value.clientWidth,
    height: containerRef.value.clientHeight,
    autoFit: 'center',
    data: getGraphData(),
    node: {
      style: {
        size: 40,
        labelText: (d: any) => d.data?.label || '?',
        labelFontSize: 12,
        labelPlacement: 'bottom',
        labelOffsetY: 8
      }
    },
    edge: {
      style: {
        endArrow: true,
        labelBackground: true,
        labelBackgroundFill: '#fff',
        labelBackgroundOpacity: 0.8,
        labelPadding: [2, 4],
        labelText: (d: any) => RELATIONSHIP_LABELS[d.data?.type as RelationshipType] || ''
      }
    },
    layout: {
      type: layoutType.value === 'force' ? 'force' : layoutType.value,
      ...(layoutType.value === 'force' ? {
        linkDistance: 200,
        nodeStrength: -200,
        edgeStrength: 0.5,
        preventOverlap: true
      } : {}),
      ...(layoutType.value === 'circular' ? { radius: 200 } : {}),
      ...(layoutType.value === 'dagre' ? { rankdir: 'TB' } : {})
    },
    behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element']
  })

  await graph.render()
}

function handleAddRelation() {
  newRel.source = ''
  newRel.target = ''
  newRel.description = ''
  showAddRelation.value = true
}

function submitRelation() {
  if (!newRel.source || !newRel.target || newRel.source === newRel.target) {
    message.warning('请选择两个不同的人物')
    return
  }
  characterStore.addRelationship({
    source: newRel.source,
    target: newRel.target,
    type: newRel.type,
    description: newRel.description,
    strength: 5
  })
  showAddRelation.value = false
  message.success('已添加关系')
  nextTick(() => initGraph())
}

async function handleAnalyzeRelations() {
  if (!aiStore.activeProvider) {
    message.warning('请先在设置中配置 AI Provider')
    return
  }

  if (characters.length < 2) {
    message.warning('至少需要 2 个人物才能分析关系')
    return
  }

  analyzing.value = true
  analyzingPhase.value = '加载章节内容...'
  try {
    // Ensure characters are loaded
    if (characters.length === 0) {
      await characterStore.loadCharacters()
    }
    if (characters.length < 2) {
      message.warning('至少需要 2 个人物才能分析关系')
      return
    }

    // Load all chapter content with more context
    if (volumeStore.volumes.length === 0) {
      await volumeStore.loadVolumes()
    }

    let allContent = ''
    let chapterCount = 0
    for (const vol of volumeStore.volumes) {
      await chapterStore.loadChapters(vol.id)
      for (const ch of chapterStore.chapters) {
        analyzingPhase.value = `加载章节: ${ch.title}`
        const content = await chapterStore.loadChapterContent(vol.id, ch.filename)
        if (content) {
          // Use more content per chapter, trim meta comment
          const body = content.replace(/^<!--meta:.*?-->\s*/s, '')
          allContent += `\n\n【${ch.title}】\n${body.slice(0, 5000)}`
          chapterCount++
        }
      }
    }

    if (!allContent.trim()) {
      message.warning('没有找到章节内容，请先编写章节')
      return
    }

    // Increase content limit for better analysis
    allContent = allContent.slice(0, 50000)

    const charList = characters.map(c =>
      `【${c.name}】${c.role === 'protagonist' ? '主角' : c.role === 'antagonist' ? '反派' : '配角'}`
    ).join('\n')

    analyzingPhase.value = 'AI 分析中...'
    const templates = BUILTIN_TEMPLATES
    const prompt = renderPrompt(templates.CHARACTER_RELATION_ANALYSIS, {
      characters: charList,
      content: allContent
    })

    const result = await callAI(aiStore.activeProvider, [
      { role: 'system', content: '你是一名专业的小说编辑，擅长分析人物关系。请以纯JSON数组格式输出，不包含任何其他文字。' },
      { role: 'user', content: prompt }
    ])

    const jsonMatch = result.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      message.info('AI 未分析出关系')
      return
    }

    const data = JSON.parse(jsonMatch[0])
    if (!Array.isArray(data) || data.length === 0) {
      message.info('AI 未分析出关系')
      return
    }

    // Smart deduplication: separate new vs updated relationships
    const nameToId = new Map(characters.map(c => [c.name, c.id]))
    const existingMap = new Map<string, { id: string; type: string; description: string; strength: number }>()
    for (const r of relationships) {
      existingMap.set(`${r.source}-${r.target}`, { id: r.id, type: r.type, description: r.description, strength: r.strength })
      existingMap.set(`${r.target}-${r.source}`, { id: r.id, type: r.type, description: r.description, strength: r.strength })
    }

    newRelations.value = []
    updatedRelations.value = []

    for (const r of data) {
      const sourceId = nameToId.get(r.source) || r.source
      const targetId = nameToId.get(r.target) || r.target
      if (sourceId === targetId) continue

      const pairKey = `${sourceId}-${targetId}`
      const reverseKey = `${targetId}-${sourceId}`
      const existing = existingMap.get(pairKey) || existingMap.get(reverseKey)

      const item = {
        source: r.source,
        target: r.target,
        type: r.type || 'friend',
        description: r.description || '',
        strength: r.strength || 5
      }

      if (existing) {
        // Update if type or description changed
        if (existing.type !== item.type || existing.description !== item.description) {
          updatedRelations.value.push({ ...item, existingId: existing.id })
        }
      } else {
        newRelations.value.push(item)
      }
    }

    if (newRelations.value.length === 0 && updatedRelations.value.length === 0) {
      message.success(`分析完成，已检查 ${chapterCount} 章，未发现新关系`)
    } else {
      showAnalysisResult.value = true
    }
  } catch (e: any) {
    message.error('分析失败: ' + (e.message || '未知错误'))
  } finally {
    analyzing.value = false
    analyzingPhase.value = '分析中...'
  }
}

function applyAnalysisResults() {
  const nameToId = new Map(characters.map(c => [c.name, c.id]))

  // Add new relationships
  for (const r of newRelations.value) {
    const sourceId = nameToId.get(r.source) || r.source
    const targetId = nameToId.get(r.target) || r.target
    characterStore.addRelationship({
      source: sourceId,
      target: targetId,
      type: r.type as RelationshipType,
      description: r.description,
      strength: r.strength
    })
  }

  // Update existing relationships
  for (const r of updatedRelations.value) {
    characterStore.updateRelationship(r.existingId, {
      type: r.type as RelationshipType,
      description: r.description,
      strength: r.strength
    })
  }

  showAnalysisResult.value = false
  const total = newRelations.value.length + updatedRelations.value.length
  message.success(`已处理 ${total} 条关系（${newRelations.value.length} 新增，${updatedRelations.value.length} 更新）`)
  nextTick(() => initGraph())
}

onMounted(async () => {
  await characterStore.loadCharacters()
  await characterStore.loadRelationships()
  nextTick(() => initGraph())
})

watch(layoutType, () => initGraph())

watch(() => [characterStore.characters.length, characterStore.relationships.length], () => {
  nextTick(() => initGraph())
})

onUnmounted(() => {
  graph?.destroy()
  graph = null
})
</script>

<style scoped>
.graph-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.graph-container {
  flex: 1;
  border: 1px solid var(--n-border-color);
  border-radius: 8px;
  overflow: hidden;
}
</style>
