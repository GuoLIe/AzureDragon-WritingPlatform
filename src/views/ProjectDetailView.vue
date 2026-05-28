<template>
  <div style="height: 100%; display: flex; flex-direction: column;">
    <n-spin :show="loading" style="flex: 1; display: flex; flex-direction: column;">
      <div v-if="projectStore.currentProjectName" style="flex: 1; display: flex; flex-direction: column;">
        <router-view style="flex: 1;" />
      </div>
      <n-empty v-else-if="!loading" description="项目不存在" style="margin-top: 120px;">
        <template #extra>
          <n-button @click="$router.push('/')">返回项目列表</n-button>
        </template>
      </n-empty>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useProjectStore } from '@/stores/project'

const route = useRoute()
const projectStore = useProjectStore()
const loading = ref(true)

async function loadProject() {
  loading.value = true
  const id = route.params.id as string
  if (id) {
    try {
      await projectStore.openProject(id)
    } catch {
      // 项目不存在
    }
  }
  loading.value = false
}

onMounted(loadProject)
watch(() => route.params.id, loadProject)
</script>
