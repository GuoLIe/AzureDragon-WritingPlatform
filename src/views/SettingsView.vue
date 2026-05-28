<template>
  <div class="page">
    <h2 class="page-title">设置</h2>
    <div class="settings-tabs-header">
      <n-tabs v-model:value="activeTab" type="line">
        <n-tab-pane name="ai" tab="AI Provider" />
        <n-tab-pane name="prompts" tab="Prompt 模板" />
        <n-tab-pane name="style" tab="写作风格" />
      </n-tabs>
    </div>
    <div class="settings-tab-content">
      <!-- AI Provider Tab -->
      <template v-if="activeTab === 'ai'">
        <div class="settings-scroll">
          <div class="tab-header">
            <n-button type="primary" @click="showAddForm = true">添加 Provider</n-button>
          </div>

          <n-empty v-if="providers.length === 0 && !showAddForm" description="还没有配置 AI Provider">
            <template #extra>
              <n-button type="primary" @click="showAddForm = true">添加</n-button>
            </template>
          </n-empty>

          <!-- Add/Edit Form -->
          <n-card v-if="showAddForm" title="添加 AI Provider" style="margin-bottom: 16px;">
            <n-form :model="formData" label-placement="left" label-width="100">
              <n-form-item label="名称">
                <n-input v-model:value="formData.name" placeholder="例: OpenAI, DeepSeek, 本地Ollama" />
              </n-form-item>
              <n-form-item label="Base URL">
                <n-input v-model:value="formData.baseUrl" placeholder="https://api.openai.com" />
              </n-form-item>
              <n-form-item label="API Key">
                <n-input v-model:value="formData.apiKey" type="password" show-password-on="click" placeholder="sk-..." />
              </n-form-item>
              <n-form-item label="模型">
                <n-input v-model:value="formData.model" placeholder="gpt-4, deepseek-chat" />
              </n-form-item>
              <n-form-item label="Temperature">
                <n-slider v-model:value="formData.temperature" :min="0" :max="2" :step="0.1" />
              </n-form-item>
              <n-form-item label="Max Tokens">
                <n-input-number v-model:value="formData.maxTokens" :min="100" :max="128000" :step="1000" />
              </n-form-item>
              <n-form-item label="Top P">
                <n-slider v-model:value="formData.topP" :min="0" :max="1" :step="0.05" />
              </n-form-item>
              <n-form-item label="上下文长度">
                <n-input-number v-model:value="formData.contextSize" :min="1000" :step="1000" />
              </n-form-item>
            </n-form>
            <template #action>
              <n-space justify="end">
                <n-button @click="showAddForm = false">取消</n-button>
                <n-button @click="handleTest" :loading="testing">测试连接</n-button>
                <n-button type="primary" @click="handleSave">保存</n-button>
              </n-space>
            </template>
          </n-card>

          <!-- Provider List -->
          <div class="provider-grid">
            <n-card v-for="p in providers" :key="p.id" size="small">
              <template #header>
                <n-space align="center">
                  <n-text strong>{{ p.name }}</n-text>
                  <n-tag v-if="p.isActive" type="success" size="small">当前使用</n-tag>
                </n-space>
              </template>
              <n-space vertical size="small">
                <n-text depth="3" style="font-size: 12px;">{{ p.baseUrl }}</n-text>
                <n-text depth="3" style="font-size: 12px;">模型: {{ p.model }}</n-text>
              </n-space>
              <template #action>
                <n-space>
                  <n-button size="small" :type="p.isActive ? 'success' : 'default'" @click="setActive(p.id)">
                    {{ p.isActive ? '已激活' : '设为当前' }}
                  </n-button>
                  <n-button size="small" type="error" quaternary @click="handleRemove(p.id)">删除</n-button>
                </n-space>
              </template>
            </n-card>
          </div>
        </div>
      </template>

      <!-- Prompt Templates Tab -->
      <template v-else-if="activeTab === 'prompts'">
        <template v-if="!currentProjectName">
          <n-empty description="请先打开一个小说项目" />
        </template>
        <template v-else>
          <div class="settings-inner-tabs-header">
            <n-tabs v-model:value="activeGroup" type="card" size="small">
              <n-tab-pane
                v-for="group in templateGroups"
                :key="group.label"
                :name="group.label"
                :tab="group.label"
              />
            </n-tabs>
          </div>
          <div class="settings-inner-content">
            <div class="settings-scroll">
              <n-space vertical size="large">
                <n-card
                  v-for="item in currentGroupTemplates"
                  :key="item.key"
                  size="small"
                >
                  <template #header>
                    <n-space align="center" :size="8">
                      <n-text strong style="font-size: 15px;">{{ item.label }}</n-text>
                      <n-tag size="tiny" type="info">{{ item.key }}</n-tag>
                    </n-space>
                  </template>
                  <template #header-extra>
                    <div style="font-size: 12px; color: rgba(82, 183, 136, 0.6); display: flex; align-items: center; gap: 4px;">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px; flex-shrink: 0;"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      {{ item.usage }}
                    </div>
                  </template>

                  <n-input
                    v-model:value="templates[item.key]"
                    type="textarea"
                    :autosize="{ minRows: 12, maxRows: 40 }"
                    style="font-family: monospace;"
                  />

                  <div v-if="item.variables.length > 0" style="margin-top: 8px; font-size: 11px; color: #787890;">
                    变量: {{ formatVars(item.variables) }}
                  </div>
                </n-card>
              </n-space>

              <div style="margin-top: 16px; text-align: right;">
                <n-space>
                  <n-button @click="resetTemplates">恢复默认</n-button>
                  <n-button type="primary" :loading="savingTemplates" @click="saveTemplates">保存模板</n-button>
                </n-space>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- Writing Style Tab -->
      <template v-else-if="activeTab === 'style'">
        <template v-if="!currentProjectName">
          <n-empty description="请先打开一个小说项目" />
        </template>
        <template v-else>
          <div class="settings-scroll">
            <n-card title="写作风格参考" size="small">
              <template #header-extra>
                <n-text depth="3" style="font-size: 12px;">选择一种风格用于生成正文</n-text>
              </template>
              <div class="style-grid">
                <!-- Custom Style Card (first) -->
                <div
                  class="style-card style-card-custom"
                  :class="{ active: selectedStyleName === '__custom__' }"
                  @click="selectCustomStyle"
                >
                  <div class="style-card-name">自定义</div>
                  <div class="style-card-author">上传文章</div>
                </div>
                <!-- Built-in Styles -->
                <div
                  v-for="s in builtinStyles"
                  :key="s.name"
                  class="style-card"
                  :class="{ active: selectedStyleName === s.name }"
                  @click="selectBuiltinStyle(s)"
                >
                  <div class="style-card-name">{{ s.name }}</div>
                  <div class="style-card-author">{{ s.author }}</div>
                </div>
              </div>

              <!-- Style Content Preview (always shown when a style is selected) -->
              <div v-if="selectedStyleName" style="margin-top: 16px;">
                <n-space align="center" style="margin-bottom: 8px;">
                  <n-text strong>{{ selectedStyleName === '__custom__' ? '自定义风格' : selectedStyleName }}</n-text>
                  <template v-if="selectedStyleName === '__custom__'">
                    <n-button size="tiny" @click="triggerFileUpload">上传文件</n-button>
                    <n-button size="tiny" :loading="savingStyle" type="primary" @click="saveWritingStyle">保存</n-button>
                    <n-button size="tiny" type="error" quaternary @click="clearCustomStyle">清除</n-button>
                  </template>
                  <template v-else>
                    <n-button size="tiny" type="primary" @click="applyBuiltinStyle">使用此风格</n-button>
                  </template>
                </n-space>

                <input
                  ref="fileInputRef"
                  type="file"
                  accept=".txt,.md"
                  style="display: none;"
                  @change="handleFileUpload"
                />

                <n-input
                  v-model:value="previewText"
                  type="textarea"
                  :autosize="{ minRows: 8, maxRows: 24 }"
                  :readonly="selectedStyleName !== '__custom__'"
                  :placeholder="selectedStyleName === '__custom__' ? '粘贴一段你自己写的文章（建议 500-2000 字）...' : ''"
                />
              </div>

              <div style="margin-top: 12px; font-size: 12px; color: #787890; line-height: 1.6;">
                系统在生成正文、润色、去 AI 味时，会参考所选风格的句式、用词习惯、节奏感，让 AI 生成的内容更贴近该风格。
              </div>
            </n-card>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useAIStore } from '@/stores/ai'
