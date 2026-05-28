<template>
  <div class="page" v-if="character">
    <div class="page-header">
      <n-space align="center">
        <n-button quaternary @click="$router.back()">← 返回</n-button>
        <n-avatar :size="40" :style="{ backgroundColor: getRoleColor(character.role) }">
          {{ character.name?.charAt(0) || '?' }}
        </n-avatar>
        <h2 class="page-title">{{ character.name || '编辑人物' }}</h2>
      </n-space>
      <n-space>
        <n-popconfirm @positive-click="handleDelete">
          <template #trigger>
            <n-button type="error" quaternary>删除</n-button>
          </template>
          确定删除此人物吗？
        </n-popconfirm>
        <n-button type="primary" @click="handleSave">保存</n-button>
      </n-space>
    </div>

    <n-tabs type="line">
      <n-tab-pane name="basic" tab="基本信息">
        <n-form :model="character" label-placement="left" label-width="80" style="max-width: 600px;">
          <n-form-item label="姓名">
            <n-input v-model:value="character.name" placeholder="人物姓名" />
          </n-form-item>
          <n-form-item label="身份">
            <n-select v-model:value="character.role" :options="CHARACTER_ROLES" />
          </n-form-item>
          <n-form-item label="性别">
            <n-select v-model:value="character.gender" :options="genderOptions" />
          </n-form-item>
          <n-form-item label="年龄">
            <n-input-number v-model:value="character.age" :min="0" :max="9999" />
          </n-form-item>
          <n-form-item label="说话风格">
            <n-input v-model:value="character.speechStyle" placeholder="例：粗犷豪迈、文雅书生气" />
          </n-form-item>
          <n-form-item label="目标">
            <n-input v-model:value="character.goal" type="textarea" :rows="2" placeholder="这个角色想要什么？" />
          </n-form-item>
          <n-form-item label="秘密">
            <n-input v-model:value="character.secret" type="textarea" :rows="2" placeholder="这个角色隐藏什么秘密？" />
          </n-form-item>
        </n-form>
      </n-tab-pane>

      <n-tab-pane name="personality" tab="性格与背景">
        <n-form :model="character" label-placement="top" style="max-width: 700px;">
          <n-form-item label="性格">
            <n-input v-model:value="character.personality" type="textarea" :rows="4" placeholder="描述角色性格特点..." />
          </n-form-item>
          <n-form-item label="背景故事">
            <n-input v-model:value="character.background" type="textarea" :rows="6" placeholder="角色的过往经历..." />
          </n-form-item>
        </n-form>
      </n-tab-pane>

      <n-tab-pane name="skills" tab="技能与物品">
        <n-form label-placement="top" style="max-width: 700px;">
          <n-form-item label="技能">
            <n-dynamic-tags v-model:value="character.skills" />
          </n-form-item>
          <n-form-item label="持有物品">
            <n-dynamic-tags v-model:value="character.items" />
          </n-form-item>
        </n-form>
      </n-tab-pane>

      <n-tab-pane name="relations" tab="关系">
        <n-list bordered>
          <n-list-item v-for="rel in characterRelations" :key="rel.id">
            <n-thing>
              <template #header>
                <n-space align="center">
                  <n-text strong>{{ getOtherCharName(rel) }}</n-text>
                  <n-tag size="small" :color="{ color: getRelationColor(rel.type) }">
                    {{ RELATIONSHIP_LABELS[rel.type] }}
                  </n-tag>
                </n-space>
              </template>
              <template #description>{{ rel.description }}</template>
            </n-thing>
            <template #suffix>
              <n-button size="small" type="error" quaternary @click="characterStore.removeRelationship(rel.id)">删除</n-button>
            </template>
          </n-list-item>
          <n-list-item v-if="characterRelations.length === 0">
            <n-text depth="3">暂无关系</n-text>
          </n-list-item>
        </n-list>
        <n-button style="margin-top: 12px;" @click="showAddRelation = true">添加关系</n-button>
      </n-tab-pane>
    </n-tabs>

    <!-- Add Relationship Modal -->
    <n-modal v-model:show="showAddRelation" preset="dialog" title="添加关系">
      <n-form :model="newRelation" label-placement="left" label-width="80">
        <n-form-item label="对方">
          <n-select v-model:value="newRelation.target" :options="otherCharOptions" placeholder="选择人物" />
        </n-form-item>
        <n-form-item label="关系类型">
          <n-select v-model:value="newRelation.type" :options="relationTypeOptions" />
        </n-form-item>
        <n-form-item label="描述">
          <n-input v-model:value="newRelation.description" type="textarea" :rows="2" />
        </n-form-item>
        <n-form-item label="强度">
          <n-slider v-model:value="newRelation.strength" :min="1" :max="10" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-space>
          <n-button @click="showAddRelation = false">取消</n-button>
          <n-button type="primary" @click="handleAddRelation">添加</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useCharacterStore } from '@/stores/character'
import { useProjectStore } from '@/stores/project'
import {
  CHARACTER_ROLES, RELATIONSHIP_LABELS, RELATIONSHIP_COLORS
} from '@/types/character'
import type { RelationshipType, Relationship } from '@/types/character'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const characterStore = useCharacterStore()
const projectStore = useProjectStore()

const showAddRelation = ref(false)
const newRelation = reactive({
  target: '',
  type: 'friend' as RelationshipType,
  description: '',
  strength: 5
})

const character = computed(() => {
  const id = route.params.charId as string
  return characterStore.characters.find(c => c.id === id)
})

const characterRelations = computed(() => {
  if (!character.value) return []
  return characterStore.relationships.filter(
    r => r.source === character.value!.id || r.target === character.value!.id
  )
})

const otherCharOptions = computed(() =>
  characterStore.characters
    .filter(c => c.id !== character.value?.id)
    .map(c => ({ label: c.name || '未命名', value: c.id }))
)

const relationTypeOptions = Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => ({
  label, value
}))

const genderOptions = [
  { label: '男', value: '男' },
  { label: '女', value: '女' },
  { label: '其他', value: '其他' }
]

onMounted(async () => {
  if (characterStore.characters.length === 0) {
    await characterStore.loadCharacters()
  }
  if (characterStore.relationships.length === 0) {
    await characterStore.loadRelationships()
  }
})

function getRoleColor(role: string) {
  const colors: Record<string, string> = {
    protagonist: '#faad14', antagonist: '#ff4d4f',
    supporting: '#1890ff', minor: '#8c8c8c'
  }
  return colors[role] || '#8c8c8c'
}

function getRelationColor(type: RelationshipType) {
  return RELATIONSHIP_COLORS[type]
}

function getOtherCharName(rel: Relationship) {
  const otherId = rel.source === character.value?.id ? rel.target : rel.source
  return characterStore.characters.find(c => c.id === otherId)?.name || '未知'
}

async function handleSave() {
  if (!character.value) return
  character.value.updatedAt = new Date().toISOString()
  await characterStore.saveCharacter(character.value)
  message.success('已保存')
}

async function handleDelete() {
  if (!character.value) return
  await characterStore.deleteCharacter(character.value)
  router.push(`/project/${projectStore.currentProjectName}/characters`)
  message.success('已删除')
}

function handleAddRelation() {
  if (!character.value || !newRelation.target) {
    message.warning('请选择对方人物')
    return
  }
  characterStore.addRelationship({
    source: character.value.id,
    target: newRelation.target,
    type: newRelation.type,
    description: newRelation.description,
    strength: newRelation.strength
  })
  showAddRelation.value = false
  newRelation.target = ''
  newRelation.description = ''
  message.success('已添加关系')
}
</script>

