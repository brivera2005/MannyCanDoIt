import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AutoArrangeResult, ExportOptions, ExportProgress, MediaItem } from '../src/types'

const electronAPI = {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('pick-files'),
  pickMusic: (): Promise<string | null> => ipcRenderer.invoke('pick-music'),
  pickSaveLocation: (): Promise<string | null> => ipcRenderer.invoke('pick-save-location'),
  importPaths: (paths: string[]): Promise<MediaItem[]> => ipcRenderer.invoke('import-paths', paths),
  generateThumbnail: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('generate-thumbnail', filePath),
  autoArrange: (items: MediaItem[]): Promise<AutoArrangeResult> =>
    ipcRenderer.invoke('auto-arrange', items),
  exportVideo: (options: ExportOptions) => ipcRenderer.invoke('export-video', options),
  onExportProgress: (callback: (progress: ExportProgress) => void) => {
    const handler = (_: Electron.IpcRendererEvent, progress: ExportProgress) => callback(progress)
    ipcRenderer.on('export-progress', handler)
    return () => ipcRenderer.removeListener('export-progress', handler)
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
