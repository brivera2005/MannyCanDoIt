import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import sharp from 'sharp'
import exifr from 'exifr'
import ffmpegPath from 'ffmpeg-static'
import type { ExportOptions, ExportProgress, MediaItem } from '../src/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v'])
const CROSSFADE_SEC = 1
const OUTPUT_WIDTH = 1920
const OUTPUT_HEIGHT = 1080
const FPS = 30

let mainWindow: BrowserWindow | null = null

function getFfmpegPath(): string {
  if (app.isPackaged) {
    const unpacked = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'ffmpeg-static',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    )
    if (existsSync(unpacked)) return unpacked
  }
  if (ffmpegPath && existsSync(ffmpegPath)) return ffmpegPath
  throw new Error('ffmpeg binary not found. Reinstall dependencies.')
}

function sendProgress(progress: ExportProgress) {
  mainWindow?.webContents.send('export-progress', progress)
}

function isPhoto(filePath: string): boolean {
  return PHOTO_EXTS.has(path.extname(filePath).toLowerCase())
}

function isVideo(filePath: string): boolean {
  return VIDEO_EXTS.has(path.extname(filePath).toLowerCase())
}

function parseDateFromFilename(filePath: string): number | null {
  const base = path.basename(filePath, path.extname(filePath))

  const withTime = base.match(/(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/)
  if (withTime) {
    const d = new Date(
      parseInt(withTime[1], 10),
      parseInt(withTime[2], 10) - 1,
      parseInt(withTime[3], 10),
      parseInt(withTime[4], 10),
      parseInt(withTime[5], 10),
      parseInt(withTime[6], 10),
    )
    if (!isNaN(d.getTime())) return d.getTime()
  }

  const dateOnly = base.match(/(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?:[^\d]|$)/)
  if (dateOnly) {
    const d = new Date(
      parseInt(dateOnly[1], 10),
      parseInt(dateOnly[2], 10) - 1,
      parseInt(dateOnly[3], 10),
    )
    if (!isNaN(d.getTime())) return d.getTime()
  }

  return null
}

async function getDateTaken(filePath: string, type: 'photo' | 'video'): Promise<number> {
  try {
    if (type === 'photo') {
      const exif = await exifr.parse(filePath, ['DateTimeOriginal', 'CreateDate', 'ModifyDate'])
      const date = exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.ModifyDate
      if (date instanceof Date && !isNaN(date.getTime())) return date.getTime()
    }
  } catch {
    // fall through
  }

  const fromName = parseDateFromFilename(filePath)
  if (fromName !== null) return fromName

  const stat = await fs.stat(filePath)
  return stat.mtimeMs
}

async function computeSharpnessScore(filePath: string): Promise<number> {
  try {
    const { data } = await sharp(filePath)
      .rotate()
      .resize(300, 300, { fit: 'inside' })
      .greyscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
      })
      .raw()
      .toBuffer({ resolveWithObject: true })

    let sum = 0
    let sumSq = 0
    for (let i = 0; i < data.length; i++) {
      const v = data[i]
      sum += v
      sumSq += v * v
    }
    const mean = sum / data.length
    return sumSq / data.length - mean * mean
  } catch {
    return 0
  }
}

async function scanDirectory(dir: string): Promise<string[]> {
  const results: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await scanDirectory(full)))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (PHOTO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) results.push(full)
    }
  }
  return results
}

async function pathsFromInput(inputPaths: string[]): Promise<string[]> {
  const files: string[] = []
  for (const p of inputPaths) {
    try {
      const stat = await fs.stat(p)
      if (stat.isDirectory()) {
        files.push(...(await scanDirectory(p)))
      } else if (stat.isFile()) {
        files.push(p)
      }
    } catch {
      // skip invalid paths
    }
  }
  return [...new Set(files)].filter((f) => isPhoto(f) || isVideo(f))
}

async function createThumbnail(filePath: string, type: 'photo' | 'video'): Promise<string> {
  const thumbDir = path.join(app.getPath('userData'), 'thumbnails')
  await fs.mkdir(thumbDir, { recursive: true })
  const hash = Buffer.from(filePath).toString('base64url').slice(0, 32)
  const thumbPath = path.join(thumbDir, `${hash}.jpg`)

  if (existsSync(thumbPath)) {
    return `file://${thumbPath.replace(/\\/g, '/')}`
  }

  if (type === 'photo') {
    await sharp(filePath)
      .rotate()
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(thumbPath)
  } else {
    const ffmpeg = getFfmpegPath()
    await runFfmpeg(ffmpeg, [
      '-y',
      '-ss',
      '1',
      '-i',
      filePath,
      '-vframes',
      '1',
      '-vf',
      'scale=200:200:force_original_aspect_ratio=increase,crop=200:200',
      thumbPath,
    ])
  }

  return `file://${thumbPath.replace(/\\/g, '/')}`
}

function runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.slice(-500) || `ffmpeg exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

function runFfmpegWithProgress(
  ffmpeg: string,
  args: string[],
  onPercent: (pct: number) => void,
  totalDurationSec: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stderr += chunk
      const match = chunk.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/)
      if (match && totalDurationSec > 0) {
        const secs =
          parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3])
        onPercent(Math.min(99, (secs / totalDurationSec) * 100))
      }
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.slice(-500) || `ffmpeg exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

async function prepareImageForFfmpeg(filePath: string, workDir: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') return filePath

  const out = path.join(workDir, `${randomUUID()}.jpg`)
  await sharp(filePath).rotate().jpeg({ quality: 95 }).toFile(out)
  return out
}

function buildXfadeFilter(durations: number[], crossfade: number): { filter: string; outputLabel: string } {
  if (durations.length === 1) {
    return { filter: '[0:v]format=yuv420p[vout]', outputLabel: 'vout' }
  }

  const parts: string[] = []
  let cumulative = durations[0] - crossfade
  let prevLabel = '0:v'

  for (let i = 1; i < durations.length; i++) {
    const outLabel = i === durations.length - 1 ? 'vout' : `xf${i}`
    const nextInput = `${i}:v`
    parts.push(
      `[${prevLabel}][${nextInput}]xfade=transition=fade:duration=${crossfade}:offset=${cumulative.toFixed(3)}[${outLabel}]`,
    )
    prevLabel = outLabel
    if (i < durations.length - 1) {
      cumulative += durations[i] - crossfade
    }
  }

  return { filter: parts.join(';'), outputLabel: 'vout' }
}

async function getVideoDuration(ffmpeg: string, filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, ['-i', filePath], { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('close', () => {
      const match = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/)
      if (match) {
        resolve(
          parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3]),
        )
      } else {
        resolve(15)
      }
    })
    proc.on('error', () => resolve(15))
  })
}

