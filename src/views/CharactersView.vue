<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">人物管理</h2>
      <n-space>
        <n-button :loading="extracting" @click="handleAutoExtract" type="primary">
          {{ extracting ? extractingPhase : '自动整理人物' }}
        </n-button>
        <n-button @click="showAIGenerate = true" :loading="characterStore.loading">
          AI 生成人物
        </n-button>
        <n-button @click="handleAdd">添加人物</n-button>
        <n-button quaternary @click="refreshData">刷新</n-button>
      </n-space>
    </div>

    <n-empty v-if="characters.length === 0" description="还没有人物" style="margin-top: 80px;" />

    <div class="card-grid">
      <div
        v-for="char in characters"
        :key="char.id"
        class="glass-card"
        @click="$router.push(`/project/${projectStore.currentProjectName}/characters/${char.id}`)"
      >
        <div class="card-header">
          <n-space align="center">
            <n-avatar :size="36" :style="{ backgroundColor: getRoleColor(char.role) }">
              {{ char.name?.charAt(0) || '?' }}
            </n-avatar>
            <span style="font-weight: 600; font-size: 15px;">{{ char.name || '未命名' }}</span>
          </n-space>
          <n-tag size="small" :type="getRoleTagType(char.role)">{{ getRoleLabel(char.role) }}</n-tag>
        </div>
        <div class="card-body">
          <div style="font-size: 12px; color: #787890;">
            {{ char.gender }} {{ char.age ? char.age + '岁' : '' }}
          </div>
          <n-ellipsis :line-clamp="2" style="font-size: 13px; color: #B0B0C0; margin-top: 6px;">
            {{ char.personality || '暂无描述' }}
          </n-ellipsis>
        </div>
      </div>
    </div>

    <!-- AI Generate Modal -->
    <n-modal v-model:show="showAIGenerate" preset="dialog" title="AI 生成人物">
      <n-input
        v-model:value="aiHint"
        type="textarea"
        :rows="3"
        placeholder="描述你想要的人物，例如：一个冷酷的剑客，少年时家族被灭，性格阴沉但内心善良"
      />
      <template #action>
        <n-space>
          <n-button @click="showAIGenerate = false">取消</n-button>
          <n-button type="primary" :loading="characterStore.loading" @click="handleAIGenerate">生成</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useCharacterStore } from '@/stores/character'
import { useProjectStore } from '@/stores/project'
import { CHARACTER_ROLES } from '@/types/character'
import type { Character } from '@/types/character'

const router = useRouter()
const message = useMessage()
const characterStore = useCharacterStore()
const projectStore = useProjectStore()

const characters = characterStore.characters
const showAIGenerate = ref(false)
const aiHint = ref('')
const extracting = ref(false)
const extractingPhase = ref('分析中...')

onMounted(async () => {
  await loadData()
})

async function loadData() {
  await characterStore.loadCharacters()
  await characterStore.loadRelationships()
}

async function refreshData() {
  await characterStore.loadCharacters()
  await characterStore.loadRelationships()
}

function getRoleColor(role: string) {
  const colors: Record<string, string> = {
    protagonist: '#faad14',
    antagonist: '#ff4d4f',
    supporting: '#1890ff',
    minor: '#8c8c8c'
  }
  return colors[role] || '#8c8c8c'
}

function getRoleLabel(role: string) {
  return CHARACTER_ROLES.find(r => r.value === role)?.label || '未知'
}

function getRoleTagType(role: string): 'success' | 'error' | 'info' | 'warning' | 'default' {
  const types: Record<string, 'success' | 'error' | 'info' | 'warning' | 'default'> = {
    protagonist: 'warning',
    antagonist: 'error',
    supporting: 'info',
    minor: 'default'
  }
  return types[role] || 'default'
}

function handleAdd() {
  const char = characterStore.createEmptyCharacter()
  characterStore.saveCharacter(char)
  router.push(`/project/${projectStore.currentProjectName}/characters/${char.id}`)
}

async function handleAIGenerate() {
  if (!aiHint.value.trim()) {
    message.warning('请输入人物描述')
    return
  }
  try {
    const char = await characterStore.generateCharacter(aiHint.value)
    await characterStore.saveCharacter(char)
    await refreshData()
    showAIGenerate.value = false
    aiHint.value = ''
    message.success('人物生成成功')
    router.push(`/project/${projectStore.currentProjectName}/characters/${char.id}`)
  } catch (e: any) {
    message.error('生成失败: ' + e.message)
  }
}

async function handleAutoExtract() {
  extracting.value = true
  extractingPhase.value = '分析中...'
  try {
    const result = await characterStore.autoExtractCharacters((phase) => {
      extractingPhase.value = phase
    })
    await refreshData()
    if (result.added === 0 && result.updated === 0) {
      message.info('未发现新的人物信息')
    } else {
      message.success(`整理完成：新增 ${result.added} 人，更新 ${result.updated} 人`)
    }
  } catch (e: any) {
    message.error('整理失败: ' + e.message)
  } finally {
    extracting.value = false
    extractingPhase.value = '分析中...'
  }
}
</script>

<style scoped>
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