import { useProjectStore } from '@/stores/project'
import { DEFAULT_PROVIDER } from '@/types/ai'
import { callAINonStream } from '@/api/ai'
import { BUILTIN_TEMPLATES } from '@/utils/promptTemplates'
import { BUILTIN_STYLES } from '@/utils/builtinStyles'
import { fileAPI } from '@/utils/fileAPI'

const message = useMessage()
const aiStore = useAIStore()
const projectStore = useProjectStore()

const providers = aiStore.providers
const showAddForm = ref(false)
const testing = ref(false)
const savingTemplates = ref(false)
const activeTab = ref('ai')
const activeGroup = ref('大纲')
const writingStyleText = ref('') // saved custom style content
const previewText = ref('') // currently displayed content in textarea
const savingStyle = ref(false)
const selectedStyleName = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

const currentProjectName = computed(() => projectStore.currentProjectName)

const formData = reactive({
  name: '',
  baseUrl: DEFAULT_PROVIDER.baseUrl,
  apiKey: '',
  model: DEFAULT_PROVIDER.model,
  temperature: DEFAULT_PROVIDER.temperature,
  maxTokens: DEFAULT_PROVIDER.maxTokens,
  topP: DEFAULT_PROVIDER.topP,
  contextSize: DEFAULT_PROVIDER.contextSize
})

