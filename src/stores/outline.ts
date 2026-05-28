import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useAIStore } from '@/stores/ai'
import { callAI } from '@/api/ai'
import { renderPrompt, BUILTIN_TEMPLATES } from '@/utils/promptTemplates'
import { fileAPI } from '@/utils/fileAPI'

export type OutlineType = '总纲' | '世界观' | '支线'

export const useOutlineStore = defineStore('outline', () => {
  const contents = ref<Record<OutlineType, string>>({
    '总纲': '',
    '世界观': '',
    '支线': ''
  })
  const loading = ref(false)

  async function loadOutline(type: OutlineType) {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const dir = await projectStore.getProjectDir()
    const filePath = await fileAPI.pathJoin(dir, 'outline', `${type}.md`)
    try {
      contents.value[type] = await fileAPI.readFile(filePath)
    } catch {
      contents.value[type] = `# ${type}\n\n`
    }
  }

  async function saveOutline(type: OutlineType, content: string) {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const dir = await projectStore.getProjectDir()
    const filePath = await fileAPI.pathJoin(dir, 'outline', `${type}.md`)
    await fileAPI.writeFile(filePath, content)
    contents.value[type] = content
  }

  async function loadPromptTemplates(): Promise<Record<string, string>> {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return BUILTIN_TEMPLATES
    const dir = await projectStore.getProjectDir()
    const filePath = await fileAPI.pathJoin(dir, 'settings', 'prompt.json')
    try {
      const content = await fileAPI.readFile(filePath)
      return { ...BUILTIN_TEMPLATES, ...JSON.parse(content) }
    } catch {
      return BUILTIN_TEMPLATES
    }
  }

  async function polishOutline(
    type: OutlineType,
    onToken?: (token: string) => void
  ): Promise<string> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')

    loading.value = true
    try {
      const templates = await loadPromptTemplates()
      const prompt = renderPrompt(templates.OUTLINE_POLISH, {
        outline: contents.value[type]
      })

      const result = await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名拥有20年以上经验的中文网络小说总编剧。' },
          { role: 'user', content: prompt }
        ],
        undefined,
        { onToken }
      )
      return result
    } finally {
      loading.value = false
    }
  }

  async function expandOutline(
    type: OutlineType,
    onToken?: (token: string) => void
  ): Promise<string> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')

    loading.value = true
    try {
      const templates = await loadPromptTemplates()
      const prompt = renderPrompt(templates.OUTLINE_EXPAND, {
        outline: contents.value[type]
      })

      const result = await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名顶级中文网络小说作者。' },
          { role: 'user', content: prompt }
        ],
        undefined,
        { onToken }
      )
      return result
    } finally {
      loading.value = false
    }
  }

  return {
    contents,
    loading,
    loadOutline,
    saveOutline,
    polishOutline,
    expandOutline
  }
})
