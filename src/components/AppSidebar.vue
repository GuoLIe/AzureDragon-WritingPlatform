<template>
  <n-layout-sider
    bordered
    collapse-mode="width"
    :collapsed-width="64"
    :width="220"
    show-trigger
    :collapsed="collapsed"
    @update:collapsed="collapsed = $event"
  >
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title" v-if="!collapsed">AI小说助手</span>
        <span v-else class="sidebar-logo">✦</span>
      </div>

      <n-menu
        :collapsed="collapsed"
        :collapsed-width="64"
        :collapsed-icon-size="22"
        :options="menuOptions"
        :value="activeKey"
        @update:value="handleMenuSelect"
      />

      <div class="sidebar-footer">
        <div class="footer-badge" v-if="!collapsed">
          <span class="footer-badge-icon">✦</span>
          <span class="footer-badge-text">v0.1.0</span>
        </div>
        <span v-else class="footer-badge-icon" style="font-size: 14px;">✦</span>
      </div>
    </div>
  </n-layout-sider>
</template>

<script setup lang="ts">
import { ref, computed, h } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { MenuOption } from 'naive-ui'
import { useProjectStore } from '@/stores/project'

const router = useRouter()
const route = useRoute()
const projectStore = useProjectStore()

const collapsed = ref(false)

const icons = {
  home: '&#127968;',
  doc: '&#128196;',
  book: '&#128214;',
  people: '&#128101;',
  graph: '&#128202;',
  settings: '&#9881;'
}

function renderIcon(emoji: string) {
  return () => h('span', { style: 'font-size: 18px; line-height: 1;' }, emoji)
}

const menuOptions = computed<MenuOption[]>(() => {
  const base: MenuOption[] = [
    {
      label: '项目列表',
      key: 'home',
      icon: renderIcon('\u{1F3E0}')
    }
  ]

  if (projectStore.currentProject) {
    base.push(
      { type: 'divider', key: 'd1' },
      { label: '大纲', key: 'outline', icon: renderIcon('\u{1F4DD}') },
      { label: '卷与章节', key: 'volumes', icon: renderIcon('\u{1F4D6}') },
      { label: '人物', key: 'characters', icon: renderIcon('\u{1F465}') },
      { label: '关系图谱', key: 'graph', icon: renderIcon('\u{1F4CA}') }
    )
  }

  base.push(
    { type: 'divider', key: 'd2' },
    { label: 'DeepSeek', key: 'deepseek', icon: renderIcon('\u{1F916}') },
    { label: '设置', key: 'settings', icon: renderIcon('⚙️') }
  )

  return base
})

const activeKey = computed(() => {
  if (route.name === 'home') return 'home'
  if (route.name === 'settings') return 'settings'
  if (route.name === 'deepseek') return 'deepseek'
  if (route.path.includes('/outline')) return 'outline'
  if (route.path.includes('/volumes') || route.path.includes('/chapters')) return 'volumes'
  if (route.path.includes('/characters')) return 'characters'
  if (route.path.includes('/graph')) return 'graph'
  return 'home'
})

function handleMenuSelect(key: string) {
  if (key === 'home') {
    router.push('/')
  } else if (key === 'settings') {
    router.push('/settings')
  } else if (key === 'deepseek') {
    router.push('/deepseek')
  } else if (projectStore.currentProjectName) {
    router.push(`/project/${projectStore.currentProjectName}/${key}`)
  }
}
</script>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sidebar-header {
  padding: 22px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  border-bottom: 1px solid rgba(91, 123, 90, 0.12);
}

.sidebar-title {
  font-size: 17px;
  font-weight: 700;
  white-space: nowrap;
  letter-spacing: 0.06em;
  background: linear-gradient(135deg, #5B8C5A, #4A7349);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.sidebar-logo {
  font-size: 20px;
  color: #5B8C5A;
}

.sidebar-footer {
  margin-top: auto;
  padding: 14px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-top: 1px solid rgba(91, 123, 90, 0.12);
}

.footer-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0.4;
}

.footer-badge-icon {
  color: #5B8C5A;
  font-size: 12px;
}

.footer-badge-text {
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--n-text-color-3);
}
</style>
