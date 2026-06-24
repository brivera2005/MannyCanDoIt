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

export type TransitionStyle = 'crossfade' | 'fade-black' | 'hard-cut'
export type PhotoFit = 'fit' | 'fill'
export type OutputResolution = '1080p' | '720p'
export type DedupMode = 'burst' | 'visual' | 'both'

export interface Settings {
  photoDurationSec: number
  /** 0 = use full video length */
  videoMaxLengthSec: number
  kenBurns: boolean
  transitionStyle: TransitionStyle
  photoFit: PhotoFit
  outputResolution: OutputResolution
  muteVideoAudio: boolean
  musicVolume: number
  fadeMusic: boolean
  skipScreenshots: boolean
  rememberLastSettings: boolean
  openFolderWhenDone: boolean
  outputFilenameTemplate: boolean
  smartVisualDedup: boolean
  dedupMode: DedupMode
}

export interface DedupOptions {
  smartVisualDedup: boolean
  dedupMode: DedupMode
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

export interface UpdateInfo {
  version: string
  status: 'checking' | 'available' | 'not-available' | 'downloaded' | 'error'
  message?: string
}

export interface ElectronAPI {
  getPathForFile: (file: File) => string
  pickFolder: () => Promise<string | null>
  pickFiles: () => Promise<string[]>
  pickMusic: () => Promise<string | null>
  pickSaveLocation: (useDateTemplate: boolean) => Promise<string | null>
  importPaths: (paths: string[], skipScreenshots: boolean) => Promise<MediaItem[]>
  generateThumbnail: (filePath: string) => Promise<string>
  autoArrange: (items: MediaItem[], dedupOptions: DedupOptions) => Promise<AutoArrangeResult>
  exportVideo: (options: ExportOptions) => Promise<{ success: boolean; error?: string }>
  checkForUpdates: () => Promise<UpdateInfo>
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void
  onUpdateStatus: (callback: (info: UpdateInfo) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
