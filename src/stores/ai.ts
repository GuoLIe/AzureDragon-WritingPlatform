import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import localforage from 'localforage'
import { nanoid } from 'nanoid'
import type { AIProvider } from '@/types/ai'

const STORAGE_KEY = 'ai-providers'

export const useAIStore = defineStore('ai', () => {
  const providers = ref<AIProvider[]>([])

  const activeProvider = computed(() =>
    providers.value.find(p => p.isActive) || null
  )

  async function load() {
    const saved = await localforage.getItem<AIProvider[]>(STORAGE_KEY)
    if (saved) {
      providers.value = saved
    }
  }

  async function save() {
    // JSON 序列化去除 Vue reactive proxy，避免 IndexedDB DataCloneError
    await localforage.setItem(STORAGE_KEY, JSON.parse(JSON.stringify(providers.value)))
  }

  async function addProvider(provider: Omit<AIProvider, 'id'>) {
    const newProvider: AIProvider = {
      ...provider,
      id: nanoid()
    }
    providers.value.push(newProvider)
    await save()
    return newProvider
  }

  async function updateProvider(id: string, data: Partial<AIProvider>) {
    const index = providers.value.findIndex(p => p.id === id)
    if (index !== -1) {
      providers.value[index] = { ...providers.value[index], ...data }
      await save()
    }
  }

  async function removeProvider(id: string) {
    providers.value = providers.value.filter(p => p.id !== id)
    await save()
  }

  async function setActiveProvider(id: string) {
    providers.value.forEach(p => {
      p.isActive = p.id === id
    })
    await save()
  }

  return {
    providers,
    activeProvider,
    load,
    addProvider,
    updateProvider,
    removeProvider,
    setActiveProvider
  }
})