const builtinStyles = BUILTIN_STYLES

function selectBuiltinStyle(style: { name: string; content: string }) {
  selectedStyleName.value = style.name
  previewText.value = style.content
}

function selectCustomStyle() {
  selectedStyleName.value = '__custom__'
  previewText.value = writingStyleText.value
}

async function applyBuiltinStyle() {
  if (!projectStore.currentProjectName || !previewText.value.trim()) return
  savingStyle.value = true
  try {
    const dir = await projectStore.getProjectDir()
    await fileAPI.writeFile(
      await fileAPI.pathJoin(dir, 'settings', 'writingStyle.txt'),
      previewText.value
    )
    writingStyleText.value = previewText.value
    message.success(`已保存「${selectedStyleName.value}」风格`)
  } catch (e: any) {
    message.error('保存失败: ' + e.message)
  } finally {
    savingStyle.value = false
  }
}

async function clearCustomStyle() {
  if (!projectStore.currentProjectName) return
  try {
    const dir = await projectStore.getProjectDir()
    await fileAPI.deleteFile(
      await fileAPI.pathJoin(dir, 'settings', 'writingStyle.txt')
    )
    writingStyleText.value = ''
    previewText.value = ''
    selectedStyleName.value = ''
    message.success('已清除')
  } catch { /* file might not exist */ }
}


onMounted(async () => {
  await loadProjectTemplates()
  await loadWritingStyle()
})

interface TemplateMeta {
  key: string
  label: string
  usage: string
  variables: string[]
}

