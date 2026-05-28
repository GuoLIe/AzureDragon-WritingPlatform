<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-notification-provider>
        <n-dialog-provider>
          <div class="app-bg" />
          <n-layout has-sider style="height: 100vh; position: relative;">
            <app-sidebar />
            <n-layout-content content-style="padding: 0; overflow: hidden; background: transparent;">
              <div style="height: 100%; display: flex; flex-direction: column;">
                <router-view v-if="ready" style="flex: 1;" />
              </div>
            </n-layout-content>
          </n-layout>
        </n-dialog-provider>
      </n-notification-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useAIStore } from '@/stores/ai'
import AppSidebar from '@/components/AppSidebar.vue'

const appStore = useAppStore()
const aiStore = useAIStore()
const ready = ref(false)

// 书本绿主题 — 暖白纸页基底 + 墨色文字 + 温润绿意
const themeOverrides = {
  common: {
    fontFamily: '"Noto Serif SC", "Source Han Serif SC", "STSong", "SimSun", "Microsoft YaHei", serif',
    fontFamilyMono: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
    borderRadius: '12px',
    borderRadiusSmall: '8px',
    borderRadiusLarge: '16px',
    fontWeight: '400',
    fontWeightStrong: '600',
    lineHeight: '1.6',

    // 暖白纸页基底
    bodyColor: '#F5F0E6',
    cardColor: '#EDE8DC',
    modalColor: '#EDE8DC',
    popoverColor: '#EDE8DC',
    tableColor: '#F5F0E6',
    actionColor: '#E8E3D5',
    actionColorHover: '#E3DECE',
    inputColor: '#FAF7F0',

    // 书本绿 — 温润绿意
    primaryColor: '#5B8C5A',
    primaryColorHover: '#6E9F6D',
    primaryColorPressed: '#4A7349',
    primaryColorSuppl: '#5B8C5A',

    successColor: '#5B8C5A',
    warningColor: '#C8923E',
    errorColor: '#B05A5A',
    infoColor: '#5A7B8C',

    // 柔和边框
    borderColor: 'rgba(91, 123, 90, 0.12)',
    dividerColor: 'rgba(91, 123, 90, 0.08)',

    // 墨色文字（仿古籍）
    textColorBase: '#2C2C2C',
    textColor1: '#2C2C2C',
    textColor2: '#5C5C5C',
    textColor3: '#8C8C8C',

    // 温润无光阴影
    boxShadow1: '0 1px 4px rgba(0,0,0,0.06)',
    boxShadow2: '0 4px 12px rgba(0,0,0,0.08)',
    boxShadow3: '0 8px 24px rgba(0,0,0,0.10)',
  },
  Button: {
    borderRadiusMedium: '10px',
    borderRadiusLarge: '12px',
    fontWeight: '500',
    colorPrimary: '#5B8C5A',
    colorHoverPrimary: '#6E9F6D',
    colorPressedPrimary: '#4A7349',
    textColorPrimary: '#FFF',
    textColorHoverPrimary: '#FFF',
    textColorPressedPrimary: '#FFF',
    borderPrimary: '1px solid rgba(91, 140, 90, 0.3)',
    borderHoverPrimary: '1px solid rgba(91, 140, 90, 0.5)',
    boxShadowPrimary: '0 2px 8px rgba(91, 140, 90, 0.15)',
    boxShadowHoverPrimary: '0 4px 16px rgba(91, 140, 90, 0.2)',
  },
  Card: {
    borderRadius: '16px',
    borderColor: 'rgba(91, 123, 90, 0.08)',
    color: '#EDE8DC',
    colorEmbedded: '#F5F0E6',
    titleFontWeight: '600',
    titleTextColor: '#2C2C2C',
  },
  Input: {
    borderRadius: '10px',
    border: '1px solid rgba(91, 123, 90, 0.15)',
    borderHover: '1px solid rgba(91, 140, 90, 0.3)',
    borderFocus: '1px solid rgba(91, 140, 90, 0.5)',
    boxShadowFocus: '0 0 0 2px rgba(91, 140, 90, 0.1)',
    color: '#FAF7F0',
  },
  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '10px',
        border: '1px solid rgba(91, 123, 90, 0.15)',
        borderHover: '1px solid rgba(91, 140, 90, 0.3)',
        borderFocus: '1px solid rgba(91, 140, 90, 0.5)',
        boxShadowFocus: '0 0 0 2px rgba(91, 140, 90, 0.1)',
      }
    }
  },
  Modal: {
    borderRadius: '20px',
    color: '#EDE8DC',
  },
  Dialog: {
    borderRadius: '20px',
    color: '#EDE8DC',
  },
  Tag: {
    borderRadius: '8px',
  },
  Tabs: {
    tabBorderRadius: '10px',
    tabFontWeight: '500',
  },
  Menu: {
    borderRadius: '8px',
    itemColorHover: 'rgba(91, 140, 90, 0.06)',
    itemColorActive: 'rgba(91, 140, 90, 0.1)',
    itemColorActiveHover: 'rgba(91, 140, 90, 0.14)',
    itemTextColorActive: '#5B8C5A',
    itemTextColorActiveHover: '#6E9F6D',
    itemIconColorActive: '#5B8C5A',
    itemIconColorActiveHover: '#6E9F6D',
    itemTextColor: '#5C5C5C',
    itemTextColorHover: '#2C2C2C',
  },
  Switch: {
    railColorActive: '#5B8C5A',
  },
  Progress: {
    railColor: 'rgba(91, 123, 90, 0.1)',
    color: '#5B8C5A',
  },
  Layout: {
    siderColor: '#E8E3D5',
    siderBorderColor: 'transparent',
  },
  Tree: {
    nodeTextColorActive: '#5B8C5A',
    arrowColor: '#5B8C5A',
  },
  DataTable: {
    thColor: '#E8E3D5',
    tdColor: '#F5F0E6',
    borderColor: 'rgba(91, 123, 90, 0.08)',
    thTextColor: '#2C2C2C',
  },
  Empty: {
    iconColor: '#8C8C8C',
    textColor: '#8C8C8C',
  },
  Tooltip: {
    color: '#EDE8DC',
  },
  Message: {
    color: '#EDE8DC',
  },
  Notification: {
    color: '#EDE8DC',
  },
  Badge: {
    color: '#5B8C5A',
  },
  AutoComplete: {
    menuColor: '#EDE8DC',
  },
  DatePicker: {
    itemColorActive: '#5B8C5A',
  },
}

onMounted(async () => {
  await appStore.init()
  await aiStore.load()
  ready.value = true
})
</script>

<style>
/* 书本绿 — 暖纸页背景 */
.app-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(ellipse at 15% 50%, rgba(91, 140, 90, 0.06) 0%, transparent 50%),
    radial-gradient(ellipse at 85% 30%, rgba(180, 160, 120, 0.04) 0%, transparent 50%),
    #F5F0E6;
}
</style>
