import { defineStore } from 'pinia'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import type { Volume } from '@/types/chapter'
import { useProjectStore } from '@/stores/project'
import { fileAPI } from '@/utils/fileAPI'

export const useVolumeStore = defineStore('volume', () => {
  const volumes = ref<Volume[]>([])
  const loading = ref(false)

  async function loadVolumes() {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const dir = await projectStore.getProjectDir()
    const volDir = await fileAPI.pathJoin(dir, 'volumes')
    await fileAPI.ensureDirectory(volDir)
    const entries = await fileAPI.listFiles(volDir)
    const dirs = entries.filter((e: { name: string; isDirectory: boolean }) => e.isDirectory)

    const loaded: Volume[] = []
    for (const d of dirs) {
      try {
        const metaPath = await fileAPI.pathJoin(volDir, d.name, 'volume.json')
        const content = await fileAPI.readFile(metaPath)
        const vol = JSON.parse(content)
        loaded.push({ outline: '', ...vol })
      } catch { /* skip */ }
    }
    volumes.value = loaded.sort((a, b) => a.order - b.order)
  }

  async function createVolume(data: { name: string; description: string; targetWordCount: number }) {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return

    const volume: Volume = {
      id: nanoid(),
      name: data.name,
      description: data.description,
      outline: '',
      order: volumes.value.length + 1,
      targetWordCount: data.targetWordCount,
      createdAt: new Date().toISOString()
    }

    const dir = await projectStore.getProjectDir()
    const volDir = await fileAPI.pathJoin(dir, 'volumes', data.name)
    await fileAPI.ensureDirectory(volDir)
    await fileAPI.writeFile(
      await fileAPI.pathJoin(volDir, 'volume.json'),
      JSON.stringify(volume, null, 2)
    )

    volumes.value.push(volume)
    return volume
  }

  async function updateVolume(volumeId: string, data: Partial<Pick<Volume, 'name' | 'description' | 'outline' | 'targetWordCount'>>) {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const vol = volumes.value.find(v => v.id === volumeId)
    if (!vol) return

    Object.assign(vol, data)
    const dir = await projectStore.getProjectDir()
    const metaPath = await fileAPI.pathJoin(dir, 'volumes', vol.name, 'volume.json')
    await fileAPI.writeFile(metaPath, JSON.stringify(vol, null, 2))
  }

  async function deleteVolume(volume: Volume) {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const dir = await projectStore.getProjectDir()
    const volDir = await fileAPI.pathJoin(dir, 'volumes', volume.name)
    await fileAPI.deleteDirectory(volDir)
    volumes.value = volumes.value.filter(v => v.id !== volume.id)
  }

  return {
    volumes,
    loading,
    loadVolumes,
    createVolume,
    updateVolume,
    deleteVolume
  }
})
