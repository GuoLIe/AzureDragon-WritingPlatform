<template>
  <div class="page">
    <div class="page-header">
      <n-space align="center">
        <n-button quaternary @click="$router.push(`/project/${projectStore.currentProjectName}/volumes`)">← 返回卷列表</n-button>
        <h2 class="page-title">{{ volumeName }}</h2>
      </n-space>
      <n-space>
        <n-button quaternary @click="refreshData">
          <template #icon>
            <n-icon><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg></n-icon>
          </template>
          刷新
        </n-button>
        <n-button type="primary" @click="showCreate = true">新建章节</n-button>
      </n-space>
    </div>

    <n-empty v-if="chapters.length === 0" description="还没有章节" style="margin-top: 80px;" />

    <n-list v-else bordered>
      <n-list-item
        v-for="ch in chapters"
        :key="ch.id"
        style="cursor: pointer;"
        @click="$router.push(`/project/${projectStore.currentProjectName}/chapters/${volumeId}/${ch.id}`)"
      >
        <n-thing>
          <template #header>
            <n-space align="center">
              <n-text strong>{{ ch.title }}</n-text>
              <n-tag size="small" :type="getStatusType(ch.status)">
                {{ CHAPTER_STATUS_LABELS[ch.status] }}
              </n-tag>
            </n-space>
          </template>
          <template #description>
            <n-space>
              <n-text depth="3" style="font-size: 12px;">{{ ch.wordCount }} 字</n-text>
              <n-text depth="3" style="font-size: 12px;">{{ ch.filename }}</n-text>
            </n-space>
          </template>
        </n-thing>
      </n-list-item>
    </n-list>

    <n-modal v-model:show="showCreate" preset="dialog" title="新建章节">
      <n-input v-model:value="newTitle" placeholder="章节标题，例: 第一章 少年出山" />
      <template #action>
        <n-space>
          <n-button @click="showCreate = false">取消</n-button>
          <n-button type="primary" @click="handleCreate">创建</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NIcon } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useChapterStore } from '@/stores/chapter'
import { useVolumeStore } from '@/stores/volume'
import { useProjectStore } from '@/stores/project'
import { CHAPTER_STATUS_LABELS } from '@/types/chapter'
import type { ChapterStatus } from '@/types/chapter'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const chapterStore = useChapterStore()
const volumeStore = useVolumeStore()
const projectStore = useProjectStore()

const volumeId = computed(() => route.params.volumeId as string)
const volumeName = computed(() => {
  const vol = volumeStore.volumes.find(v => v.id === volumeId.value)
  return vol?.name || '未知卷'
})

const chapters = chapterStore.chapters
const showCreate = ref(false)
const newTitle = ref('')

onMounted(async () => {
  await loadData()
})

async function loadData() {
  if (volumeStore.volumes.length === 0) {
    await volumeStore.loadVolumes()
  }
  await chapterStore.loadChapters(volumeId.value)
}

async function refreshData() {
  await volumeStore.loadVolumes()
  await chapterStore.loadChapters(volumeId.value)
}

function getStatusType(status: ChapterStatus): 'default' | 'success' | 'info' | 'warning' | 'error' {
  const map: Record<ChapterStatus, 'default' | 'success' | 'info' | 'warning' | 'error'> = {
    outline: 'default',
    generated: 'info',
    polished: 'warning',
    de_ai: 'success',
    final: 'success'
  }
  return map[status]
}

async function handleCreate() {
  if (!newTitle.value.trim()) {
    message.warning('请输入标题')
    return
  }
  const ch = await chapterStore.createChapter(volumeId.value, newTitle.value)
  if (ch) {
    showCreate.value = false
    newTitle.value = ''
    await refreshData()
    router.push(`/project/${projectStore.currentProjectName}/chapters/${volumeId.value}/${ch.id}`)
  }
}
</script>

