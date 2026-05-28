import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { NovelProject } from '@/types/project'
import { BUILTIN_TEMPLATES } from '@/utils/promptTemplates'
import { fileAPI } from '@/utils/fileAPI'

export const useProjectStore = defineStore('project', () => {
  const projects = ref<NovelProject[]>([])
  const currentProject = ref<NovelProject | null>(null)
  const currentProjectName = ref('')

  async function loadProjectList() {
    const novelsDir = await fileAPI.getNovelsDir()
    await fileAPI.ensureDirectory(novelsDir)
    const entries = await fileAPI.listFiles(novelsDir)
    const dirs = entries.filter((e: { name: string; isDirectory: boolean }) => e.isDirectory)

    const loaded: NovelProject[] = []
    for (const dir of dirs) {
      try {
        const jsonPath = await fileAPI.pathJoin(novelsDir, dir.name, 'project.json')
        const content = await fileAPI.readFile(jsonPath)
        const project = JSON.parse(content) as NovelProject
        loaded.push(project)
      } catch {
        // 跳过无效项目
      }
    }
    projects.value = loaded
  }

  async function createProject(data: Omit<NovelProject, 'createdAt' | 'updatedAt'>) {
    const novelsDir = await fileAPI.getNovelsDir()
    const projectDir = await fileAPI.pathJoin(novelsDir, data.name)

    const now = new Date().toISOString()
    const project: NovelProject = {
      ...data,
      createdAt: now,
      updatedAt: now
    }

    // 创建目录结构
    const dirs = ['', 'outline', 'volumes', 'characters', 'graph', 'memory', 'settings']
    for (const dir of dirs) {
      await fileAPI.ensureDirectory(
        await fileAPI.pathJoin(projectDir, dir)
      )
    }

    // 写入项目文件
    await fileAPI.writeFile(
      await fileAPI.pathJoin(projectDir, 'project.json'),
      JSON.stringify(project, null, 2)
    )

    // 初始化大纲文件
    for (const name of ['总纲', '世界观', '支线']) {
      await fileAPI.writeFile(
        await fileAPI.pathJoin(projectDir, 'outline', `${name}.md`),
        `# ${name}\n\n`
      )
    }

    // 初始化人物关系
    await fileAPI.writeFile(
      await fileAPI.pathJoin(projectDir, 'graph', 'relations.json'),
      JSON.stringify({ nodes: [], edges: [] }, null, 2)
    )

    // 初始化记忆文件
    await fileAPI.writeFile(
      await fileAPI.pathJoin(projectDir, 'memory', 'timeline.json'),
      '[]'
    )
    await fileAPI.writeFile(
      await fileAPI.pathJoin(projectDir, 'memory', 'summaries.json'),
      '[]'
    )

    // 初始化 Prompt 模板
    await fileAPI.writeFile(
      await fileAPI.pathJoin(projectDir, 'settings', 'prompt.json'),
      JSON.stringify(BUILTIN_TEMPLATES, null, 2)
    )

    projects.value.push(project)
    return project
  }

  async function openProject(name: string) {
    const novelsDir = await fileAPI.getNovelsDir()
    const jsonPath = await fileAPI.pathJoin(novelsDir, name, 'project.json')
    const content = await fileAPI.readFile(jsonPath)
    currentProject.value = JSON.parse(content) as NovelProject
    currentProjectName.value = name
  }

  async function deleteProject(name: string) {
    const novelsDir = await fileAPI.getNovelsDir()
    const projectDir = await fileAPI.pathJoin(novelsDir, name)
    await fileAPI.deleteDirectory(projectDir)
    projects.value = projects.value.filter(p => p.name !== name)
    if (currentProjectName.value === name) {
      currentProject.value = null
      currentProjectName.value = ''
    }
  }

  async function getProjectDir(name?: string) {
    const novelsDir = await fileAPI.getNovelsDir()
    return fileAPI.pathJoin(novelsDir, name || currentProjectName.value)
  }

  return {
    projects,
    currentProject,
    currentProjectName,
    loadProjectList,
    createProject,
    openProject,
    deleteProject,
    getProjectDir
  }
})
