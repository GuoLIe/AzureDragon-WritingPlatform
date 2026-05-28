export interface AIProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  topP: number
  contextSize: number
  isActive: boolean
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AIStreamCallbacks {
  onToken?: (token: string) => void
  onComplete?: (fullText: string) => void
  onError?: (error: Error) => void
}

export const DEFAULT_PROVIDER: Omit<AIProvider, 'id'> = {
  name: '',
  baseUrl: 'https://api.openai.com',
  apiKey: '',
  model: 'gpt-4',
  temperature: 0.8,
  maxTokens: 4096,
  topP: 1.0,
  contextSize: 128000,
  isActive: false
}