const templateGroups = computed<{ label: string; templates: TemplateMeta[] }[]>(() => [
  {
    label: '大纲',
    templates: [
      { key: 'OUTLINE_POLISH', label: '大纲润色', usage: '大纲页面 → 点击「AI 润色」按钮', variables: ['outline'] },
      { key: 'OUTLINE_EXPAND', label: '大纲扩写', usage: '大纲页面 → 点击「AI 扩写」按钮', variables: ['outline'] },
      { key: 'VOLUME_OUTLINE_GEN', label: '卷纲生成', usage: '卷与章节 → 点击卷节点 → 「AI 生成卷纲」', variables: ['outline', 'characters', 'volumeDescription'] },
    ]
  },
  {
    label: '章节生成流水线',
    templates: [
      { key: 'CHAPTER_OUTLINE_GEN', label: '章节细纲生成', usage: '章节编辑页右侧面板 → 生成流水线 → 第1步「生成细纲」', variables: ['volumeOutline', 'prevContent', 'characters'] },
      { key: 'CHAPTER_CONTENT_GEN', label: '章节正文生成', usage: '章节编辑页右侧面板 → 生成流水线 → 第2步「生成正文」', variables: ['characters', 'worldview', 'prevContent', 'chapterOutline', 'writingStyle'] },
      { key: 'CHAPTER_POLISH', label: '章节润色', usage: '章节编辑页右侧面板 → 生成流水线 → 第3步「AI 润色」', variables: ['content', 'writingStyle'] },
      { key: 'CHAPTER_DE_AI', label: '去 AI 味', usage: '章节编辑页右侧面板 → 生成流水线 → 第4步「去 AI 味」', variables: ['content', 'writingStyle'] },
    ]
  },
  {
    label: '章节工具',
    templates: [
      { key: 'CHAPTER_SUMMARY', label: '章节摘要', usage: '章节编辑页右侧面板 → AI 工具 →「生成章节摘要」', variables: ['content'] },
      { key: 'CONSISTENCY_CHECK', label: '一致性检查', usage: '章节编辑页右侧面板 → AI 工具 →「一致性检查」', variables: ['characters', 'worldview', 'content'] },
      { key: 'WRITING_ASSISTANT', label: '卡文助手', usage: '章节编辑页右侧面板 → AI 工具 →「卡文助手」', variables: ['outline', 'characters', 'prevSummary', 'currentContent'] },
      { key: 'TITLE_GEN', label: '标题生成', usage: '章节编辑页右侧面板 → AI 工具 →「AI 生成标题」', variables: ['outline', 'summary'] },
    ]
  },
  {
    label: '人物',
    templates: [
      { key: 'CHARACTER_GEN', label: '人物生成', usage: '人物管理页面 → 点击「AI 生成人物」按钮', variables: ['hint'] },
      { key: 'CHARACTER_RELATION_ANALYSIS', label: '人物关系分析', usage: '关系图谱页面 → 点击「AI 分析关系」按钮', variables: ['characters', 'content'] },
    ]
  },
  {
    label: '项目与分卷',
    templates: [
      { key: 'AI_PROJECT_GEN', label: 'AI 辅助创建项目', usage: '项目列表 → 创建小说对话框 → 使用 AI 生成设定', variables: ['type', 'style', 'description'] },
      { key: 'AUTO_VOLUME_SPLIT', label: '自动分卷', usage: '卷管理页面 → 点击「AI 自动分卷」按钮', variables: ['outline'] },
    ]
  },
])

const currentGroupTemplates = computed(() => {
  const group = templateGroups.value.find(g => g.label === activeGroup.value)
  return group?.templates || []
})

const templates = ref<Record<string, string>>({ ...BUILTIN_TEMPLATES })

function formatVars(vars: string[]): string {
  return vars.map(v => '{{' + v + '}}').join(', ')
}

watch(currentProjectName, async () => {
  await loadProjectTemplates()
  await loadWritingStyle()
})

async function loadProjectTemplates() {
  if (!projectStore.currentProjectName) return
  try {
    const dir = await projectStore.getProjectDir()
    const content = await fileAPI.readFile(
      await fileAPI.pathJoin(dir, 'settings', 'prompt.json')
    )
    templates.value = { ...BUILTIN_TEMPLATES, ...JSON.parse(content) }
  } catch {
    templates.value = { ...BUILTIN_TEMPLATES }
  }
}

