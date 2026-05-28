<template>
  <div style="height: 100%;">
    <chapter-edit-panel
      :volume-id="volumeId"
      :chapter-id="chapterId"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ChapterEditPanel from '@/components/ChapterEditPanel.vue'

const route = useRoute()
const volumeId = computed(() => route.params.volumeId as string)
const chapterId = computed(() => route.params.chapterId as string)
</script>
