import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MediaItem, Settings } from './types'
import {
  DEFAULT_SETTINGS,
  getTransitionLossSec,
  loadPersistedState,
  persistState,
} from './settings'
import './App.css'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function clipDuration(item: MediaItem, settings: Settings): number {
  if (item.type === 'photo') return settings.photoDurationSec
  const dur = item.durationSec ?? 15
  if (settings.videoMaxLengthSec <= 0) return dur
  return Math.min(dur, settings.videoMaxLengthSec)
}

function buildPhotoHint(
  photoCount: number,
  photoDurationSec: number,
  videoSeconds: number,
  transitionLoss: number,
): string | null {
  if (photoCount === 0) return null

  const photoMin = Math.round((photoCount * photoDurationSec) / 60)
  const targetMin = 10
  const targetSec = targetMin * 60
  const availableForPhotos = targetSec - videoSeconds + transitionLoss
  const suggestedSec = Math.max(1, Math.round((availableForPhotos / photoCount) * 2) / 2)
  const suggestedTotal = photoCount * suggestedSec + videoSeconds - transitionLoss
  const suggestedMin = Math.max(1, Math.round(suggestedTotal / 60))

  if (Math.abs(suggestedSec - photoDurationSec) < 0.5) return null

  return `With ${photoCount} photos at ${photoDurationSec}s each ≈ ${photoMin} min. Try ${suggestedSec}s for ~${suggestedMin} min.`
}

