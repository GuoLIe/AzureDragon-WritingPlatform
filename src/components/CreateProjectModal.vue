<template>
  <n-modal v-model:show="visible" preset="card" title="创建新小说" style="width: 560px;">
    <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="80">
      <n-form-item label="小说名称" path="name">
        <n-input v-model:value="form.name" placeholder="请输入小说名称" />
      </n-form-item>
      <n-form-item label="类型" path="type">
        <n-select v-model:value="form.type" :options="typeOptions" placeholder="选择类型" />
      </n-form-item>
      <n-form-item label="风格" path="style">
        <n-select v-model:value="form.style" :options="styleOptions" placeholder="选择风格" />
      </n-form-item>
      <n-form-item label="目标字数" path="targetWordCount">
        <n-input-number v-model:value="form.targetWordCount" :min="10000" :step="100000" style="width: 100%;" placeholder="例: 1000000">
          <template #suffix>字</template>
        </n-input-number>
      </n-form-item>
      <n-form-item label="目标平台">
        <n-select v-model:value="form.targetPlatform" :options="platformOptions" placeholder="选择平台" clearable />
      </n-form-item>
      <n-form-item label="视角">
        <n-radio-group v-model:value="form.perspective">
          <n-radio value="third">第三人称</n-radio>
          <n-radio value="first">第一人称</n-radio>
        </n-radio-group>
      </n-form-item>
      <n-form-item label="受众">
        <n-radio-group v-model:value="form.audience">
          <n-radio value="male">男频</n-radio>
          <n-radio value="female">女频</n-radio>
        </n-radio-group>
      </n-form-item>
      <n-form-item label="节奏">
        <n-select v-model:value="form.pacing" :options="pacingOptions" placeholder="选择节奏" />
      </n-form-item>
      <n-form-item label="简介">
        <n-input v-model:value="form.description" type="textarea" :rows="3" placeholder="简单描述你的小说创意..." />
      </n-form-item>
    </n-form>

    <n-collapse v-if="aiResult" style="margin-top: 12px;">
      <n-collapse-item title="AI 生成的设定（可编辑）" name="ai-result">
        <n-tabs type="line" size="small">
          <n-tab-pane name="worldview" tab="世界观">
            <n-input v-model:value="aiResult.worldview" type="textarea" :autosize="{ minRows: 6, maxRows: 15 }" />
          </n-tab-pane>
          <n-tab-pane name="outline" tab="总纲">
            <n-input v-model:value="aiResult.outline" type="textarea" :autosize="{ minRows: 6, maxRows: 15 }" />
          </n-tab-pane>
          <n-tab-pane name="subplots" tab="支线">
            <n-input v-model:value="aiResult.subplots" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" />
          </n-tab-pane>
          <n-tab-pane name="characters" tab="人物">
            <n-space vertical size="small">
              <n-card v-for="(c, i) in aiResult.characters" :key="i" size="small">
                <n-space vertical size="small">
                  <n-space>
                    <n-input v-model:value="c.name" size="small" style="width: 100px;" placeholder="姓名" />
                    <n-tag size="small" :type="c.role === 'protagonist' ? 'warning' : c.role === 'antagonist' ? 'error' : 'info'">
                      {{ c.role === 'protagonist' ? '主角' : c.role === 'antagonist' ? '反派' : '配角' }}
                    </n-tag>
                  </n-space>
                  <n-input v-model:value="c.personality" size="small" placeholder="性格" />
                  <n-input v-model:value="c.background" size="small" type="textarea" :rows="2" placeholder="背景" />
                </n-space>
              </n-card>
            </n-space>
          </n-tab-pane>
        </n-tabs>
      </n-collapse-item>
    </n-collapse>

    <template #action>
      <n-space justify="end">
        <n-button @click="visible = false">取消</n-button>
        <n-button :loading="aiLoading" :disabled="!form.type || !form.description" @click="handleAIGenerate">
          AI 生成设定
        </n-button>
        <n-button type="primary" :loading="loading" @click="handleSubmit">创建</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { useMessage } from 'naive-ui'
import type { FormInst, FormRules } from 'naive-ui'
import { useProjectStore } from '@/stores/project'
import { useAIStore } from '@/stores/ai'
import { callAI } from '@/api/ai'
import { renderPrompt, BUILTIN_TEMPLATES } from '@/utils/promptTemplates'
import { nanoid } from 'nanoid'
import { NOVEL_TYPES, NOVEL_STYLES, TARGET_PLATFORMS, PACING_OPTIONS } from '@/types/project'
import { fileAPI } from '@/utils/fileAPI'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{
  'update:show': [value: boolean]
  'created': [name: string]
}>()

