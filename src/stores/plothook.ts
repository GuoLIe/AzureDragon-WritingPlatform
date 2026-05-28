import { defineStore } from 'pinia'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import type { PlotHook } from '@/types/chapter'
import { useProjectStore } from '@/stores/project'
import { useAIStore } from '@/stores/ai'
import { callAI } from '@/api/ai'
import { renderPrompt, BUILTIN_TEMPLATES } from '@/utils/promptTemplates'
import { fileAPI } from '@/utils/fileAPI'

export const usePlotHookStore = defineStore('plothook', () => {
  const hooks = ref<PlotHook[]>([])

  async function loadHooks() {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const dir = await projectStore.getProjectDir()
    try {
      const content = await fileAPI.readFile(
        await fileAPI.pathJoin(dir, 'memory', 'plothooks.json')
      )
      hooks.value = JSON.parse(content)
    } catch {
      hooks.value = []
    }
  }

  async function saveHooks() {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const dir = await projectStore.getProjectDir()
    await fileAPI.ensureDirectory(await fileAPI.pathJoin(dir, 'memory'))
    await fileAPI.writeFile(
      await fileAPI.pathJoin(dir, 'memory', 'plothooks.json'),
      JSON.stringify(hooks.value, null, 2)
    )
  }

  function getUnresolved(): PlotHook[] {
    return hooks.value.filter(h => h.status === 'unresolved')
  }

  function getUnresolvedText(): string {
    const unresolved = getUnresolved()
    if (unresolved.length === 0) return '（暂无未解决埋点）'
    return unresolved.map((h, i) =>
      `${i + 1}. 【${h.type === 'foreshadowing' ? '伏笔' : h.type === 'mystery' ? '悬念' : h.type === 'setup' ? '设定铺垫' : h.type === 'cliffhanger' ? '结尾悬念' : '承诺'}】${h.description}（出自《${h.volumeName}·${h.chapterTitle}》）`
    ).join('\n')
  }

  function addHook(hook: Omit<PlotHook, 'id' | 'createdAt'>) {
    const existing = hooks.value.find(h =>
      h.description === hook.description && h.status === 'unresolved'
    )
    if (existing) return existing // avoid duplicates
    const newHook: PlotHook = {
      ...hook,
      id: nanoid(),
      createdAt: new Date().toISOString()
    }
    hooks.value.push(newHook)
    saveHooks()
    return newHook
  }

  function resolveHook(hookId: string, resolvedIn: string, resolvedChapterId: string) {
    const hook = hooks.value.find(h => h.id === hookId)
    if (!hook) return
    hook.status = 'resolved'
    hook.resolvedIn = resolvedIn
    hook.resolvedChapterId = resolvedChapterId
    hook.resolvedAt = new Date().toISOString()
    saveHooks()
  }

  async function extractHooksFromContent(
    content: string,
    chapterTitle: string,
    chapterId: string,
    volumeName: string,
    volumeId: string
  ): Promise<{ added: number; resolved: number }> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider || !content.trim()) return { added: 0, resolved: 0 }

    const body = content.replace(/^<!--meta:.*?-->\s*/s, '').trim()
    if (!body) return { added: 0, resolved: 0 }

    try {
      const prompt = renderPrompt(BUILTIN_TEMPLATES.PLOT_HOOK_EXTRACT, {
        chapterTitle,
        content: body.slice(0, 10000)
      })

      const result = await callAI(aiStore.activeProvider, [
        { role: 'system', content: '你是一名专业的小说编辑，擅长分析剧情结构。请以纯JSON格式输出。' },
        { role: 'user', content: prompt }
      ])

      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return { added: 0, resolved: 0 }

      const data = JSON.parse(jsonMatch[0])
      const now = new Date().toISOString()
      let added = 0
      let resolved = 0

      // Add new hooks
      if (Array.isArray(data.newHooks)) {
        for (const nh of data.newHooks) {
          if (!nh.description) continue
          addHook({
            description: nh.description,
            type: nh.type || 'foreshadowing',
            chapterTitle,
            chapterId,
            volumeName,
            volumeId,
            status: 'unresolved'
          })
          added++
        }
      }

      // Resolve existing hooks
      if (Array.isArray(data.resolvedHooks)) {
        for (const resolvedDesc of data.resolvedHooks) {
          const hook = hooks.value.find(h =>
            h.status === 'unresolved' && h.description === resolvedDesc
          )
          if (hook) {
            resolveHook(hook.id, chapterTitle, chapterId)
            resolved++
          }
        }
      }

      return { added, resolved }
    } catch {
      return { added: 0, resolved: 0 }
    }
  }

  async function deleteHook(hookId: string) {
    hooks.value = hooks.value.filter(h => h.id !== hookId)
    await saveHooks()
  }

  return {
    hooks,
    loadHooks,
    saveHooks,
    getUnresolved,
    getUnresolvedText,
    addHook,
    resolveHook,
    extractHooksFromContent,
    deleteHook
  }
})