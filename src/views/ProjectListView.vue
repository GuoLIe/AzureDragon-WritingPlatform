<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">我的小说</h2>
      <n-button type="primary" @click="showCreateModal = true">
        创建小说
      </n-button>
      <n-button quaternary @click="refreshData">刷新</n-button>
    </div>

    <n-empty v-if="projects.length === 0" description="还没有小说项目，点击上方按钮创建" style="margin-top: 120px;" />

    <div class="card-grid" v-else>
      <div
        v-for="project in projects"
        :key="project.name"
        class="glass-card"
        @click="openProject(project.name)"
      >
        <div class="card-header">
          <n-ellipsis :line-clamp="1" style="font-weight: 600; font-size: 15px;">{{ project.name }}</n-ellipsis>
          <n-popconfirm @positive-click.stop="handleDelete(project.name)">
            <template #trigger>
              <n-button quaternary circle size="small" @click.stop>
                <template #icon><n-icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></n-icon></template>
              </n-button>
            </template>
            确定删除「{{ project.name }}」吗？
          </n-popconfirm>
        </div>
        <div class="card-body">
          <n-space>
            <n-tag size="small" type="info">{{ project.type }}</n-tag>
            <n-tag size="small">{{ project.style }}</n-tag>
          </n-space>
          <div style="font-size: 12px; color: rgba(91, 140, 90, 0.6); margin-top: 4px;">
            目标: {{ formatWordCount(project.targetWordCount) }}
          </div>
          <n-ellipsis :line-clamp="2" style="font-size: 13px; color: #5C5C5C; margin-top: 6px;">
            {{ project.description || '暂无简介' }}
          </n-ellipsis>
        </div>
      </div>
    </div>

    <create-project-modal
      v-model:show="showCreateModal"
      @created="handleCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { useProjectStore } from '@/stores/project'
import CreateProjectModal from '@/components/CreateProjectModal.vue'

const router = useRouter()
const message = useMessage()
const projectStore = useProjectStore()

const showCreateModal = ref(false)

const projects = storeToRefs(projectStore).projects

onMounted(async () => {
  await projectStore.loadProjectList()
})

// Refresh projects from disk
async function refreshData() {
  await projectStore.loadProjectList()
}

function formatWordCount(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(0)}万字`
  return `${count}字`
}

async function openProject(name: string) {
  await projectStore.openProject(name)
  router.push(`/project/${name}`)
}

async function handleDelete(name: string) {
  await projectStore.deleteProject(name)
  await refreshData()
  message.success('已删除')
}

async function handleCreated(name: string) {
  showCreateModal.value = false
  await refreshData()
  message.success('创建成功')
  await projectStore.openProject(name)
  router.push(`/project/${name}`)
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
