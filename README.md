# MannyCanDoIt

A simple Windows desktop app to turn photos and videos into a slideshow with background music — built for family memories.

## Features

- **Import** photos (JPG, PNG, HEIC) and videos (MP4, MOV) via drag-and-drop, folder picker, or file picker
- **Timeline** with thumbnails — drag to reorder, click ✕ to remove, or **Shuffle** for a random order
- **Background music** — pick one MP3 or WAV file (loops to fit video length)
- **Natural duration** — live estimated total from photos × seconds-per-photo plus full video lengths
- **Photo timing hints** — e.g. "With 120 photos at 4s each ≈ 8 min. Try 5s for ~10 min."
- **Auto-arrange** — sorts by EXIF DateTimeOriginal (filename date or file date fallback), deduplicates burst photos within 3s keeping the sharpest (Laplacian variance via sharp), shows a toast with results
- **Make Video** — renders an MP4 with configurable transitions using ffmpeg
- **More options** — collapsible panel with optional playback, audio, import, and export settings (see below)
- **Auto-update** — checks GitHub Releases on startup and via Help → Check for Updates

## Suggested optional features

All of these live in the **More options** panel (collapsed by default). Dad can ignore them — defaults work great.

### Playback & visuals

| Option | Default | What it does |
|--------|---------|--------------|
| Ken Burns effect | Off | Subtle slow zoom on photos |
| Transition style | Crossfade | Crossfade, fade to black, or hard cut between clips |
| Photo fit | Fit (letterbox) | Fit keeps the full image; Fill crops to the frame |
| Output resolution | 1080p | 720p exports faster on slower PCs |

### Audio

| Option | Default | What it does |
|--------|---------|--------------|
| Mute original video audio | On | Music-only slideshow (turn off to keep video sound) |
| Music volume | 80% | Background music loudness |
| Fade music in/out | On | 2-second fade at start and end of the music |

### Import & curation

| Option | Default | What it does |
|--------|---------|--------------|
| Shuffle timeline | Button | Randomly reorders the timeline (does not re-import) |
| Skip screenshots | Off | Skips files named "Screenshot" or very small images on import |
| Remember last settings | On | Saves timing, music path, and all option toggles between sessions |

### Export

| Option | Default | What it does |
|--------|---------|--------------|
| Open folder when done | On | Opens File Explorer to the finished video |
| Date filename template | On | Suggests `slideshow-2026-06-23.mp4` when saving |

### Updates

| Option | Default | What it does |
|--------|---------|--------------|
| Check for updates | On startup (silent) | Prompts only when a new GitHub Release is available; also in Help menu and More options |

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- Windows 10/11 (for building the portable exe)

## Development

```bash
npm install
npm run dev
```

This opens the Electron app with hot reload.

If Electron fails to start with "failed to install correctly", run:

```bash
node node_modules/electron/install.js
```

## Build Portable Windows Exe

```bash
npm run build:win
```

The portable `.exe` will be created in the `release/` folder (e.g. `MannyCanDoIt 1.0.0.exe`).

To build without packaging (faster, for testing):

```bash
npx tsc && npx vite build
```

Then run the unpacked app from `release/win-unpacked/MannyCanDoIt.exe` after a full `npm run build:win`.

## How to Use

1. **Import** — drag a folder of phone photos onto the app, or click "Choose Folder"
2. **Auto-arrange** — click to sort by date and remove burst duplicates
3. **Reorder** — drag thumbnails in the timeline if needed (or Shuffle for random order)
4. **Music** — click "Choose Music File" and pick a song
5. **Timing** — adjust seconds per photo (default 4s) and optional video max length (0 = full length)
6. **Make Video** — click the big button, choose where to save, and wait for the progress bar

Optional tweaks are in **More options** — leave them collapsed unless you want something different.

## How Dad Gets Updates

The app checks [GitHub Releases](https://github.com/brivera2005/MannyCanDoIt/releases) automatically when it starts. If a newer version exists, it asks whether to download it. Dad can also use **Help → Check for Updates** or the button in More options.

**First time:** auto-update only works after at least one release is published on GitHub with the built `.exe` attached. Until then, dad downloads the portable exe manually from Releases.

### Publishing a new release (for maintainers)

1. Bump the version in `package.json` (e.g. `1.0.0` → `1.1.0`)
2. Build: `npm run build:win`
3. Create a GitHub Release tagged with the version (e.g. `v1.1.0`)
4. Upload the portable exe from `release/` (electron-builder also generates `latest.yml` for the updater)
5. Dad opens the app — it will prompt to update, or use Help → Check for Updates

For publishing from the command line (requires `GH_TOKEN`):

```bash
npm run build:win
# electron-builder can publish automatically if GH_TOKEN is set:
npx electron-builder --win --publish always
```

## Tech Stack

- Electron + React + Vite + TypeScript
- [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static) for video rendering
- [sharp](https://www.npmjs.com/package/sharp) for thumbnails, HEIC conversion, and sharpness scoring
- [exifr](https://www.npmjs.com/package/exifr) for EXIF date sorting
- [electron-updater](https://www.electron.build/auto-update) for GitHub Releases auto-update
- electron-builder for portable Windows exe

## Notes

- First export may take a few minutes depending on how many photos/videos you import
- HEIC photos are converted automatically for ffmpeg compatibility
- Auto-arrange burst dedup groups photos taken within 3 seconds and keeps the sharpest frame
- Settings are saved in localStorage when "Remember last settings" is on
