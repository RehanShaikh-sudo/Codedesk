import * as monaco from 'monaco-editor'
import {
  initialize,
  getService,
  IWorkbenchLayoutService,
  IEditorService,
} from '@codingame/monaco-vscode-api'

import getViewsServiceOverride, {
  Parts,
  attachPart,
  isPartVisibile,
  onPartVisibilityChange,
  getSideBarPosition,
  onDidChangeSideBarPosition,
  Position,
} from '@codingame/monaco-vscode-views-service-override'

import getTitleBarServiceOverride from '@codingame/monaco-vscode-view-title-bar-service-override'
import getStatusBarServiceOverride from '@codingame/monaco-vscode-view-status-bar-service-override'
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override'
import getConfigurationServiceOverride, {
  initUserConfiguration,
} from '@codingame/monaco-vscode-configuration-service-override'
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override'
import getNotificationServiceOverride from '@codingame/monaco-vscode-notifications-service-override'
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override'
import getEnvironmentServiceOverride from '@codingame/monaco-vscode-environment-service-override'
import getWorkspaceTrustOverride from '@codingame/monaco-vscode-workspace-trust-service-override'
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override'
import getFilesServiceOverride, {
  InMemoryFileSystemProvider,
  registerFileSystemOverlay,
} from '@codingame/monaco-vscode-files-service-override'
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override'
import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override'
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override'
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override'
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override'
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override'
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override'
import getSearchServiceOverride from '@codingame/monaco-vscode-search-service-override'
// Needs: npm i @codingame/monaco-vscode-dialogs-service-override
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override'

import '@codingame/monaco-vscode-theme-defaults-default-extension'
import '@codingame/monaco-vscode-python-default-extension'
import '@codingame/monaco-vscode-javascript-default-extension'
import '@codingame/monaco-vscode-cpp-default-extension'
import '@codingame/monaco-vscode-java-default-extension'

const WORKSPACE_PATH = '/workspace'
const DIRECTORY = 2 // vscode FileType.Directory

const STARTER_FILES = {
  'hello.py': 'print("Hello, World!")\n',
  'main.cpp':
    '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n',
  'Main.java':
    'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n',
  'script.js': 'console.log("Hello, World!");\n',
}

// ---- Temporary persistence: each student's files live in localStorage ----
// Later, replace loadFiles/saveFiles with Supabase calls.
const storageKeyFor = (userKey) => `codedesk:files:${userKey}`

function loadFiles(userKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKeyFor(userKey)))
    if (saved && Object.keys(saved).length > 0) return saved
  } catch {
    /* ignore corrupted data */
  }
  return STARTER_FILES
}

function saveFiles(userKey, files) {
  try {
    localStorage.setItem(storageKeyFor(userKey), JSON.stringify(files))
  } catch (err) {
    console.warn('Could not save files to browser storage', err)
  }
}

async function collectFiles(provider, dirPath, out) {
  const entries = await provider.readdir(monaco.Uri.file(dirPath))
  for (const [name, type] of entries) {
    const path = `${dirPath}/${name}`
    if (type === DIRECTORY) {
      await collectFiles(provider, path, out)
    } else {
      const bytes = await provider.readFile(monaco.Uri.file(path))
      out[path.slice(WORKSPACE_PATH.length + 1)] = new TextDecoder().decode(bytes)
    }
  }
}

// Saves a snapshot after any create / edit / rename / delete (debounced)
function persistOnChange(provider, userKey) {
  let timer
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      try {
        const files = {}
        await collectFiles(provider, WORKSPACE_PATH, files)
        saveFiles(userKey, files)
      } catch (err) {
        console.warn('Snapshot failed', err)
      }
    }, 400)
  }
  for (const method of ['writeFile', 'delete', 'rename', 'mkdir']) {
    const original = provider[method]?.bind(provider)
    if (!original) continue
    provider[method] = (...args) => {
      const result = original(...args)
      schedule()
      return result
    }
  }
}

// ---- Active file lookup (used by the Run button) ----
let lastFocusedEditor = null

function trackEditors() {
  const watch = (editor) => {
    editor.onDidFocusEditorText(() => {
      lastFocusedEditor = editor
    })
    if (!lastFocusedEditor) lastFocusedEditor = editor
  }
  monaco.editor.getEditors().forEach(watch)
  monaco.editor.onDidCreateEditor(watch)
}

/** Returns { name, path, content } of the file shown in the editor, or null. */
export function getActiveFile() {
  const editors = monaco.editor.getEditors()
  const editor =
    lastFocusedEditor && editors.includes(lastFocusedEditor)
      ? lastFocusedEditor
      : editors.find((e) => e.getModel())
  const model = editor?.getModel()
  if (!model || model.uri.scheme !== 'file') return null
  return {
    name: model.uri.path.split('/').pop(),
    path: model.uri.path,
    content: model.getValue(),
  }
}

// ---- File system helpers ----
// NOTE: we use InMemoryFileSystemProvider (not RegisteredFileSystemProvider) because only the
// in-memory one lets the Explorer create, rename and delete files and folders.
let fileProvider = null

const encode = (text) => new TextEncoder().encode(text)
const WRITE_NEW = { create: true, overwrite: true, unlock: false, atomic: false }

