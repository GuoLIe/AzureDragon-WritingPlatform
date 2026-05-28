export interface NovelProject {
  name: string
  type: string
  style: string
  tags: string[]
  targetWordCount: number
  targetPlatform: string
  perspective: 'first' | 'third'
  audience: 'male' | 'female'
  pacing: string
  description: string
  createdAt: string
  updatedAt: string
}

export const NOVEL_TYPES = [
  '东方玄幻', '西方奇幻', '都市', '科幻', '武侠', '仙侠',
  '历史', '军事', '游戏', '悬疑', '恐怖', '言情', '其他'
] as const

export const NOVEL_STYLES = ['爽文', '慢热', '轻松', '沉重', '幽默', '热血', '暗黑'] as const

export const TARGET_PLATFORMS = ['起点', '番茄', '飞卢', '晋江', '纵横', '其他'] as const

export const PACING_OPTIONS = ['快节奏', '中等节奏', '慢节奏', '先慢后快'] as const
