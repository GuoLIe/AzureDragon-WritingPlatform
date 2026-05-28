export interface Character {
  id: string
  name: string
  gender: string
  age: number
  personality: string
  background: string
  skills: string[]
  items: string[]
  speechStyle: string
  goal: string
  secret: string
  role: 'protagonist' | 'antagonist' | 'supporting' | 'minor'
  avatar?: string
  createdAt: string
  updatedAt: string
}

export type RelationshipType =
  | 'friend' | 'enemy' | 'lover' | 'master' | 'subordinate'
  | 'kin' | 'rival' | 'ally' | 'betrayal'

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  friend: '朋友',
  enemy: '敌人',
  lover: '恋人',
  master: '师徒',
  subordinate: '上下级',
  kin: '血缘',
  rival: '竞争',
  ally: '同盟',
  betrayal: '背叛'
}

export const RELATIONSHIP_COLORS: Record<RelationshipType, string> = {
  friend: '#52c41a',
  enemy: '#ff4d4f',
  lover: '#eb2f96',
  master: '#1890ff',
  subordinate: '#722ed1',
  kin: '#fa8c16',
  rival: '#faad14',
  ally: '#13c2c2',
  betrayal: '#f5222d'
}

export interface Relationship {
  id: string
  source: string
  target: string
  type: RelationshipType
  description: string
  strength: number
}

export const CHARACTER_ROLES = [
  { value: 'protagonist', label: '主角' },
  { value: 'antagonist', label: '反派' },
  { value: 'supporting', label: '配角' },
  { value: 'minor', label: '龙套' }
] as const
