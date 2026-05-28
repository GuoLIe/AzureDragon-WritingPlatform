import { defineStore } from 'pinia'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import type { Character, Relationship } from '@/types/character'
import { useProjectStore } from '@/stores/project'
import { useAIStore } from '@/stores/ai'
import { callAI } from '@/api/ai'
import { renderPrompt, BUILTIN_TEMPLATES } from '@/utils/promptTemplates'
import { fileAPI } from '@/utils/fileAPI'

export const useCharacterStore = defineStore('character', () => {
  const characters = ref<Character[]>([])
  const relationships = ref<Relationship[]>([])
  const loading = ref(false)

  async function loadCharacters() {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const dir = await projectStore.getProjectDir()
    const charDir = await fileAPI.pathJoin(dir, 'characters')
    await fileAPI.ensureDirectory(charDir)
    const entries = await fileAPI.listFiles(charDir)
    const jsonFiles = entries.filter((e: { name: string; isDirectory: boolean }) => !e.isDirectory && e.name.endsWith('.json'))

    const loaded: Character[] = []
    for (const file of jsonFiles) {
      try {
        const content = await fileAPI.readFile(
          await fileAPI.pathJoin(charDir, file.name)
        )
        loaded.push(JSON.parse(content))
      } catch { /* skip */ }
    }
    characters.value = loaded
  }

  async function saveCharacter(character: Character) {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const dir = await projectStore.getProjectDir()
    const charDir = await fileAPI.pathJoin(dir, 'characters')
    const filePath = await fileAPI.pathJoin(charDir, `${character.name}.json`)
    await fileAPI.writeFile(filePath, JSON.stringify(character, null, 2))

    const index = characters.value.findIndex(c => c.id === character.id)
    if (index !== -1) {
      characters.value[index] = character
    } else {
      characters.value.push(character)
    }
  }

  async function deleteCharacter(character: Character) {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const dir = await projectStore.getProjectDir()
    const filePath = await fileAPI.pathJoin(dir, 'characters', `${character.name}.json`)
    try {
      await fileAPI.deleteFile(filePath)
    } catch { /* file might not exist */ }
    characters.value = characters.value.filter(c => c.id !== character.id)
  }

  function createEmptyCharacter(): Character {
    const now = new Date().toISOString()
    return {
      id: nanoid(),
      name: '',
      gender: '',
      age: 0,
      personality: '',
      background: '',
      skills: [],
      items: [],
      speechStyle: '',
      goal: '',
      secret: '',
      role: 'supporting',
      createdAt: now,
      updatedAt: now
    }
  }

  async function generateCharacter(hint: string): Promise<Character> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')

    loading.value = true
    try {
      const projectStore = useProjectStore()
      const dir = await projectStore.getProjectDir()
      const promptPath = await fileAPI.pathJoin(dir, 'settings', 'prompt.json')
      let templates = BUILTIN_TEMPLATES
      try {
        const content = await fileAPI.readFile(promptPath)
        templates = { ...BUILTIN_TEMPLATES, ...JSON.parse(content) }
      } catch { /* use defaults */ }

      const prompt = renderPrompt(templates.CHARACTER_GEN, { hint })

      const result = await callAI(aiStore.activeProvider, [
        { role: 'system', content: '你是一名专业的小说角色设计师。请以纯JSON格式输出。' },
        { role: 'user', content: prompt }
      ])

      // Parse JSON from response (handle markdown code blocks)
      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('AI 返回的不是有效 JSON')

      const data = JSON.parse(jsonMatch[0])
      const now = new Date().toISOString()
      return {
        id: nanoid(),
        name: data.name || '',
        gender: data.gender || '',
        age: data.age || 0,
        personality: data.personality || '',
        background: data.background || '',
        skills: Array.isArray(data.skills) ? data.skills : [],
        items: Array.isArray(data.items) ? data.items : [],
        speechStyle: data.speechStyle || '',
        goal: data.goal || '',
        secret: data.secret || '',
        role: 'supporting',
        createdAt: now,
        updatedAt: now
      }
    } finally {
      loading.value = false
    }
  }

  // Relationships
  async function loadRelationships() {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const dir = await projectStore.getProjectDir()
    const filePath = await fileAPI.pathJoin(dir, 'graph', 'relations.json')
    try {
      const content = await fileAPI.readFile(filePath)
      const data = JSON.parse(content)
      relationships.value = data.edges || []
    } catch {
      relationships.value = []
    }
  }

  async function saveRelationships() {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return
    const dir = await projectStore.getProjectDir()
    const filePath = await fileAPI.pathJoin(dir, 'graph', 'relations.json')
    const data = {
      nodes: characters.value.map(c => ({ id: c.id, name: c.name, role: c.role })),
      edges: relationships.value
    }
    await fileAPI.writeFile(filePath, JSON.stringify(data, null, 2))
  }

  function addRelationship(rel: Omit<Relationship, 'id'>) {
    const newRel: Relationship = { ...rel, id: nanoid() }
    relationships.value.push(newRel)
    saveRelationships()
    return newRel
  }

  function removeRelationship(id: string) {
    relationships.value = relationships.value.filter(r => r.id !== id)
    saveRelationships()
  }

  function updateRelationship(id: string, data: Partial<Omit<Relationship, 'id' | 'source' | 'target'>>) {
    const rel = relationships.value.find(r => r.id === id)
    if (rel) {
      Object.assign(rel, data)
      saveRelationships()
    }
  }

  async function autoExtractCharacters(
    onProgress?: (phase: string) => void
  ): Promise<{ added: number; updated: number }> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')

    loading.value = true
    try {
      // Load all chapter content directly via fileAPI
      const projectStore = useProjectStore()
      if (!projectStore.currentProjectName) throw new Error('没有打开的项目')
      const dir = await projectStore.getProjectDir()

      // List volumes
      const volumesDir = await fileAPI.pathJoin(dir, 'volumes')
      const volumeEntries = await fileAPI.listFiles(volumesDir)

      let allContent = ''
      for (const volEntry of volumeEntries) {
        if (!volEntry.isDirectory) continue
        const volDir = await fileAPI.pathJoin(volumesDir, volEntry.name)
        const files = await fileAPI.listFiles(volDir)
        const chapters = files
          .filter(f => !f.isDirectory && f.name.endsWith('.md'))
          .sort((a, b) => a.name.localeCompare(b.name))

        for (const ch of chapters) {
          onProgress?.(`加载章节: ${ch.name}`)
          try {
            const content = await fileAPI.readFile(await fileAPI.pathJoin(volDir, ch.name))
            const body = content.replace(/^<!--meta:.*?-->\s*/s, '')
            // Extract title from first heading or filename
            const titleMatch = body.match(/^#\s+(.+)/m)
            const title = titleMatch ? titleMatch[1] : ch.name
            allContent += `\n\n【${title}】\n${body.slice(0, 5000)}`
          } catch { /* skip */ }
        }
      }

      if (!allContent.trim()) throw new Error('没有找到章节内容')

      allContent = allContent.slice(0, 50000)

      const existingChars = characters.value.map(c =>
        `【${c.name}】${c.role === 'protagonist' ? '主角' : c.role === 'antagonist' ? '反派' : '配角'} ${c.gender} ${c.age}岁 ${c.personality}`
      ).join('\n')

      onProgress?.('AI 分析中...')
      const prompt = renderPrompt(BUILTIN_TEMPLATES.CHARACTER_AUTO_EXTRACT, {
        existingCharacters: existingChars || '（暂无）',
        content: allContent
      })

      const result = await callAI(aiStore.activeProvider, [
        { role: 'system', content: '你是一名专业的小说编辑，擅长从文章中提取人物信息。请以纯JSON格式输出。' },
        { role: 'user', content: prompt }
      ])

      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('AI 返回格式无效')

      const data = JSON.parse(jsonMatch[0])
      const existingNames = new Set(characters.value.map(c => c.name))
      const now = new Date().toISOString()

      let added = 0
      let updated = 0

      // Add new characters
      if (Array.isArray(data.newCharacters)) {
        for (const nc of data.newCharacters) {
          if (!nc.name || existingNames.has(nc.name)) continue
          const char: Character = {
            id: nanoid(),
            name: nc.name,
            gender: nc.gender || '',
            age: nc.age || 0,
            personality: nc.personality || '',
            background: nc.background || '',
            skills: Array.isArray(nc.skills) ? nc.skills : [],
            items: [],
            speechStyle: nc.speechStyle || '',
            goal: nc.goal || '',
            secret: nc.secret || '',
            role: nc.role || 'supporting',
            createdAt: now,
            updatedAt: now
          }
          await saveCharacter(char)
          added++
        }
      }

      // Update existing characters
      if (Array.isArray(data.updatedCharacters)) {
        for (const uc of data.updatedCharacters) {
          if (!uc.name) continue
          const existing = characters.value.find(c => c.name === uc.name)
          if (!existing) continue
          const updated_char: Character = {
            ...existing,
            gender: uc.gender || existing.gender,
            age: uc.age || existing.age,
            personality: uc.personality || existing.personality,
            background: uc.background || existing.background,
            skills: Array.isArray(uc.skills) ? uc.skills : existing.skills,
            speechStyle: uc.speechStyle || existing.speechStyle,
            goal: uc.goal || existing.goal,
            secret: uc.secret || existing.secret,
            role: uc.role || existing.role,
            updatedAt: now
          }
          await saveCharacter(updated_char)
          updated++
        }
      }

      return { added, updated }
    } finally {
      loading.value = false
    }
  }

  /**
   * Lightweight character extraction from a single chapter's content.
   * Called automatically after chapter generation to pick up new characters.
   */
  async function extractCharactersFromContent(
    content: string
  ): Promise<{ added: number }> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider || !content.trim()) return { added: 0 }

    const body = content.replace(/^<!--meta:.*?-->\s*/s, '').replace(/^#\s+.*$/m, '').trim()
    if (!body) return { added: 0 }

    try {
      const existingChars = characters.value.map(c =>
        `【${c.name}】${c.role === 'protagonist' ? '主角' : c.role === 'antagonist' ? '反派' : '配角'} ${c.gender} ${c.age}岁`
      ).join('\n')

      const prompt = renderPrompt(BUILTIN_TEMPLATES.CHARACTER_AUTO_EXTRACT, {
        existingCharacters: existingChars || '（暂无）',
        content: body.slice(0, 8000)
      })

      const result = await callAI(aiStore.activeProvider, [
        { role: 'system', content: '你是一名专业的小说编辑，擅长从文章中提取人物信息。请以纯JSON格式输出。' },
        { role: 'user', content: prompt }
      ])

      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return { added: 0 }

      const data = JSON.parse(jsonMatch[0])
      const existingNames = new Set(characters.value.map(c => c.name))
      const now = new Date().toISOString()
      let added = 0

      if (Array.isArray(data.newCharacters)) {
        for (const nc of data.newCharacters) {
          if (!nc.name || existingNames.has(nc.name)) continue
          const char: Character = {
            id: nanoid(),
            name: nc.name,
            gender: nc.gender || '',
            age: nc.age || 0,
            personality: nc.personality || '',
            background: nc.background || '',
            skills: Array.isArray(nc.skills) ? nc.skills : [],
            items: [],
            speechStyle: nc.speechStyle || '',
            goal: nc.goal || '',
            secret: nc.secret || '',
            role: nc.role || 'supporting',
            createdAt: now,
            updatedAt: now
          }
          await saveCharacter(char)
          existingNames.add(nc.name)
          added++
        }
      }

      return { added }
    } catch {
      // Silently fail — character extraction is a non-critical background task
      return { added: 0 }
    }
  }

  return {
    characters,
    relationships,
    loading,
    loadCharacters,
    saveCharacter,
    deleteCharacter,
    createEmptyCharacter,
    generateCharacter,
    loadRelationships,
    saveRelationships,
    addRelationship,
    removeRelationship,
    updateRelationship,
    autoExtractCharacters,
    extractCharactersFromContent
  }
})