async function seedFiles(provider, files) {
  await provider.mkdir(monaco.Uri.file(WORKSPACE_PATH))
  for (const [name, content] of Object.entries(files)) {
    // create sub-folders for nested files such as "utils/helpers.py"
    let dir = WORKSPACE_PATH
    for (const part of name.split('/').slice(0, -1)) {
      dir += `/${part}`
      try {
        await provider.mkdir(monaco.Uri.file(dir))
      } catch {
        /* folder already exists */
      }
    }
    await provider.writeFile(monaco.Uri.file(`${WORKSPACE_PATH}/${name}`), encode(content), WRITE_NEW)
  }
}

/**
 * Creates a new file in the workspace (hello.py, hello1.py, ...) and opens it in the editor.
 * makeContent(baseName) returns the boilerplate text. Returns the new file name.
 */
export async function createFile(baseName, ext, makeContent) {
  if (!fileProvider) return null

  let n = 0
  let name
  let uri
  for (;;) {
    name = `${baseName}${n || ''}.${ext}`
    uri = monaco.Uri.file(`${WORKSPACE_PATH}/${name}`)
    try {
      await fileProvider.stat(uri) // exists -> try the next number
      n++
    } catch {
      break // does not exist -> use this name
    }
  }

  const text = makeContent(name.slice(0, -(ext.length + 1)))
  await fileProvider.writeFile(uri, encode(text), { ...WRITE_NEW, overwrite: false })

  const editorService = await getService(IEditorService)
  await editorService.openEditor({ resource: uri })
  return name
}

let initialized = false

export async function startWorkbench(userKey) {
  if (initialized) return
  initialized = true

  window.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === 'TextMateWorker') {
        return new Worker(
          new URL('@codingame/monaco-vscode-textmate-service-override/worker', import.meta.url),
          { type: 'module' }
        )
      }
      return new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
        { type: 'module' }
      )
    },
  }

  // Writable in-memory file system, filled from the student's saved files
  fileProvider = new InMemoryFileSystemProvider()
  await seedFiles(fileProvider, loadFiles(userKey))
  registerFileSystemOverlay(1, fileProvider)
  persistOnChange(fileProvider, userKey)

  await initUserConfiguration(
    JSON.stringify({
      'files.autoSave': 'afterDelay',
      'files.autoSaveDelay': 1000,
      'editor.fontSize': 15,
      'editor.minimap.enabled': false,
      'workbench.startupEditor': 'none',
      'workbench.layoutControl.enabled': false,
      'workbench.colorTheme': 'Dark Modern',
    })
  )

  const workspaceUri = monaco.Uri.file(WORKSPACE_PATH)

  const services = {
    ...getConfigurationServiceOverride(workspaceUri),
    ...getKeybindingsServiceOverride(),
    ...getNotificationServiceOverride(),
    ...getLifecycleServiceOverride(),
    ...getEnvironmentServiceOverride(),
    ...getWorkspaceTrustOverride(),
    ...getWorkingCopyServiceOverride(),
    ...getFilesServiceOverride(),
    ...getStorageServiceOverride(),
    ...getExtensionServiceOverride(),
    ...getModelServiceOverride(),
    ...getTextmateServiceOverride(),
    ...getThemeServiceOverride(),
    ...getLanguagesServiceOverride(),
    ...getExplorerServiceOverride(),
    ...getSearchServiceOverride(),
    ...getQuickAccessServiceOverride(),
    ...getDialogsServiceOverride(),
    ...getViewsServiceOverride(),
    ...getTitleBarServiceOverride(),
    ...getStatusBarServiceOverride(),
  }

  await initialize(services, document.body, {
    workspaceProvider: {
      trusted: true,
      workspace: { folderUri: workspaceUri },
      async open() {
        return false
      },
    },
  })

  trackEditors()

  const parts = [
    { part: Parts.TITLEBAR_PART, element: '#vscode-titlebar' },
    {
      part: Parts.ACTIVITYBAR_PART,
      get element() {
        return getSideBarPosition() === Position.LEFT ? '#vscode-activitybar' : '#vscode-right'
      },
      onDidElementChange: onDidChangeSideBarPosition,
    },
    {
      part: Parts.SIDEBAR_PART,
      get element() {
        return getSideBarPosition() === Position.LEFT ? '#vscode-sidebar' : '#vscode-right'
      },
      onDidElementChange: onDidChangeSideBarPosition,
    },
    { part: Parts.EDITOR_PART, element: '#vscode-editors' },
    { part: Parts.STATUSBAR_PART, element: '#vscode-statusbar' },
  ]

  for (const config of parts) {
    const element = document.querySelector(config.element)
    if (!element) continue

    attachPart(config.part, element)

    config.onDidElementChange?.(() => {
      const next = document.querySelector(config.element)
      if (next) attachPart(config.part, next)
    })

    if (!isPartVisibile(config.part)) element.style.display = 'none'

    onPartVisibilityChange(config.part, (visible) => {
      const current = document.querySelector(config.element)
      if (current) current.style.display = visible ? 'block' : 'none'
    })
  }

  return getService(IWorkbenchLayoutService)
}
