import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/ProjectListView.vue')
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue')
    },
    {
      path: '/deepseek',
      name: 'deepseek',
      component: () => import('@/views/DeepSeekView.vue')
    },
    {
      path: '/project/:id',
      component: () => import('@/views/ProjectDetailView.vue'),
      children: [
        {
          path: '',
          redirect: (to) => `/project/${to.params.id}/outline`
        },
        {
          path: 'outline',
          name: 'outline',
          component: () => import('@/views/OutlineView.vue')
        },
        {
          path: 'volumes',
          name: 'volumes',
          component: () => import('@/views/VolumesView.vue')
        },
        {
          path: 'chapters/:volumeId',
          name: 'chapters',
          component: () => import('@/views/ChaptersView.vue')
        },
        {
          path: 'chapters/:volumeId/:chapterId',
          name: 'chapter-editor',
          component: () => import('@/views/ChapterEditorView.vue')
        },
        {
          path: 'characters',
          name: 'characters',
          component: () => import('@/views/CharactersView.vue')
        },
        {
          path: 'characters/:charId',
          name: 'character-detail',
          component: () => import('@/views/CharacterDetailView.vue')
        },
        {
          path: 'graph',
          name: 'graph',
          component: () => import('@/views/CharacterGraphView.vue')
        }
      ]
    }
  ]
})

export default router
