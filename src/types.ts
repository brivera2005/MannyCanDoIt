export interface MediaItem {
  id: string
  path: string
  name: string
  type: 'photo' | 'video'
  thumbnail?: string
  dateTaken?: number
  /** Full video duration in seconds (videos only) */
  durationSec?: number
}

export interface Settings {
  photoDurationSec: number
  /** 0 = use full video length */
  videoMaxLengthSec: number
}

export interface AutoArrangeResult {
  items: MediaItem[]
  message: string
}

export interface ExportOptions {
  items: MediaItem[]
  musicPath: string | null
  settings: Settings
  outputPath: string
}

export interface ExportProgress {
  stage: string
  percent: number
}

export interface ElectronAPI {
  getPathForFile: (file: File) => string
  pickFolder: () => Promise<string | null>
  pickFiles: () => Promise<string[]>
  pickMusic: () => Promise<string | null>
  pickSaveLocation: () => Promise<string | null>
  importPaths: (paths: string[]) => Promise<MediaItem[]>
  generateThumbnail: (filePath: string) => Promise<string>
  autoArrange: (items: MediaItem[]) => Promise<AutoArrangeResult>
  exportVideo: (options: ExportOptions) => Promise<{ success: boolean; error?: string }>
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
