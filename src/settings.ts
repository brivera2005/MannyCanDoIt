import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  photoDurationSec: 4,
  videoMaxLengthSec: 0,
  kenBurns: false,
  transitionStyle: 'crossfade',
  photoFit: 'fit',
  outputResolution: '1080p',
  muteVideoAudio: true,
  musicVolume: 80,
  fadeMusic: true,
  skipScreenshots: false,
  rememberLastSettings: true,
  openFolderWhenDone: true,
  outputFilenameTemplate: true,
  smartVisualDedup: false,
  dedupMode: 'burst',
}

const SETTINGS_KEY = 'mannycandoit-settings'
const MUSIC_KEY = 'mannycandoit-music'

export interface PersistedState {
  settings: Settings
  musicPath: string | null
}

export function loadPersistedState(): PersistedState {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { settings: { ...DEFAULT_SETTINGS }, musicPath: null }
    const parsed = JSON.parse(raw) as Partial<Settings>
    const settings = { ...DEFAULT_SETTINGS, ...parsed }
    if (!settings.rememberLastSettings) {
      return { settings: { ...DEFAULT_SETTINGS }, musicPath: null }
    }
    const musicPath = localStorage.getItem(MUSIC_KEY)
    return { settings, musicPath }
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, musicPath: null }
  }
}

export function persistState(settings: Settings, musicPath: string | null): void {
  if (!settings.rememberLastSettings) {
    localStorage.removeItem(SETTINGS_KEY)
    localStorage.removeItem(MUSIC_KEY)
    return
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  if (musicPath) localStorage.setItem(MUSIC_KEY, musicPath)
  else localStorage.removeItem(MUSIC_KEY)
}

export function getTransitionLossSec(style: Settings['transitionStyle'], itemCount: number): number {
  if (itemCount <= 1 || style === 'hard-cut') return 0
  return 1 * (itemCount - 1)
}