async function exportSlideshow(options: ExportOptions): Promise<void> {
  const ffmpeg = getFfmpegPath()
  const { items, musicPath, settings, outputPath } = options
  if (items.length === 0) throw new Error('No media items to export')

  const workDir = path.join(app.getPath('temp'), `mannycandoit-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })

  try {
    sendProgress({ stage: 'Preparing clips…', percent: 5 })

    const photoDuration = settings.photoDurationSec
    const clipPaths: string[] = []
    const clipDurations: number[] = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const clipPath = path.join(workDir, `clip_${String(i).padStart(4, '0')}.mp4`)
      const pct = 5 + (i / items.length) * 40
      sendProgress({ stage: `Processing ${item.name}…`, percent: pct })

      const scalePad = `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1`

      if (item.type === 'photo') {
        const imagePath = await prepareImageForFfmpeg(item.path, workDir)
        const duration = photoDuration
        await runFfmpeg(ffmpeg, [
          '-y',
          '-loop',
          '1',
          '-i',
          imagePath,
          '-t',
          String(duration),
          '-vf',
          scalePad,
          '-r',
          String(FPS),
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-an',
          clipPath,
        ])
        clipPaths.push(clipPath)
        clipDurations.push(duration)
      } else {
        const srcDur = item.durationSec ?? (await getVideoDuration(ffmpeg, item.path))
        const duration =
          settings.videoMaxLengthSec > 0
            ? Math.min(srcDur, settings.videoMaxLengthSec)
            : srcDur
        await runFfmpeg(ffmpeg, [
          '-y',
          '-i',
          item.path,
          '-t',
          String(duration),
          '-vf',
          scalePad,
          '-r',
          String(FPS),
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-an',
          clipPath,
        ])
        clipPaths.push(clipPath)
        clipDurations.push(duration)
      }
    }

    sendProgress({ stage: 'Crossfading clips…', percent: 50 })

    const totalVideoDuration =
      clipDurations.reduce((a, b) => a + b, 0) - CROSSFADE_SEC * Math.max(0, clipDurations.length - 1)

    const inputArgs = clipPaths.flatMap((p) => ['-i', p])
    const { filter: xfadeFilter } = buildXfadeFilter(clipDurations, CROSSFADE_SEC)

    const videoOnlyPath = path.join(workDir, 'video_only.mp4')

    if (clipPaths.length === 1) {
      await fs.copyFile(clipPaths[0], videoOnlyPath)
    } else {
      await runFfmpeg(ffmpeg, [
        '-y',
        ...inputArgs,
        '-filter_complex',
        xfadeFilter,
        '-map',
        '[vout]',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(FPS),
        videoOnlyPath,
      ])
    }

    sendProgress({ stage: 'Adding music…', percent: 75 })

    if (musicPath) {
      await runFfmpegWithProgress(
        ffmpeg,
        [
          '-y',
          '-i',
          videoOnlyPath,
          '-stream_loop',
          '-1',
          '-i',
          musicPath,
          '-map',
          '0:v',
          '-map',
          '1:a',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          outputPath,
        ],
        (pct) => sendProgress({ stage: 'Rendering final video…', percent: 75 + pct * 0.2 }),
        totalVideoDuration,
      )
    } else {
      await runFfmpegWithProgress(
        ffmpeg,
        ['-y', '-i', videoOnlyPath, '-c:v', 'copy', '-an', outputPath],
        (pct) => sendProgress({ stage: 'Rendering final video…', percent: 75 + pct * 0.2 }),
        totalVideoDuration,
      )
    }

    sendProgress({ stage: 'Done!', percent: 100 })
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'MannyCanDoIt',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Choose a folder with photos and videos',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('pick-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Media',
        extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'mp4', 'mov', 'm4v'],
      },
    ],
    title: 'Choose photos and videos',
  })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('pick-music', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac'] }],
    title: 'Choose background music',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('pick-save-location', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save slideshow video',
    defaultPath: `MannySlideshow-${new Date().toISOString().slice(0, 10)}.mp4`,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('import-paths', async (_event, inputPaths: string[]) => {
  const filePaths = await pathsFromInput(inputPaths)
  const items: MediaItem[] = []
  const ffmpeg = getFfmpegPath()

  for (const filePath of filePaths) {
    const type = isPhoto(filePath) ? 'photo' : 'video'
    const dateTaken = await getDateTaken(filePath, type)
    const thumbnail = await createThumbnail(filePath, type)
    const durationSec =
      type === 'video' ? await getVideoDuration(ffmpeg, filePath) : undefined
    items.push({
      id: randomUUID(),
      path: filePath,
      name: path.basename(filePath),
      type,
      thumbnail,
      dateTaken,
      durationSec,
    })
  }

  return items
})

ipcMain.handle('generate-thumbnail', async (_event, filePath: string) => {
  const type = isPhoto(filePath) ? 'photo' : 'video'
  return createThumbnail(filePath, type)
})

ipcMain.handle('auto-arrange', async (_event, items: MediaItem[]) => {
  const originalCount = items.length

  const withDates = await Promise.all(
    items.map(async (item) => ({
      ...item,
      dateTaken: item.dateTaken ?? (await getDateTaken(item.path, item.type)),
    })),
  )

  const sorted = [...withDates].sort((a, b) => (a.dateTaken ?? 0) - (b.dateTaken ?? 0))

  const BURST_MS = 3000
  const result: MediaItem[] = []

  let burstGroup: MediaItem[] = []

  const flushBurstGroup = async () => {
    if (burstGroup.length === 0) return
    if (burstGroup.length === 1) {
      result.push(burstGroup[0])
    } else {
      let best = burstGroup[0]
      let bestScore = await computeSharpnessScore(best.path)
      for (let i = 1; i < burstGroup.length; i++) {
        const score = await computeSharpnessScore(burstGroup[i].path)
        if (score > bestScore) {
          best = burstGroup[i]
          bestScore = score
        }
      }
      result.push(best)
    }
    burstGroup = []
  }

  for (const item of sorted) {
    if (item.type !== 'photo') {
      await flushBurstGroup()
      result.push(item)
      continue
    }

    const lastInBurst = burstGroup[burstGroup.length - 1]
    if (
      lastInBurst &&
      lastInBurst.dateTaken &&
      item.dateTaken &&
      item.dateTaken - lastInBurst.dateTaken <= BURST_MS
    ) {
      burstGroup.push(item)
    } else {
      await flushBurstGroup()
      burstGroup = [item]
    }
  }
  await flushBurstGroup()

  const removedCount = originalCount - result.length
  const message =
    removedCount > 0
      ? `Sorted ${originalCount} items chronologically, removed ${removedCount} near-duplicates`
      : `Sorted ${originalCount} items chronologically`

  return { items: result, message }
})

ipcMain.handle('export-video', async (_event, options: ExportOptions) => {
  try {
    await exportSlideshow(options)
    shell.showItemInFolder(options.outputPath)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed'
    return { success: false, error: message }
  }
})
