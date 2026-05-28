# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI小说助手 — a desktop application for AI-assisted Chinese web novel writing. Supports outline creation, volume/chapter generation, character management, AI polishing, and a multi-pass chapter generation pipeline.

## Tech Stack

- **Desktop**: Electron
- **Frontend**: Vue 3 + TypeScript + Vite
- **UI**: Naive UI
- **State**: Pinia
- **Storage**: Local JSON/Markdown files + IndexedDB (localforage)
- **AI**: OpenAI-compatible API with SSE streaming (`src/api/ai.ts`)
- **Graph**: @antv/g6 for character relationship visualization

## Commands

```bash
npm run dev          # Start Electron + Vite dev server
npm run build        # Build for production (vue-tsc + vite build + electron-builder)
```

## Architecture

### Directory Structure

```
electron/
  main.ts            # Electron main process, IPC file I/O handlers
  preload.ts         # contextBridge exposing window.electronAPI
src/
  api/ai.ts          # callAI() — core streaming AI function
  types/             # TypeScript interfaces (ai, project, character, chapter)
  stores/            # Pinia stores (app, ai, project, outline, character, volume, chapter)
  utils/             # promptTemplates.ts (renderPrompt + built-in templates), wordCount.ts
  views/             # Page components
  components/        # Reusable UI components
```

### Key Patterns

- **All file I/O via IPC**: Renderer calls `window.electronAPI.*` (readFile, writeFile, ensureDirectory, listFiles, etc.) — main process uses Node.js `fs.promises`
- **AI streaming**: `callAI(config, messages, { signal }, { onToken, onComplete, onError })` — fetch + ReadableStream SSE parsing
- **Prompt templates**: Stored per-project in `settings/prompt.json`, loaded with defaults from `src/utils/promptTemplates.ts`. Use `renderPrompt(template, {{variables}})` for placeholder substitution.
- **Chapter generation pipeline**: 4-step flow: generate outline → generate content (streaming) → polish → de-AI. Implemented in `ChapterGenerationPanel.vue` + `chapter.ts` store.
- **Chinese word count**: CJK characters count as 1 word each, ASCII words split by whitespace (`src/utils/wordCount.ts`)

### Data Storage

All novel data stored locally under `app.getPath('userData')/novels/`:
```
novels/小说名/
  project.json              # Novel metadata
  outline/总纲.md, 世界观.md, 支线.md
  volumes/卷名/volume.json + chapter_001.md
  characters/角色名.json
  graph/relations.json
  memory/timeline.json, summaries.json
  settings/prompt.json
```

Chapter metadata is stored as a `<!--meta:JSON-->` comment at the top of each `.md` file.

### IPC API (window.electronAPI)

| Method | Description |
|--------|-------------|
| `getNovelsDir()` | Returns novels directory path |
| `readFile(path)` | Read file as UTF-8 string |
| `writeFile(path, content)` | Write file (auto-creates directories) |
| `ensureDirectory(path)` | Create directory recursively |
| `listFiles(dirPath)` | Returns `{name, isDirectory}[]` |
| `deleteFile(path)` | Delete a file |
| `deleteDirectory(path)` | Recursive delete |
| `pathExists(path)` | Check existence |
| `pathJoin(...segments)` | Join path segments |
| `selectDirectory()` | Open native directory picker |

## Development Notes

- 需求说明.txt is the source of truth for the full feature specification
- TypeScript strict mode is enabled
- Vue files use `<script setup lang="ts">` with Naive UI components
- Route params use `:id` (project name), `:volumeId`, `:chapterId`, `:charId` pattern
