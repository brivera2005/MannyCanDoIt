import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import sharp from 'sharp'
import exifr from 'exifr'
import ffmpegPath from 'ffmpeg-static'
import type { ExportOptions, ExportProgress, MediaItem, Settings, TransitionStyle, UpdateInfo } from '../src/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v'])
const CROSSFADE_SEC = 1
const FPS = 30
const MIN_SCREENSHOT_DIM = 200

let mainWindow: BrowserWindow | null = null
let manualUpdateCheck = false

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

function getOutputDimensions(resolution: Settings['outputResolution']): { width: number; height: number } {
  return resolution === '720p' ? { width: 1280, height: 720 } : { width: 1920, height: 1080 }
}

function getCrossfadeSec(style: TransitionStyle): number {
  return style === 'hard-cut' ? 0 : CROSSFADE_SEC
}

function sendProgress(progress: ExportProgress) {
  mainWindow?.webContents.send('export-progress', progress)
}

function sendUpdateStatus(info: UpdateInfo) {
  mainWindow?.webContents.send('update-status', info)
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

async function isScreenshot(filePath: string): Promise<boolean> {
  const name = path.basename(filePath)
  if (/screenshot/i.test(name)) return true

  try {
    if (isPhoto(filePath)) {
      const meta = await sharp(filePath).metadata()
      const w = meta.width ?? 0
      const h = meta.height ?? 0
      if (w > 0 && h > 0 && (w < MIN_SCREENSHOT_DIM || h < MIN_SCREENSHOT_DIM)) return true
    }
  } catch {
    // not a screenshot by dimension
  }

  return false
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

function buildScaleFilter(
  width: number,
  height: number,
  settings: Settings,
  durationSec: number,
  isPhotoClip: boolean,
): string {
  const fitFilter =
    settings.photoFit === 'fit'
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`
      : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`

  if (settings.kenBurns && isPhotoClip) {
    const frames = Math.max(1, Math.ceil(durationSec * FPS))
    return `${fitFilter},zoompan=z='min(zoom+0.0004,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${FPS}`
  }

  return fitFilter
}

function buildAssemblyFilter(
  durations: number[],
  crossfade: number,
  transitionStyle: TransitionStyle,
  includeAudio: boolean,
): { filter: string; videoOut: string; audioOut?: string } {
  if (durations.length === 1) {
    if (includeAudio) {
      return {
        filter: '[0:v]format=yuv420p[vout];[0:a]aformat=sample_rates=44100:channel_layouts=stereo[aout]',
        videoOut: 'vout',
        audioOut: 'aout',
      }
    }
    return { filter: '[0:v]format=yuv420p[vout]', videoOut: 'vout' }
  }

  if (crossfade <= 0) {
    const videoInputs = durations.map((_, i) => `[${i}:v]`).join('')
    const filterParts = [`${videoInputs}concat=n=${durations.length}:v=1:a=0[vout]`]
    if (includeAudio) {
      const audioInputs = durations.map((_, i) => `[${i}:a]`).join('')
      filterParts.push(`${audioInputs}concat=n=${durations.length}:v=0:a=1[aout]`)
    }
    return { filter: filterParts.join(';'), videoOut: 'vout', audioOut: includeAudio ? 'aout' : undefined }
  }

  const xfadeTransition = transitionStyle === 'fade-black' ? 'fadeblack' : 'fade'
  const parts: string[] = []
  let cumulative = durations[0] - crossfade
  let prevVLabel = '0:v'
  let prevALabel = '0:a'

  for (let i = 1; i < durations.length; i++) {
    const vOutLabel = i === durations.length - 1 ? 'vout' : `xv${i}`
    parts.push(
      `[${prevVLabel}][${i}:v]xfade=transition=${xfadeTransition}:duration=${crossfade}:offset=${cumulative.toFixed(3)}[${vOutLabel}]`,
    )
    prevVLabel = vOutLabel

    if (includeAudio) {
      const aOutLabel = i === durations.length - 1 ? 'aout' : `xa${i}`
      parts.push(
        `[${prevALabel}][${i}:a]acrossfade=d=${crossfade}:c1=tri:c2=tri[${aOutLabel}]`,
      )
      prevALabel = aOutLabel
    }

    if (i < durations.length - 1) {
      cumulative += durations[i] - crossfade
    }
  }

  return { filter: parts.join(';'), videoOut: 'vout', audioOut: includeAudio ? 'aout' : undefined }
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

  const { width, height } = getOutputDimensions(settings.outputResolution)
  const crossfade = getCrossfadeSec(settings.transitionStyle)
  const includeVideoAudio = !settings.muteVideoAudio

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

      if (item.type === 'photo') {
        const imagePath = await prepareImageForFfmpeg(item.path, workDir)
        const duration = photoDuration
        const vf = buildScaleFilter(width, height, settings, duration, true)
        const args = [
          '-y',
          '-loop',
          '1',
          '-i',
          imagePath,
          '-t',
          String(duration),
          '-vf',
          vf,
          '-r',
          String(FPS),
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
        ]

        if (includeVideoAudio) {
          args.push(
            '-f',
            'lavfi',
            '-i',
            'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-shortest',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
          )
        } else {
          args.push('-an')
        }

        args.push(clipPath)
        await runFfmpeg(ffmpeg, args)
        clipPaths.push(clipPath)
        clipDurations.push(duration)
      } else {
        const srcDur = item.durationSec ?? (await getVideoDuration(ffmpeg, item.path))
        const duration =
          settings.videoMaxLengthSec > 0
            ? Math.min(srcDur, settings.videoMaxLengthSec)
            : srcDur
        const vf = buildScaleFilter(width, height, settings, duration, false)
        const args = [
          '-y',
          '-i',
          item.path,
          '-t',
          String(duration),
          '-vf',
          vf,
          '-r',
          String(FPS),
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
        ]

        if (includeVideoAudio) {
          args.push('-c:a', 'aac', '-b:a', '192k')
        } else {
          args.push('-an')
        }

        args.push(clipPath)
        await runFfmpeg(ffmpeg, args)
        clipPaths.push(clipPath)
        clipDurations.push(duration)
      }
    }

    const assemblyLabel =
      crossfade > 0 ? 'Blending transitions…' : 'Joining clips…'
    sendProgress({ stage: assemblyLabel, percent: 50 })

    const totalVideoDuration =
      clipDurations.reduce((a, b) => a + b, 0) - crossfade * Math.max(0, clipDurations.length - 1)

    const inputArgs = clipPaths.flatMap((p) => ['-i', p])
    const { filter: assemblyFilter, audioOut } = buildAssemblyFilter(
      clipDurations,
      crossfade,
      settings.transitionStyle,
      includeVideoAudio,
    )

    const videoOnlyPath = path.join(workDir, 'video_only.mp4')
    const videoWithAudioPath = path.join(workDir, 'video_with_audio.mp4')

    if (clipPaths.length === 1) {
      await fs.copyFile(clipPaths[0], includeVideoAudio ? videoWithAudioPath : videoOnlyPath)
    } else {
      const mapArgs = ['-map', '[vout]']
      if (audioOut) mapArgs.push('-map', `[${audioOut}]`)

      await runFfmpeg(ffmpeg, [
        '-y',
        ...inputArgs,
        '-filter_complex',
        assemblyFilter,
        ...mapArgs,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(FPS),
        ...(audioOut ? ['-c:a', 'aac', '-b:a', '192k'] : []),
        includeVideoAudio ? videoWithAudioPath : videoOnlyPath,
      ])
    }

    const assembledPath = includeVideoAudio ? videoWithAudioPath : videoOnlyPath

    sendProgress({ stage: 'Adding music…', percent: 75 })

    if (musicPath) {
      const vol = settings.musicVolume / 100
      const fadeSec = 2
      let musicFilter = `[1:a]volume=${vol.toFixed(2)}`
      if (settings.fadeMusic && totalVideoDuration > fadeSec * 2) {
        const fadeOutStart = (totalVideoDuration - fadeSec).toFixed(3)
        musicFilter += `,afade=t=in:st=0:d=${fadeSec},afade=t=out:st=${fadeOutStart}:d=${fadeSec}`
      }
      musicFilter += '[music]'

      if (includeVideoAudio) {
        const filterComplex = `[0:a]aformat=sample_rates=44100:channel_layouts=stereo[va];${musicFilter};[va][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`
        await runFfmpegWithProgress(
          ffmpeg,
          [
            '-y',
            '-i',
            assembledPath,
            '-i',
            musicPath,
            '-filter_complex',
            filterComplex,
            '-map',
            '0:v',
            '-map',
            '[aout]',
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
          [
            '-y',
            '-i',
            assembledPath,
            '-stream_loop',
            '-1',
            '-i',
            musicPath,
            '-filter_complex',
            musicFilter,
            '-map',
            '0:v',
            '-map',
            '[music]',
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
      }
    } else {
      await runFfmpegWithProgress(
        ffmpeg,
        ['-y', '-i', assembledPath, '-c:v', 'copy', ...(includeVideoAudio ? ['-c:a', 'copy'] : ['-an']), outputPath],
        (pct) => sendProgress({ stage: 'Rendering final video…', percent: 75 + pct * 0.2 }),
        totalVideoDuration,
      )
    }

    sendProgress({ stage: 'Done!', percent: 100 })
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({ version: info.version, status: 'available' })
    if (!manualUpdateCheck) {
      dialog
        .showMessageBox(mainWindow!, {
          type: 'info',
          title: 'Update Available',
          message: `MannyCanDoIt ${info.version} is available.`,
          detail: 'Would you like to download it now?',
          buttons: ['Download', 'Later'],
          defaultId: 0,
        })
        .then((result) => {
          if (result.response === 0) autoUpdater.downloadUpdate()
        })
    }
  })

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus({ version: app.getVersion(), status: 'not-available' })
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow!, {
        type: 'info',
        title: 'No Updates',
        message: 'You are running the latest version.',
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({ version: info.version, status: 'downloaded' })
    dialog
      .showMessageBox(mainWindow!, {
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded.`,
        detail: 'Restart the app to install the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall()
      })
  })

  autoUpdater.on('error', (err) => {
    sendUpdateStatus({
      version: app.getVersion(),
      status: 'error',
      message: err.message,
    })
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow!, {
        type: 'error',
        title: 'Update Check Failed',
        message: err.message,
      })
    }
  })
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates',
          click: () => {
            manualUpdateCheck = true
            sendUpdateStatus({ version: app.getVersion(), status: 'checking' })
            autoUpdater.checkForUpdates().catch((err: Error) => {
              if (manualUpdateCheck) {
                dialog.showMessageBox(mainWindow!, {
                  type: 'error',
                  title: 'Update Check Failed',
                  message: err.message,
                })
              }
            }).finally(() => {
              manualUpdateCheck = false
            })
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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
  buildMenu()
  setupAutoUpdater()
  createWindow()

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {})
  }

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

ipcMain.handle('pick-save-location', async (_event, useDateTemplate: boolean) => {
  const dateStr = new Date().toISOString().slice(0, 10)
  const defaultName = useDateTemplate
    ? `slideshow-${dateStr}.mp4`
    : `MannySlideshow-${dateStr}.mp4`
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save slideshow video',
    defaultPath: defaultName,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  })
  return result.canceled ? null : result.filePath
})

ipcMain.handle('import-paths', async (_event, inputPaths: string[], skipScreenshots: boolean) => {
  const filePaths = await pathsFromInput(inputPaths)
  const items: MediaItem[] = []
  const ffmpeg = getFfmpegPath()

  for (const filePath of filePaths) {
    if (skipScreenshots && (await isScreenshot(filePath))) continue

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
    if (options.settings.openFolderWhenDone) {
      shell.showItemInFolder(options.outputPath)
    }
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed'
    return { success: false, error: message }
  }
})

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return {
      version: app.getVersion(),
      status: 'not-available' as const,
      message: 'Updates are only available in the packaged app.',
    }
  }

  manualUpdateCheck = true
  sendUpdateStatus({ version: app.getVersion(), status: 'checking' })
  try {
    const result = await autoUpdater.checkForUpdates()
    manualUpdateCheck = false
    if (result?.updateInfo) {
      return { version: result.updateInfo.version, status: 'available' as const }
    }
    return { version: app.getVersion(), status: 'not-available' as const }
  } catch (err) {
    manualUpdateCheck = false
    const message = err instanceof Error ? err.message : 'Update check failed'
    return { version: app.getVersion(), status: 'error' as const, message }
  }
})