async function saveTemplates() {
  if (!projectStore.currentProjectName) return
  savingTemplates.value = true
  try {
    const dir = await projectStore.getProjectDir()
    await fileAPI.writeFile(
      await fileAPI.pathJoin(dir, 'settings', 'prompt.json'),
      JSON.stringify(templates.value, null, 2)
    )
    message.success('模板已保存')
  } catch (e: any) {
    message.error('保存失败: ' + e.message)
  } finally {
    savingTemplates.value = false
  }
}

function resetTemplates() {
  templates.value = { ...BUILTIN_TEMPLATES }
  message.info('已恢复默认模板，请点击保存')
}

async function handleTest() {
  testing.value = true
  try {
    const result = await callAINonStream(
      { ...formData, id: '', isActive: false },
      [{ role: 'user', content: '说"连接成功"' }]
    )
    message.success('连接成功: ' + result.slice(0, 50))
  } catch (e: any) {
    message.error('连接失败: ' + (e.message || '未知错误'))
  } finally {
    testing.value = false
  }
}

async function handleSave() {
  if (!formData.name) {
    message.warning('请输入名称')
    return
  }
  await aiStore.addProvider({ ...formData, isActive: false })
  showAddForm.value = false
  message.success('已保存')
  formData.name = ''
  formData.apiKey = ''
}

async function setActive(id: string) {
  await aiStore.setActiveProvider(id)
  message.success('已设为当前 Provider')
}

async function handleRemove(id: string) {
  await aiStore.removeProvider(id)
  message.success('已删除')
}

async function loadWritingStyle() {
  if (!projectStore.currentProjectName) {
    writingStyleText.value = ''
    previewText.value = ''
    selectedStyleName.value = ''
    return
  }
  try {
    const dir = await projectStore.getProjectDir()
    writingStyleText.value = await fileAPI.readFile(
      await fileAPI.pathJoin(dir, 'settings', 'writingStyle.txt')
    )
    if (writingStyleText.value.trim()) {
      selectedStyleName.value = '__custom__'
      previewText.value = writingStyleText.value
    }
  } catch {
    writingStyleText.value = ''
    previewText.value = ''
    selectedStyleName.value = ''
  }
}

async function saveWritingStyle() {
  if (!projectStore.currentProjectName) return
  if (!previewText.value.trim()) {
    message.warning('请输入写作参考文本')
    return
  }
  savingStyle.value = true
  try {
    const dir = await projectStore.getProjectDir()
    await fileAPI.writeFile(
      await fileAPI.pathJoin(dir, 'settings', 'writingStyle.txt'),
      previewText.value
    )
    writingStyleText.value = previewText.value
    message.success('写作风格已保存')
  } catch (e: any) {
    message.error('保存失败: ' + e.message)
  } finally {
    savingStyle.value = false
  }
}

function triggerFileUpload() {
  fileInputRef.value?.click()
}

function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    previewText.value = reader.result as string
    message.success('文件已加载，点击保存生效')
  }
  reader.onerror = () => message.error('文件读取失败')
  reader.readAsText(file, 'utf-8')
  input.value = ''
}
</script>

<style scoped>
.page {
  position: absolute;
  inset: 0;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-tabs-header {
  flex-shrink: 0;
  margin-top: 16px;
}

.settings-tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.settings-scroll {
  padding: 16px 2px 16px 0;
  overflow-y: auto;
  height: 100%;
}

.settings-inner-tabs-header {
  flex-shrink: 0;
  padding-top: 8px;
}

.settings-inner-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tab-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.style-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}

.style-card {
  padding: 12px;
  border: 1px solid rgba(91, 123, 90, 0.15);
  border-radius: 8px;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s;
}

.style-card:hover {
  border-color: rgba(91, 140, 90, 0.4);
  background: rgba(91, 140, 90, 0.05);
}

.style-card.active {
  border-color: rgba(91, 140, 90, 0.8);
  background: rgba(91, 140, 90, 0.1);
}

.style-card-name {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}

.style-card-author {
  font-size: 11px;
  color: #8C8C8C;
}

.style-card-custom {
  border-style: dashed;
  border-color: rgba(91, 123, 90, 0.2);
}

.style-card-custom.active {
  border-style: solid;
}
</style>
