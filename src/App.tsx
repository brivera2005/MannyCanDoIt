import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MediaItem, Settings } from './types'
import './App.css'

const CROSSFADE_SEC = 1

const DEFAULT_SETTINGS: Settings = {
  photoDurationSec: 4,
  videoMaxLengthSec: 0,
}

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
  crossfadeLoss: number,
): string | null {
  if (photoCount === 0) return null

  const photoMin = Math.round((photoCount * photoDurationSec) / 60)
  const targetMin = 10
  const targetSec = targetMin * 60
  const availableForPhotos = targetSec - videoSeconds + crossfadeLoss
  const suggestedSec = Math.max(1, Math.round((availableForPhotos / photoCount) * 2) / 2)
  const suggestedTotal = photoCount * suggestedSec + videoSeconds - crossfadeLoss
  const suggestedMin = Math.max(1, Math.round(suggestedTotal / 60))

  if (Math.abs(suggestedSec - photoDurationSec) < 0.5) return null

  return `With ${photoCount} photos at ${photoDurationSec}s each ≈ ${photoMin} min. Try ${suggestedSec}s for ~${suggestedMin} min.`
}

export default function App() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [musicPath, setMusicPath] = useState<string | null>(null)
  const [musicName, setMusicName] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [dragOver, setDragOver] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState({ stage: '', percent: 0 })
  const [exportError, setExportError] = useState<string | null>(null)
  const [arranging, setArranging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const unsub = window.electronAPI.onExportProgress((p) => setExportProgress(p))
    return unsub
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const addItems = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return
    const imported = await window.electronAPI.importPaths(paths)
    setItems((prev) => [...prev, ...imported])
  }, [])

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

  const handleMakeVideo = async () => {
    if (items.length === 0) return
    const outputPath = await window.electronAPI.pickSaveLocation()
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

  const { estimatedDuration, photoCount, videoSeconds, crossfadeLoss } = useMemo(() => {
    const crossfade = CROSSFADE_SEC * Math.max(0, items.length - 1)
    let videoSec = 0
    let photos = 0
    const clipSum = items.reduce((sum, item) => {
      if (item.type === 'photo') photos++
      else videoSec += clipDuration(item, settings)
      return sum + clipDuration(item, settings)
    }, 0)
    return {
      estimatedDuration: Math.max(0, clipSum - crossfade),
      photoCount: photos,
      videoSeconds: videoSec,
      crossfadeLoss: crossfade,
    }
  }, [items, settings])

  const photoHint = useMemo(
    () => buildPhotoHint(photoCount, settings.photoDurationSec, videoSeconds, crossfadeLoss),
    [photoCount, settings.photoDurationSec, videoSeconds, crossfadeLoss],
  )

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      <header className="header">
        <h1>MannyCanDoIt</h1>
        <p className="tagline">Turn your photos &amp; videos into a slideshow with music</p>
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
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleAutoArrange}
            disabled={items.length < 2 || arranging}
          >
            {arranging ? 'Arranging…' : 'Auto-arrange'}
          </button>
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
                {items.length > 1 && ` (−${crossfadeLoss}s crossfades)`}
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
              onChange={(e) =>
                setSettings((s) => ({ ...s, photoDurationSec: Number(e.target.value) }))
              }
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
              onChange={(e) =>
                setSettings((s) => ({ ...s, videoMaxLengthSec: Number(e.target.value) }))
              }
            />
          </label>
          <p className="hint subtle">Slide video max to 0 for full-length clips. Music follows the video.</p>
        </div>
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