function shuffleArray<T>(arr: T[]): T[] {
  const next = [...arr]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function OptionRow({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="option-row">
      <div className="option-label">
        <span>{label}</span>
        <span className="option-hint">{hint}</span>
      </div>
      <div className="option-control">{children}</div>
    </div>
  )
}

export default function App() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [musicPath, setMusicPath] = useState<string | null>(null)
  const [musicName, setMusicName] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState({ stage: '', percent: 0 })
  const [exportError, setExportError] = useState<string | null>(null)
  const [arranging, setArranging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)

  useEffect(() => {
    const { settings: saved, musicPath: savedMusic } = loadPersistedState()
    setSettings(saved)
    if (savedMusic) {
      setMusicPath(savedMusic)
      setMusicName(savedMusic.split(/[/\\]/).pop() ?? savedMusic)
    }
  }, [])

  useEffect(() => {
    persistState(settings, musicPath)
  }, [settings, musicPath])

  useEffect(() => {
    const unsub = window.electronAPI.onExportProgress((p) => setExportProgress(p))
    return unsub
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.onUpdateStatus((info) => {
      if (info.status === 'checking') setUpdateMessage('Checking for updates…')
      else if (info.status === 'available') setUpdateMessage(`Update ${info.version} available`)
      else if (info.status === 'downloaded') setUpdateMessage(`Update ${info.version} ready — restart to install`)
      else setUpdateMessage(null)
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }))
  }, [])

  const addItems = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return
      const imported = await window.electronAPI.importPaths(paths, settings.skipScreenshots)
      setItems((prev) => [...prev, ...imported])
    },
    [settings.skipScreenshots],
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const paths = [...e.dataTransfer.files].map((f) => window.electronAPI.getPathForFile(f))
      await addItems(paths)
    },
    [addItems],
  )

  const handlePickFolder = async () => {
    const folder = await window.electronAPI.pickFolder()
    if (folder) await addItems([folder])
  }

  const handlePickFiles = async () => {
    const files = await window.electronAPI.pickFiles()
    if (files.length) await addItems(files)
  }

  const handlePickMusic = async () => {
    const path = await window.electronAPI.pickMusic()
    if (path) {
      setMusicPath(path)
      setMusicName(path.split(/[/\\]/).pop() ?? path)
    }
  }

  const handleRemove = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const handleReorder = (from: number, to: number) => {
    if (from === to) return
    setItems((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const handleShuffle = () => {
    setItems((prev) => shuffleArray(prev))
    setToast('Timeline shuffled')
  }

  const handleAutoArrange = async () => {
    if (items.length === 0) return
    setArranging(true)
    try {
      const result = await window.electronAPI.autoArrange(items)
      setItems(result.items)
      setToast(result.message)
    } finally {
      setArranging(false)
    }
  }

  const handleCheckUpdates = async () => {
    const result = await window.electronAPI.checkForUpdates()
    if (result.status === 'not-available' && result.message) {
      setToast(result.message)
    } else if (result.status === 'error' && result.message) {
      setToast(result.message)
    }
  }

  const handleMakeVideo = async () => {
    if (items.length === 0) return
    const outputPath = await window.electronAPI.pickSaveLocation(settings.outputFilenameTemplate)
    if (!outputPath) return

    setExporting(true)
    setExportError(null)
    setExportProgress({ stage: 'Starting…', percent: 0 })

    const result = await window.electronAPI.exportVideo({
      items,
      musicPath,
      settings,
      outputPath,
    })

    setExporting(false)
    if (!result.success) {
      setExportError(result.error ?? 'Export failed')
    }
  }

  const transitionLoss = useMemo(
    () => getTransitionLossSec(settings.transitionStyle, items.length),
    [settings.transitionStyle, items.length],
  )

  const { estimatedDuration, photoCount, videoSeconds } = useMemo(() => {
    let videoSec = 0
    let photos = 0
    const clipSum = items.reduce((sum, item) => {
      if (item.type === 'photo') photos++
      else videoSec += clipDuration(item, settings)
      return sum + clipDuration(item, settings)
    }, 0)
    return {
      estimatedDuration: Math.max(0, clipSum - transitionLoss),
      photoCount: photos,
      videoSeconds: videoSec,
    }
  }, [items, settings, transitionLoss])

  const photoHint = useMemo(
    () => buildPhotoHint(photoCount, settings.photoDurationSec, videoSeconds, transitionLoss),
    [photoCount, settings.photoDurationSec, videoSeconds, transitionLoss],
  )

  const transitionLabel =
    settings.transitionStyle === 'hard-cut'
      ? 'hard cuts'
      : settings.transitionStyle === 'fade-black'
        ? 'fade-to-black'
        : 'crossfades'

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      <header className="header">
        <h1>MannyCanDoIt</h1>
        <p className="tagline">Turn your photos &amp; videos into a slideshow with music</p>
        {updateMessage && <p className="update-banner">{updateMessage}</p>}
      </header>

      <section
        className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <p className="drop-text">Drag &amp; drop photos and videos here</p>
        <div className="import-buttons">
          <button type="button" className="btn btn-primary" onClick={handlePickFolder}>
            Choose Folder
          </button>
          <button type="button" className="btn btn-secondary" onClick={handlePickFiles}>
            Choose Files
          </button>
        </div>
      </section>

      <section className="timeline-section">
        <div className="section-header">
          <h2>Timeline ({items.length} items)</h2>
          <div className="section-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleShuffle}
              disabled={items.length < 2}
              title="Randomly reorder the timeline"
            >
              Shuffle
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleAutoArrange}
              disabled={items.length < 2 || arranging}
            >
              {arranging ? 'Arranging…' : 'Auto-arrange'}
            </button>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="empty-hint">Imported media will appear here. Drag to reorder, click ✕ to remove.</p>
        ) : (
          <div className="timeline">
            {items.map((item, index) => (
              <div
                key={item.id}
                className={`timeline-item ${dragIndex === index ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragIndex !== null) handleReorder(dragIndex, index)
                  setDragIndex(null)
                }}
              >
                <div className="thumb-wrap">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.name} className="thumb" />
                  ) : (
                    <div className="thumb placeholder" />
                  )}
                  <span className={`badge ${item.type}`}>{item.type}</span>
                </div>
                <p className="item-name" title={item.name}>
                  {item.name}
                </p>
                <button
                  type="button"
                  className="remove-btn"
                  onClick={() => handleRemove(item.id)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="controls-grid">
        <div className="panel">
          <h2>Background Music</h2>
          <button type="button" className="btn btn-primary btn-block" onClick={handlePickMusic}>
            Choose Music File
          </button>
          {musicName && <p className="music-name">🎵 {musicName}</p>}
          {!musicName && <p className="hint">MP3 or WAV — trimmed or looped to match video length</p>}
        </div>

        <div className="panel settings-panel">
          <h2>Timing</h2>
          <div className="duration-highlight">
            <span className="duration-label">Estimated total</span>
            <span className="duration-value">~{formatDuration(estimatedDuration)}</span>
            {items.length > 0 && (
              <span className="duration-detail">
                {photoCount > 0 && `${photoCount} photos × ${settings.photoDurationSec}s`}
                {photoCount > 0 && items.some((i) => i.type === 'video') && ' + '}
                {items.some((i) => i.type === 'video') && 'videos'}
                {items.length > 1 && transitionLoss > 0 && ` (−${transitionLoss}s ${transitionLabel})`}
              </span>
            )}
          </div>
          <label className="slider-label">
            <span>Seconds per photo: {settings.photoDurationSec}s</span>
            <input
              type="range"
              min={1}
              max={15}
              step={0.5}
              value={settings.photoDurationSec}
              onChange={(e) => updateSettings({ photoDurationSec: Number(e.target.value) })}
            />
          </label>
          {photoHint && <p className="hint photo-hint">{photoHint}</p>}
          <label className="slider-label">
            <span>
              Video max length:{' '}
              {settings.videoMaxLengthSec <= 0
                ? 'Full length'
                : `${settings.videoMaxLengthSec}s`}
            </span>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              value={settings.videoMaxLengthSec}
              onChange={(e) => updateSettings({ videoMaxLengthSec: Number(e.target.value) })}
            />
          </label>
          <p className="hint subtle">Slide video max to 0 for full-length clips. Music follows the video.</p>
        </div>
      </section>

      <section className="options-section">
        <button
          type="button"
          className="options-toggle"
          onClick={() => setOptionsOpen((o) => !o)}
          aria-expanded={optionsOpen}
        >
          <span>{optionsOpen ? '▾' : '▸'} More options</span>
          <span className="options-toggle-hint">Optional — defaults work great</span>
        </button>

        {optionsOpen && (
          <div className="options-panel">
            <div className="options-group">
              <h3>Playback &amp; visuals</h3>
              <OptionRow label="Ken Burns effect" hint="Subtle slow zoom on photos">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.kenBurns}
                    onChange={(e) => updateSettings({ kenBurns: e.target.checked })}
                  />
                  <span>{settings.kenBurns ? 'On' : 'Off'}</span>
                </label>
              </OptionRow>
              <OptionRow label="Transition style" hint="How clips blend together">
                <select
                  value={settings.transitionStyle}
                  onChange={(e) =>
                    updateSettings({
                      transitionStyle: e.target.value as Settings['transitionStyle'],
                    })
                  }
                >
                  <option value="crossfade">Crossfade</option>
                  <option value="fade-black">Fade to black</option>
                  <option value="hard-cut">Hard cut</option>
                </select>
              </OptionRow>
              <OptionRow label="Photo fit" hint="Letterbox or crop to fill the frame">
                <select
                  value={settings.photoFit}
                  onChange={(e) =>
                    updateSettings({ photoFit: e.target.value as Settings['photoFit'] })
                  }
                >
                  <option value="fit">Fit (letterbox)</option>
                  <option value="fill">Fill (crop)</option>
                </select>
              </OptionRow>
              <OptionRow label="Output resolution" hint="720p exports faster">
                <select
                  value={settings.outputResolution}
                  onChange={(e) =>
                    updateSettings({
                      outputResolution: e.target.value as Settings['outputResolution'],
                    })
                  }
                >
                  <option value="1080p">1080p</option>
                  <option value="720p">720p (faster)</option>
                </select>
              </OptionRow>
            </div>

            <div className="options-group">
              <h3>Audio</h3>
              <OptionRow label="Mute original video audio" hint="Music-only slideshow (recommended)">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.muteVideoAudio}
                    onChange={(e) => updateSettings({ muteVideoAudio: e.target.checked })}
                  />
                  <span>{settings.muteVideoAudio ? 'Muted' : 'Keep audio'}</span>
                </label>
              </OptionRow>
              <OptionRow label="Music volume" hint="Background music loudness">
                <div className="volume-control">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={settings.musicVolume}
                    onChange={(e) => updateSettings({ musicVolume: Number(e.target.value) })}
                  />
                  <span>{settings.musicVolume}%</span>
                </div>
              </OptionRow>
              <OptionRow label="Fade music in/out" hint="2-second fade at start and end">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.fadeMusic}
                    onChange={(e) => updateSettings({ fadeMusic: e.target.checked })}
                  />
                  <span>{settings.fadeMusic ? 'On' : 'Off'}</span>
                </label>
              </OptionRow>
            </div>

            <div className="options-group">
              <h3>Import &amp; curation</h3>
              <OptionRow
                label="Skip screenshots"
                hint='Skip files named "Screenshot" or very small images'
              >
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.skipScreenshots}
                    onChange={(e) => updateSettings({ skipScreenshots: e.target.checked })}
                  />
                  <span>{settings.skipScreenshots ? 'On' : 'Off'}</span>
                </label>
              </OptionRow>
              <OptionRow label="Remember last settings" hint="Restore options next time you open the app">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.rememberLastSettings}
                    onChange={(e) => updateSettings({ rememberLastSettings: e.target.checked })}
                  />
                  <span>{settings.rememberLastSettings ? 'On' : 'Off'}</span>
                </label>
              </OptionRow>
            </div>

            <div className="options-group">
              <h3>Export</h3>
              <OptionRow label="Open folder when done" hint="Show the finished video in File Explorer">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.openFolderWhenDone}
                    onChange={(e) => updateSettings({ openFolderWhenDone: e.target.checked })}
                  />
                  <span>{settings.openFolderWhenDone ? 'On' : 'Off'}</span>
                </label>
              </OptionRow>
              <OptionRow
                label="Date filename template"
                hint='Default save name like "slideshow-2026-06-23.mp4"'
              >
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={settings.outputFilenameTemplate}
                    onChange={(e) => updateSettings({ outputFilenameTemplate: e.target.checked })}
                  />
                  <span>{settings.outputFilenameTemplate ? 'On' : 'Off'}</span>
                </label>
              </OptionRow>
            </div>

            <div className="options-group">
              <h3>Updates</h3>
              <OptionRow label="Check for updates" hint="Download new versions from GitHub">
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleCheckUpdates}>
                  Check now
                </button>
              </OptionRow>
            </div>
          </div>
        )}
      </section>

      <section className="export-section">
        <button
          type="button"
          className="btn btn-make"
          onClick={handleMakeVideo}
          disabled={items.length === 0 || exporting}
        >
          {exporting ? 'Making Video…' : 'Make Video'}
        </button>

        {exporting && (
          <div className="progress-wrap">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${exportProgress.percent}%` }} />
            </div>
            <p className="progress-text">
              {exportProgress.stage} ({Math.round(exportProgress.percent)}%)
            </p>
          </div>
        )}

        {exportError && <p className="error-text">{exportError}</p>}
      </section>
    </div>
  )
}
