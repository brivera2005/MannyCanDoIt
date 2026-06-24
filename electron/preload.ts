import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AutoArrangeResult,
  DedupOptions,
  ExportOptions,
  ExportProgress,
  MediaItem,
  UpdateInfo,
} from '../src/types'

const electronAPI = {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('pick-files'),
  pickMusic: (): Promise<string | null> => ipcRenderer.invoke('pick-music'),
  pickSaveLocation: (useDateTemplate: boolean): Promise<string | null> =>
    ipcRenderer.invoke('pick-save-location', useDateTemplate),
  importPaths: (paths: string[], skipScreenshots: boolean): Promise<MediaItem[]> =>
    ipcRenderer.invoke('import-paths', paths, skipScreenshots),
  generateThumbnail: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('generate-thumbnail', filePath),
  autoArrange: (items: MediaItem[], dedupOptions: DedupOptions): Promise<AutoArrangeResult> =>
    ipcRenderer.invoke('auto-arrange', items, dedupOptions),
  exportVideo: (options: ExportOptions) => ipcRenderer.invoke('export-video', options),
  checkForUpdates: (): Promise<UpdateInfo> => ipcRenderer.invoke('check-for-updates'),
  onExportProgress: (callback: (progress: ExportProgress) => void) => {
    const handler = (_: Electron.IpcRendererEvent, progress: ExportProgress) => callback(progress)
    ipcRenderer.on('export-progress', handler)
    return () => ipcRenderer.removeListener('export-progress', handler)
  },
  onUpdateStatus: (callback: (info: UpdateInfo) => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: UpdateInfo) => callback(info)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.removeListener('update-status', handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
