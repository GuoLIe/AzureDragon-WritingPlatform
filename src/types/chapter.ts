export interface Volume {
  id: string
  name: string
  description: string
  outline: string
  order: number
  targetWordCount: number
  createdAt: string
}

export type ChapterStatus = 'outline' | 'generated' | 'polished' | 'de_ai' | 'final'

export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  outline: '仅有细纲',
  generated: '已生成正文',
  polished: '已润色',
  de_ai: '已去AI味',
  final: '终稿'
}

export interface ChapterMeta {
  id: string
  volumeId: string
  filename: string
  title: string
  outline: string
  wordCount: number
  status: ChapterStatus
  createdAt: string
  updatedAt: string
}

export interface ChapterContent {
  meta: ChapterMeta
  content: string
}

export type PlotHookStatus = 'unresolved' | 'resolved'
export type PlotHookType = 'foreshadowing' | 'mystery' | 'setup' | 'cliffhanger' | 'promise'

export interface PlotHook {
  id: string
  description: string
  type: PlotHookType
  chapterTitle: string
  chapterId: string
  volumeName: string
  volumeId: string
  status: PlotHookStatus
  resolvedIn?: string
  resolvedChapterId?: string
  createdAt: string
  resolvedAt?: string
}
