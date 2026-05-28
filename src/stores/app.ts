import { defineStore } from 'pinia'
import { ref } from 'vue'
import localforage from 'localforage'
import { fileAPI } from '@/utils/fileAPI'

export const useAppStore = defineStore('app', () => {
  const isDark = ref(false)
  const novelsDir = ref('')
  const isLoading = ref(false)

  async function init() {
    // Load theme preference
    const savedTheme = await localforage.getItem<boolean>('dark-theme')
    if (savedTheme !== null) {
      isDark.value = savedTheme
    }

    // Load novels directory
    novelsDir.value = await fileAPI.getNovelsDir()
  }

  async function toggleTheme() {
    isDark.value = !isDark.value
    await localforage.setItem('dark-theme', isDark.value)
  }

  return { isDark, novelsDir, isLoading, init, toggleTheme }
})
