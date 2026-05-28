import { defineStore } from 'pinia'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import type { ChapterMeta, ChapterStatus } from '@/types/chapter'
import { useProjectStore } from '@/stores/project'
import { useAIStore } from '@/stores/ai'
import { useCharacterStore } from '@/stores/character'
import { useVolumeStore } from '@/stores/volume'
import { callAI } from '@/api/ai'
import { renderPrompt, BUILTIN_TEMPLATES } from '@/utils/promptTemplates'
import { countWords } from '@/utils/wordCount'
import { fileAPI } from '@/utils/fileAPI'
import { sleep } from '@/utils/helpers'

export const useChapterStore = defineStore('chapter', () => {
  const chapters = ref<ChapterMeta[]>([])
  const chaptersByVolume = ref<Record<string, ChapterMeta[]>>({})
  const currentContent = ref('')
  const loading = ref(false)

  function getVolumeDirName(volumeId: string): string | null {
    const projectStore = useProjectStore()
    // Find volume by id from the store
    const { volumes } = useVolumeStore()
    const vol = volumes.find(v => v.id === volumeId)
    return vol?.name || null
  }

  async function loadChapters(volumeId: string) {
    const projectStore = useProjectStore()
    const { volumes } = useVolumeStore()
    if (!projectStore.currentProjectName) return

    const vol = volumes.find(v => v.id === volumeId)
    if (!vol) return

    const dir = await projectStore.getProjectDir()
    const volDir = await fileAPI.pathJoin(dir, 'volumes', vol.name)
    const entries = await fileAPI.listFiles(volDir)
    const mdFiles = entries
      .filter((e: { name: string; isDirectory: boolean }) => !e.isDirectory && e.name.endsWith('.md'))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))

    const loaded: ChapterMeta[] = []
    for (const file of mdFiles) {
      try {
        const content = await fileAPI.readFile(
          await fileAPI.pathJoin(volDir, file.name)
        )
        // Parse metadata from first line comment
        const metaMatch = content.match(/^<!--meta:(.*?)-->/s)
        let meta: Partial<ChapterMeta> = {}
        if (metaMatch) {
          try { meta = JSON.parse(metaMatch[1]) } catch { /* ignore */ }
        }

        const titleMatch = content.match(/^<!--meta:.*?-->\s*#\s*(.+)$/m)
        const title = titleMatch?.[1]?.trim() || file.name.replace('.md', '')

        loaded.push({
          id: meta.id || nanoid(),
          volumeId,
          filename: file.name,
          title: meta.title || title,
          outline: meta.outline || '',
          wordCount: countWords(content),
          status: meta.status || 'outline',
          createdAt: meta.createdAt || new Date().toISOString(),
          updatedAt: meta.updatedAt || new Date().toISOString()
        })
      } catch { /* skip */ }
    }
    chapters.value = loaded
  }

  async function loadChaptersForVolume(volumeId: string, volumeName?: string): Promise<ChapterMeta[]> {
    const projectStore = useProjectStore()
    const { volumes } = useVolumeStore()
    if (!projectStore.currentProjectName) return []

    let volName = volumeName
    if (!volName) {
      const vol = volumes.find(v => v.id === volumeId)
      if (!vol) return []
      volName = vol.name
    }

    const dir = await projectStore.getProjectDir()
    const volDir = await fileAPI.pathJoin(dir, 'volumes', volName)
    const entries = await fileAPI.listFiles(volDir)
    const mdFiles = entries
      .filter((e: { name: string; isDirectory: boolean }) => !e.isDirectory && e.name.endsWith('.md'))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))

    const loaded: ChapterMeta[] = []
    for (const file of mdFiles) {
      try {
        const content = await fileAPI.readFile(
          await fileAPI.pathJoin(volDir, file.name)
        )
        const metaMatch = content.match(/^<!--meta:(.*?)-->/s)
        let meta: Partial<ChapterMeta> = {}
        if (metaMatch) {
          try { meta = JSON.parse(metaMatch[1]) } catch { /* ignore */ }
        }

        const titleMatch = content.match(/^<!--meta:.*?-->\s*#\s*(.+)$/m)
        const title = titleMatch?.[1]?.trim() || file.name.replace('.md', '')

        loaded.push({
          id: meta.id || nanoid(),
          volumeId,
          filename: file.name,
          title: meta.title || title,
          outline: meta.outline || '',
          wordCount: countWords(content),
          status: meta.status || 'outline',
          createdAt: meta.createdAt || new Date().toISOString(),
          updatedAt: meta.updatedAt || new Date().toISOString()
        })
      } catch { /* skip */ }
    }
    chaptersByVolume.value[volumeId] = loaded
    return loaded
  }

  async function loadChapterContent(volumeId: string, filename: string) {
    const projectStore = useProjectStore()
    const { volumes } = useVolumeStore()
    if (!projectStore.currentProjectName) return ''
    const vol = volumes.find(v => v.id === volumeId)
    if (!vol) return ''

    const dir = await projectStore.getProjectDir()
    const filePath = await fileAPI.pathJoin(dir, 'volumes', vol.name, filename)
    try {
      const raw = await fileAPI.readFile(filePath)
      // Strip meta comment
      currentContent.value = raw.replace(/^<!--meta:.*?-->\s*/s, '')
      return currentContent.value
    } catch {
      currentContent.value = ''
      return ''
    }
  }

  async function saveChapterContent(volumeId: string, chapter: ChapterMeta, volumeName?: string) {
    const projectStore = useProjectStore()
    const { volumes } = useVolumeStore()
    if (!projectStore.currentProjectName) return

    let volName = volumeName
    if (!volName) {
      const vol = volumes.find(v => v.id === volumeId)
      if (!vol) return
      volName = vol.name
    }

    const dir = await projectStore.getProjectDir()
    const filePath = await fileAPI.pathJoin(dir, 'volumes', volName, chapter.filename)

    const meta = {
      id: chapter.id,
      title: chapter.title,
      outline: chapter.outline,
      status: chapter.status,
      createdAt: chapter.createdAt,
      updatedAt: new Date().toISOString()
    }

    const content = `<!--meta:${JSON.stringify(meta)}-->\n# ${chapter.title}\n\n${currentContent.value}`
    await fileAPI.writeFile(filePath, content)

    // Update chapter word count
    chapter.wordCount = countWords(currentContent.value)
    chapter.updatedAt = meta.updatedAt
  }

  async function createChapter(volumeId: string, title: string, volumeName?: string) {
    const projectStore = useProjectStore()
    const { volumes } = useVolumeStore()
    if (!projectStore.currentProjectName) return null

    let volName = volumeName
    if (!volName) {
      const vol = volumes.find(v => v.id === volumeId)
      if (!vol) return null
      volName = vol.name
    }

    const existingVolumeChapters = chaptersByVolume.value[volumeId] || []
    const chapterNum = existingVolumeChapters.length + 1
    const filename = `chapter_${String(chapterNum).padStart(3, '0')}.md`
    const now = new Date().toISOString()

    const chapter: ChapterMeta = {
      id: nanoid(),
      volumeId,
      filename,
      title,
      outline: '',
      wordCount: 0,
      status: 'outline',
      createdAt: now,
      updatedAt: now
    }

    const dir = await projectStore.getProjectDir()
    const filePath = await fileAPI.pathJoin(dir, 'volumes', volName, filename)
    const metaStr = JSON.stringify({
      id: chapter.id, title: chapter.title, outline: '',
      status: 'outline', createdAt: now, updatedAt: now
    })
    await fileAPI.writeFile(
      filePath,
      `<!--meta:${metaStr}-->\n# ${title}\n\n`
    )

    chapters.value.push(chapter)
    if (chaptersByVolume.value[volumeId]) {
      chaptersByVolume.value[volumeId].push(chapter)
    }
    return chapter
  }

  async function deleteChapter(volumeId: string, chapterId: string) {
    const { volumes } = useVolumeStore()
    const vol = volumes.find(v => v.id === volumeId)
    if (!vol) throw new Error('卷不存在')

    const ch = (chaptersByVolume.value[volumeId] || []).find(c => c.id === chapterId)
    if (!ch) throw new Error('章节不存在')

    const projectStore = useProjectStore()
    const dir = await projectStore.getProjectDir()
    const filePath = await fileAPI.pathJoin(dir, 'volumes', vol.name, ch.filename)
    await fileAPI.deleteFile(filePath)

    chapters.value = chapters.value.filter(c => c.id !== chapterId)
    if (chaptersByVolume.value[volumeId]) {
      chaptersByVolume.value[volumeId] = chaptersByVolume.value[volumeId].filter(c => c.id !== chapterId)
    }
  }

  async function loadPromptTemplates(): Promise<Record<string, string>> {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return BUILTIN_TEMPLATES
    const dir = await projectStore.getProjectDir()
    try {
      const content = await fileAPI.readFile(
        await fileAPI.pathJoin(dir, 'settings', 'prompt.json')
      )
      return { ...BUILTIN_TEMPLATES, ...JSON.parse(content) }
    } catch {
      return BUILTIN_TEMPLATES
    }
  }

  async function loadWritingStyle(): Promise<string> {
    const projectStore = useProjectStore()
    if (!projectStore.currentProjectName) return ''
    const dir = await projectStore.getProjectDir()
    try {
      return await fileAPI.readFile(
        await fileAPI.pathJoin(dir, 'settings', 'writingStyle.txt')
      )
    } catch { return '' }
  }

  async function buildContext(): Promise<{ characters: string; worldview: string; prevSummary: string }> {
    const projectStore = useProjectStore()
    const charStore = useCharacterStore()
    if (!projectStore.currentProjectName) {
      return { characters: '', worldview: '', prevSummary: '' }
    }

    // Load characters
    await charStore.loadCharacters()
    const charBlock = charStore.characters.map(c =>
      `【${c.name}】性别:${c.gender} 年龄:${c.age}\n性格:${c.personality}\n背景:${c.background}\n说话风格:${c.speechStyle}\n目标:${c.goal}\n秘密:${c.secret}`
    ).join('\n\n')

    // Load worldview
    const dir = await projectStore.getProjectDir()
    let worldview = ''
    try {
      worldview = await fileAPI.readFile(
        await fileAPI.pathJoin(dir, 'outline', '世界观.md')
      )
    } catch { /* not found */ }

    // Load previous summary
    let prevSummary = ''
    try {
      const content = await fileAPI.readFile(
        await fileAPI.pathJoin(dir, 'memory', 'summaries.json')
      )
      const summaries = JSON.parse(content)
      if (Array.isArray(summaries) && summaries.length > 0) {
        prevSummary = summaries[summaries.length - 1]?.content || ''
      }
    } catch { /* not found */ }

    return { characters: charBlock, worldview, prevSummary }
  }

  async function buildChapterContext(
    volumeId: string,
    currentChapterId: string
  ): Promise<{ characters: string; worldview: string; prevContent: string; writingStyle: string }> {
    const projectStore = useProjectStore()
    const charStore = useCharacterStore()
    if (!projectStore.currentProjectName) {
      return { characters: '', worldview: '', prevContent: '', writingStyle: '' }
    }

    // Load characters
    await charStore.loadCharacters()
    const charBlock = charStore.characters.map(c =>
      `【${c.name}】性别:${c.gender} 年龄:${c.age}\n性格:${c.personality}\n背景:${c.background}\n说话风格:${c.speechStyle}\n目标:${c.goal}\n秘密:${c.secret}`
    ).join('\n\n')

    // Load worldview
    const dir = await projectStore.getProjectDir()
    let worldview = ''
    try {
      worldview = await fileAPI.readFile(
        await fileAPI.pathJoin(dir, 'outline', '世界观.md')
      )
    } catch { /* not found */ }

    // Load previous chapter contents within the same volume
    const allChapters = chaptersByVolume.value[volumeId] || []
    const currentIdx = allChapters.findIndex(c => c.id === currentChapterId)
    const prevChapters = currentIdx > 0
      ? allChapters.slice(Math.max(0, currentIdx - 2), currentIdx)
      : []

    let prevContent = ''
    const volName = getVolumeDirName(volumeId)
    if (volName) {
      for (const ch of prevChapters) {
        try {
          const content = await fileAPI.readFile(
            await fileAPI.pathJoin(dir, 'volumes', volName, ch.filename)
          )
          const body = content.replace(/^<!--meta:.*?-->\s*#.*?\n/s, '')
          prevContent += `\n\n【${ch.title}】\n${body.trim()}`
        } catch { /* skip */ }
      }
    }

    // Fallback to prevSummary if no previous chapters exist
    if (!prevContent) {
      try {
        const summaryContent = await fileAPI.readFile(
          await fileAPI.pathJoin(dir, 'memory', 'summaries.json')
        )
        const summaries = JSON.parse(summaryContent)
        if (Array.isArray(summaries) && summaries.length > 0) {
          prevContent = summaries[summaries.length - 1]?.content || ''
        }
      } catch { /* not found */ }
    }

    // Load writing style reference
    const writingStyle = await loadWritingStyle()

    return { characters: charBlock, worldview, prevContent, writingStyle }
  }

  async function generateOutline(
    volumeId: string,
    currentChapterId: string,
    volumeOutline: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')
    loading.value = true
    try {
      const templates = await loadPromptTemplates()
      const ctx = await buildChapterContext(volumeId, currentChapterId)
      const prompt = renderPrompt(templates.CHAPTER_OUTLINE_GEN, {
        volumeOutline,
        prevContent: ctx.prevContent,
        characters: ctx.characters
      })
      return await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名顶级中文网络小说作者。' },
          { role: 'user', content: prompt }
        ],
        undefined,
        { onToken }
      )
    } finally {
      loading.value = false
    }
  }

  async function generateContent(
    volumeId: string,
    currentChapterId: string,
    chapterOutline: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')
    loading.value = true
    try {
      const templates = await loadPromptTemplates()
      const ctx = await buildChapterContext(volumeId, currentChapterId)
      const prompt = renderPrompt(templates.CHAPTER_CONTENT_GEN, {
        characters: ctx.characters,
        worldview: ctx.worldview,
        prevContent: ctx.prevContent,
        chapterOutline,
        writingStyle: ctx.writingStyle
      })
      return await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名顶级中文网络小说作者。' },
          { role: 'user', content: prompt }
        ],
        undefined,
        { onToken }
      )
    } finally {
      loading.value = false
    }
  }

  async function polishContent(
    content: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')
    loading.value = true
    try {
      const templates = await loadPromptTemplates()
      const writingStyle = await loadWritingStyle()
      const prompt = renderPrompt(templates.CHAPTER_POLISH, { content, writingStyle })
      return await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名顶级中文网络小说作者。' },
          { role: 'user', content: prompt }
        ],
        undefined,
        { onToken }
      )
    } finally {
      loading.value = false
    }
  }

  async function deAIContent(
    content: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')
    loading.value = true
    try {
      const templates = await loadPromptTemplates()
      const writingStyle = await loadWritingStyle()
      const prompt = renderPrompt(templates.CHAPTER_DE_AI, { content, writingStyle })
      return await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名顶级中文网络小说作者。' },
          { role: 'user', content: prompt }
        ],
        undefined,
        { onToken }
      )
    } finally {
      loading.value = false
    }
  }

  async function generateSummary(
    content: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')
    loading.value = true
    try {
      const templates = await loadPromptTemplates()
      const prompt = renderPrompt(templates.CHAPTER_SUMMARY, { content })
      const result = await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名专业的小说编辑。' },
          { role: 'user', content: prompt }
        ],
        undefined,
        { onToken }
      )

      // Save summary to memory/summaries.json
      const projectStore = useProjectStore()
      if (projectStore.currentProjectName) {
        const dir = await projectStore.getProjectDir()
        const summaryPath = await fileAPI.pathJoin(dir, 'memory', 'summaries.json')
        let summaries: Array<{ id: string; content: string; createdAt: string }> = []
        try {
          const raw = await fileAPI.readFile(summaryPath)
          summaries = JSON.parse(raw)
          if (!Array.isArray(summaries)) summaries = []
        } catch { /* empty */ }
        summaries.push({ id: nanoid(), content: result, createdAt: new Date().toISOString() })
        await fileAPI.writeFile(summaryPath, JSON.stringify(summaries, null, 2))
      }

      return result
    } finally {
      loading.value = false
    }
  }

  async function checkConsistency(
    content: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')
    loading.value = true
    try {
      const templates = await loadPromptTemplates()
      const ctx = await buildContext()
      const prompt = renderPrompt(templates.CONSISTENCY_CHECK, {
        characters: ctx.characters,
        worldview: ctx.worldview,
        content
      })
      return await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名专业的小说编辑，擅长检查逻辑一致性。' },
          { role: 'user', content: prompt }
        ],
        undefined,
        { onToken }
      )
    } finally {
      loading.value = false
    }
  }

  async function getWritingSuggestions(
    currentContent: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')
    loading.value = true
    try {
      const templates = await loadPromptTemplates()
      const ctx = await buildContext()

      // Load outline
      const projectStore = useProjectStore()
      let outline = ''
      if (projectStore.currentProjectName) {
        const dir = await projectStore.getProjectDir()
        try {
          outline = await fileAPI.readFile(
            await fileAPI.pathJoin(dir, 'outline', '总纲.md')
          )
        } catch { /* not found */ }
      }

      const prompt = renderPrompt(templates.WRITING_ASSISTANT, {
        outline,
        characters: ctx.characters,
        prevSummary: ctx.prevSummary,
        currentContent
      })
      return await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名经验丰富的中文网络小说创作顾问。' },
          { role: 'user', content: prompt }
        ],
        undefined,
        { onToken }
      )
    } finally {
      loading.value = false
    }
  }

  async function generateTitles(
    outline: string,
    summary: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')
    loading.value = true
    try {
      const templates = await loadPromptTemplates()
      const prompt = renderPrompt(templates.TITLE_GEN, { outline, summary })
      return await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名专业的小说编辑。请以纯JSON数组格式输出。' },
          { role: 'user', content: prompt }
        ],
        undefined,
        { onToken }
      )
    } finally {
      loading.value = false
    }
  }

  async function generateVolumeOutline(
    volumeDescription: string,
    onToken?: (token: string) => void
  ): Promise<string> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')
    loading.value = true
    try {
      const templates = await loadPromptTemplates()
      const ctx = await buildContext()

      // Load 总纲
      const projectStore = useProjectStore()
      let outline = ''
      if (projectStore.currentProjectName) {
        const dir = await projectStore.getProjectDir()
        try {
          outline = await fileAPI.readFile(
            await fileAPI.pathJoin(dir, 'outline', '总纲.md')
          )
        } catch { /* not found */ }
      }

      const prompt = renderPrompt(templates.VOLUME_OUTLINE_GEN, {
        outline,
        characters: ctx.characters,
        volumeDescription
      })
      return await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名拥有20年以上经验的中文网络小说总编剧。' },
          { role: 'user', content: prompt }
        ],
        undefined,
        { onToken }
      )
    } finally {
      loading.value = false
    }
  }

  function parseVolumeOutlineChapters(outline: string): string[] {
    // Try to extract chapter titles from volume outline
    // Match patterns like "第1章", "第一章", "第1话", "第一章：xxx", "## 第一章" etc.
    const lines = outline.split('\n')
    const titles: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      // Match chapter headers: "第...章" or "第...话" with optional markdown prefix
      const match = trimmed.match(/(?:^#+\s*)?第[一二三四五六七八九十百千\d]+[章话节][：:\s]*(.*)$/)
      if (match) {
        const title = match[1].trim() || trimmed.replace(/^#+\s*/, '')
        titles.push(title)
      }
    }

    // Fallback: split by "---" or "===" separators if no chapter markers found
    if (titles.length === 0) {
      const sections = outline.split(/\n[-=]{3,}\n/)
      for (const section of sections) {
        const firstLine = section.trim().split('\n')[0].trim()
        if (firstLine && firstLine.length < 50) {
          titles.push(firstLine)
        }
      }
    }

    return titles
  }

  async function generateAllChapters(
    volumeId: string,
    volumeName: string,
    volumeOutline: string,
    onProgress?: (info: { current: number; total: number; phase: string; chapterTitle: string }) => void
  ): Promise<{ generated: number; totalWords: number }> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')

    if (!volumeOutline?.trim()) throw new Error('请先编写卷纲')

    // Parse chapter titles from volume outline
    const chapterTitles = parseVolumeOutlineChapters(volumeOutline)
    if (chapterTitles.length === 0) throw new Error('卷纲中未找到章节划分，请在卷纲中使用「第X章」标记章节')

    // Pre-load templates, characters, worldview (once)
    const templates = await loadPromptTemplates()
    const charStore = useCharacterStore()
    await charStore.loadCharacters()
    const charBlock = charStore.characters.map(c =>
      `【${c.name}】性别:${c.gender} 年龄:${c.age}\n性格:${c.personality}\n背景:${c.background}\n说话风格:${c.speechStyle}\n目标:${c.goal}\n秘密:${c.secret}`
    ).join('\n\n')

    const projectStore = useProjectStore()
    const dir = await projectStore.getProjectDir()
    let worldview = ''
    try {
      worldview = await fileAPI.readFile(
        await fileAPI.pathJoin(dir, 'outline', '世界观.md')
      )
    } catch { /* not found */ }

    const writingStyle = await loadWritingStyle()

    // Reset global chapters array to prevent cross-volume accumulation
    chapters.value = []
    // Match existing chapters by title, only create missing ones
    await loadChaptersForVolume(volumeId, volumeName)
    const existingChapters = chaptersByVolume.value[volumeId] || []
    const existingByTitle = new Map(existingChapters.map(ch => [ch.title, ch]))
    const allChapters: ChapterMeta[] = []

    for (const title of chapterTitles) {
      const existing = existingByTitle.get(title)
      if (existing) {
        allChapters.push(existing)
      } else {
        const ch = await createChapter(volumeId, title, volumeName)
        if (ch) allChapters.push(ch)
      }
    }

    let generated = 0
    let totalWords = 0

    // AI 调用超时配置（毫秒）
    const TIMEOUT_OUTLINE = 120_000   // 细纲：2 分钟
    const TIMEOUT_CONTENT = 300_000   // 正文：5 分钟
    const TIMEOUT_DEAI = 120_000      // 去AI味：2 分钟
    const CHAPTER_DELAY_MS = 2000     // 章节间暂停：2 秒

    for (let i = 0; i < allChapters.length; i++) {
      const ch = allChapters[i]

      // Skip already completed chapters
      if (ch.status === 'de_ai' || ch.status === 'final') {
        onProgress?.({ current: i + 1, total: allChapters.length, phase: '已跳过', chapterTitle: ch.title })
        continue
      }

      try {
        onProgress?.({ current: i + 1, total: allChapters.length, phase: '生成细纲', chapterTitle: ch.title })

        // Build prevContent from previous chapters (read from disk)
        let prevContent = ''
        const prevChapters = i > 0 ? allChapters.slice(Math.max(0, i - 2), i) : []
        for (const prevCh of prevChapters) {
          try {
            const content = await fileAPI.readFile(
              await fileAPI.pathJoin(dir, 'volumes', volumeName, prevCh.filename)
            )
            const body = content.replace(/^<!--meta:.*?-->\s*#.*?\n/s, '')
            prevContent += `\n\n【${prevCh.title}】\n${body.trim()}`
          } catch { /* skip */ }
        }
        if (!prevContent) {
          try {
            const summaryContent = await fileAPI.readFile(
              await fileAPI.pathJoin(dir, 'memory', 'summaries.json')
            )
            const summaries = JSON.parse(summaryContent)
            if (Array.isArray(summaries) && summaries.length > 0) {
              prevContent = summaries[summaries.length - 1]?.content || ''
            }
          } catch { /* not found */ }
        }

        // Load unresolved plot hooks for context
        let unresolvedHooks = ''
        try {
          const { usePlotHookStore } = await import('@/stores/plothook')
          const hookStore = usePlotHookStore()
          await hookStore.loadHooks()
          unresolvedHooks = hookStore.getUnresolvedText()
        } catch { /* non-critical */ }

        // Generate outline
        const outlinePrompt = renderPrompt(templates.CHAPTER_OUTLINE_GEN, {
          volumeOutline: volumeOutline,
          prevContent,
          unresolvedHooks,
          characters: charBlock
        })
        const outline = await callAI(
          aiStore.activeProvider,
          [
            { role: 'system', content: '你是一名顶级中文网络小说作者。' },
            { role: 'user', content: outlinePrompt }
          ],
          { timeoutMs: TIMEOUT_OUTLINE }
        )

        ch.outline = outline

        // Generate content
        onProgress?.({ current: i + 1, total: allChapters.length, phase: '生成正文', chapterTitle: ch.title })
        const contentPrompt = renderPrompt(templates.CHAPTER_CONTENT_GEN, {
          characters: charBlock,
          worldview,
          prevContent,
          unresolvedHooks,
          chapterOutline: outline,
          writingStyle
        })
        const content = await callAI(
          aiStore.activeProvider,
          [
            { role: 'system', content: '你是一名顶级中文网络小说作者。' },
            { role: 'user', content: contentPrompt }
          ],
          { timeoutMs: TIMEOUT_CONTENT }
        )

        // De-AI the content
        onProgress?.({ current: i + 1, total: allChapters.length, phase: '去AI味', chapterTitle: ch.title })
        const deAIPrompt = renderPrompt(templates.CHAPTER_DE_AI, { content, writingStyle })
        const finalContent = await callAI(
          aiStore.activeProvider,
          [
            { role: 'system', content: '你是一名顶级中文网络小说作者。' },
            { role: 'user', content: deAIPrompt }
          ],
          { timeoutMs: TIMEOUT_DEAI }
        )

        // Save chapter to disk
        currentContent.value = finalContent
        ch.status = 'de_ai'
        await saveChapterContent(volumeId, ch, volumeName)

        // Auto-extract new characters from generated content
        try {
          const charStore = useCharacterStore()
          await charStore.loadCharacters()
          const charResult = await charStore.extractCharactersFromContent(finalContent)
          if (charResult.added > 0) {
            console.log(`[一键成文] 章节「${ch.title}」自动提取 ${charResult.added} 个新人物`)
          }
        } catch { /* non-critical, don't block generation */ }

        // Auto-extract plot hooks from generated content
        try {
          const { usePlotHookStore } = await import('@/stores/plothook')
          const hookStore = usePlotHookStore()
          await hookStore.loadHooks()
          const hookResult = await hookStore.extractHooksFromContent(
            finalContent, ch.title, ch.id, volumeName, volumeId
          )
          if (hookResult.added > 0 || hookResult.resolved > 0) {
            console.log(`[一键成文] 章节「${ch.title}」埋点: 新增 ${hookResult.added}, 解决 ${hookResult.resolved}`)
          }
        } catch { /* non-critical, don't block generation */ }

        generated++
        totalWords += countWords(finalContent)
      } catch (e: any) {
        console.error(`[一键成文] 章节「${ch.title}」生成失败:`, e.message)
        onProgress?.({ current: i + 1, total: allChapters.length, phase: `失败: ${e.message || '未知错误'}`, chapterTitle: ch.title })
        // Continue to next chapter instead of aborting
      }

      // 每生成一篇暂停片刻，避免接口超时或限流
      if (i < allChapters.length - 1) {
        console.log(`[一键成文] 章节「${ch.title}」处理完毕，暂停 ${CHAPTER_DELAY_MS / 1000} 秒后继续下一章...`)
        await sleep(CHAPTER_DELAY_MS)
      }
    }

    return { generated, totalWords }
  }

  async function generateAllContent(
    volumeId: string,
    onProgress?: (info: { current: number; total: number; phase: string; chapterTitle: string }) => void
  ): Promise<{ generated: number; totalWords: number }> {
    const aiStore = useAIStore()
    if (!aiStore.activeProvider) throw new Error('请先配置 AI Provider')

    const volumeStore = useVolumeStore()
    const vol = volumeStore.volumes.find(v => v.id === volumeId)
    if (!vol) throw new Error('卷不存在')

    // Step 1: Generate volume outline if not exists
    if (!vol.outline?.trim()) {
      if (!vol.description?.trim()) {
        throw new Error('卷描述为空，无法生成卷纲')
      }
      onProgress?.({ current: 0, total: 0, phase: '生成卷纲', chapterTitle: '' })

      const templates = await loadPromptTemplates()
      const ctx = await buildContext()

      const projectStore = useProjectStore()
      let totalOutline = ''
      if (projectStore.currentProjectName) {
        const dir = await projectStore.getProjectDir()
        try {
          totalOutline = await fileAPI.readFile(
            await fileAPI.pathJoin(dir, 'outline', '总纲.md')
          )
        } catch { /* not found */ }
      }

      const prompt = renderPrompt(templates.VOLUME_OUTLINE_GEN, {
        outline: totalOutline,
        characters: ctx.characters,
        volumeDescription: vol.description
      })
      const outline = await callAI(
        aiStore.activeProvider,
        [
          { role: 'system', content: '你是一名拥有20年以上经验的中文网络小说总编剧。' },
          { role: 'user', content: prompt }
        ]
      )

      // Save outline to volume
      await volumeStore.updateVolume(volumeId, { outline })
      vol.outline = outline
    }

    // Step 2-4: Generate chapter outlines and content
    return await generateAllChapters(volumeId, vol.name, vol.outline || '', onProgress)
  }

  async function generateAllNovelContent(
    onProgress?: (info: { current: number; total: number; phase: string; chapterTitle: string; volumeName: string }) => void
  ): Promise<{ generated: number; totalWords: number }> {
    const volumeStore = useVolumeStore()
    await volumeStore.loadVolumes()

    // Snapshot volumes to local array — prevents the loop from breaking
    // if volumes.value gets replaced during generation
    const allVolumes = volumeStore.volumes.map(v => ({ ...v }))
    if (allVolumes.length === 0) {
      throw new Error('没有卷，请先创建卷或使用 AI 分卷')
    }

    console.log(`[一键成文] 共 ${allVolumes.length} 卷:`, allVolumes.map(v => v.name))

    let totalGenerated = 0
    let totalWords = 0

    for (let vi = 0; vi < allVolumes.length; vi++) {
      const vol = allVolumes[vi]
      const volumeIndex = vi + 1
      const volumeTotal = allVolumes.length
      console.log(`[一键成文] 开始第 ${volumeIndex}/${volumeTotal} 卷: ${vol.name}`)

      onProgress?.({
        current: volumeIndex,
        total: volumeTotal,
        phase: '生成卷',
        chapterTitle: '',
        volumeName: vol.name
      })

      try {
        const result = await generateAllContent(vol.id, (info) => {
          onProgress?.({
            current: info.current,
            total: info.total,
            phase: `[${vol.name}] ${info.phase}`,
            chapterTitle: info.chapterTitle,
            volumeName: vol.name
          })
        })

        console.log(`[一键成文] 卷「${vol.name}」完成: ${result.generated} 章`)
        totalGenerated += result.generated
        totalWords += result.totalWords
      } catch (e: any) {
        console.error(`[一键成文] 卷「${vol.name}」失败:`, e.message)
        onProgress?.({
          current: volumeIndex,
          total: volumeTotal,
          phase: `跳过: ${e.message || '未知错误'}`,
          chapterTitle: '',
          volumeName: vol.name
        })
      }

      console.log(`[一键成文] 第 ${volumeIndex} 卷处理完毕，继续下一卷...`)
    }

    console.log(`[一键成文] 全部完成: ${totalGenerated} 章, ${totalWords} 字`)
    return { generated: totalGenerated, totalWords }
  }

  return {
    chapters,
    chaptersByVolume,
    currentContent,
    loading,
    loadChapters,
    loadChaptersForVolume,
    loadChapterContent,
    saveChapterContent,
    createChapter,
    deleteChapter,
    generateOutline,
    generateContent,
    generateVolumeOutline,
    generateAllChapters,
    generateAllContent,
    generateAllNovelContent,
    polishContent,
    deAIContent,
    buildContext,
    generateSummary,
    checkConsistency,
    getWritingSuggestions,
    generateTitles
  }
})