const message = useMessage()
const projectStore = useProjectStore()
const aiStore = useAIStore()
const formRef = ref<FormInst | null>(null)
const loading = ref(false)
const aiLoading = ref(false)

const visible = ref(props.show)
watch(() => props.show, v => visible.value = v)
watch(visible, v => emit('update:show', v))

const form = reactive({
  name: '',
  type: '东方玄幻',
  style: '爽文',
  tags: [] as string[],
  targetWordCount: 1000000,
  targetPlatform: '起点',
  perspective: 'third' as 'first' | 'third',
  audience: 'male' as 'male' | 'female',
  pacing: '快节奏',
  description: ''
})

interface AIResult {
  worldview: string
  outline: string
  subplots: string
  characters: Array<{
    name: string
    gender: string
    age: number
    personality: string
    background: string
    role: string
    goal: string
    secret: string
  }>
}

const aiResult = ref<AIResult | null>(null)

const rules: FormRules = {
  name: { required: true, message: '请输入小说名称', trigger: 'blur' },
  type: { required: true, message: '请选择类型', trigger: 'change' },
  style: { required: true, message: '请选择风格', trigger: 'change' },
  targetWordCount: { required: true, type: 'number', message: '请输入目标字数', trigger: 'blur' }
}

const typeOptions = NOVEL_TYPES.map(t => ({ label: t, value: t }))
const styleOptions = NOVEL_STYLES.map(s => ({ label: s, value: s }))
const platformOptions = TARGET_PLATFORMS.map(p => ({ label: p, value: p }))
const pacingOptions = PACING_OPTIONS.map(p => ({ label: p, value: p }))

async function handleAIGenerate() {
  if (!aiStore.activeProvider) {
    message.warning('请先在设置中配置 AI Provider')
    return
  }
  aiLoading.value = true
  try {
    const prompt = renderPrompt(BUILTIN_TEMPLATES.AI_PROJECT_GEN, {
      type: form.type,
      style: form.style,
      description: form.description
    })
    const result = await callAI(aiStore.activeProvider, [
      { role: 'system', content: '你是一名专业的小说策划编辑。请以纯JSON格式输出。' },
      { role: 'user', content: prompt }
    ])

    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('AI 返回格式不正确')
    const data = JSON.parse(jsonMatch[0])
    aiResult.value = {
      worldview: data.worldview || '',
      outline: data.outline || '',
      subplots: data.subplots || '',
      characters: Array.isArray(data.characters) ? data.characters : []
    }
    message.success('AI 设定已生成，可编辑后创建')
  } catch (e: any) {
    message.error('AI 生成失败: ' + (e.message || '未知错误'))
  } finally {
    aiLoading.value = false
  }
}

async function handleSubmit() {
  try {
    await formRef.value?.validate()
  } catch { return }

  loading.value = true
  try {
    await projectStore.createProject({ ...form })

    // Write AI-generated content to project files
    if (aiResult.value) {
      const dir = await projectStore.getProjectDir(form.name)

      // Write worldview
      if (aiResult.value.worldview) {
        await fileAPI.writeFile(
          await fileAPI.pathJoin(dir, 'outline', '世界观.md'),
          `# 世界观\n\n${aiResult.value.worldview}`
        )
      }

      // Write outline
      if (aiResult.value.outline) {
        await fileAPI.writeFile(
          await fileAPI.pathJoin(dir, 'outline', '总纲.md'),
          `# 总纲\n\n${aiResult.value.outline}`
        )
      }

      // Write subplots
      if (aiResult.value.subplots) {
        await fileAPI.writeFile(
          await fileAPI.pathJoin(dir, 'outline', '支线.md'),
          `# 支线\n\n${aiResult.value.subplots}`
        )
      }

      // Write characters
      const charDir = await fileAPI.pathJoin(dir, 'characters')
      await fileAPI.ensureDirectory(charDir)
      for (const c of aiResult.value.characters) {
        if (!c.name) continue
        const char = {
          id: nanoid(),
          name: c.name,
          gender: c.gender || '',
          age: c.age || 0,
          personality: c.personality || '',
          background: c.background || '',
          skills: [] as string[],
          items: [] as string[],
          speechStyle: '',
          goal: c.goal || '',
          secret: c.secret || '',
          role: c.role || 'supporting',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        await fileAPI.writeFile(
          await fileAPI.pathJoin(charDir, `${c.name}.json`),
          JSON.stringify(char, null, 2)
        )
      }
    }

    emit('created', form.name)
    form.name = ''
    form.description = ''
    aiResult.value = null
  } catch (e: any) {
    message.error('创建失败: ' + (e.message || '未知错误'))
  } finally {
    loading.value = false
  }
}
</script>
