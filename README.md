# MannyCanDoIt

A simple Windows desktop app to turn photos and videos into a slideshow with background music — built for family memories.

## Features

### Core workflow
- **Import** photos (JPG, PNG, HEIC, WebP) and videos (MP4, MOV) via drag-and-drop, folder picker, or file picker
- **Timeline** with thumbnails — drag to reorder, shuffle, or click ✕ to remove
- **Background music** — pick one MP3, WAV, M4A, or AAC file (loops to fit video length)
- **Natural duration** — live estimated total from photos × seconds-per-photo plus video lengths
- **Photo timing hints** — e.g. "With 120 photos at 4s each ≈ 8 min. Try 5s for ~10 min."
- **Auto-arrange** — sorts by EXIF date (filename or file date fallback), then deduplicates
- **Make Video** — renders an MP4 with ffmpeg

### Duplicate removal (auto-arrange)
By default, **burst dedup** groups photos taken within **3 seconds** and keeps the **sharpest** frame (Laplacian variance via sharp). This is the safe default for everyday use.

Optional **Smart visual dedup** (off by default, in More options) adds perceptual hashing:
- Computes a **dHash** (64-bit difference hash) for each photo
- Groups visually similar images (Hamming distance ≤ 10)
- Keeps the sharpest photo in each group
- Choose mode: **Burst only**, **Visual similarity**, or **Both**
- Toast reports: "Removed N duplicates (X burst, Y visual)"

### More options (collapsed panel)
All optional — defaults match the simple workflow above:
- **Ken Burns** slow zoom on photos
- **Transition style** — crossfade, fade-through-black, or hard cut
- **Photo fit** — letterbox (fit) or crop (fill)
- **Output resolution** — 1080p or 720p
- **Mute video audio** / **music volume** / **fade music in/out**
- **Skip screenshots** on import (by filename or tiny dimensions)
- **Shuffle timeline**
- **Remember settings** between sessions
- **Open folder when done** after export
- **Dated output filename** (`slideshow-YYYY-MM-DD.mp4`)
- **Check for updates** via GitHub releases (packaged app)

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
2. **Auto-arrange** — click to sort by date and remove burst duplicates (3s window, sharpest kept)
3. **Reorder** — drag thumbnails in the timeline, or shuffle for a random order
4. **Music** — click "Choose Music File" and pick a song
5. **Timing** — adjust seconds per photo (default 4s) and optional video max length (0 = full length)
6. **More options** — expand for Ken Burns, transitions, resolution, dedup modes, etc.
7. **Make Video** — click the big button, choose where to save, and wait for the progress bar

## Tech Stack

- Electron + React + Vite + TypeScript
- [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static) for video rendering
- [sharp](https://www.npmjs.com/package/sharp) for thumbnails, HEIC conversion, sharpness scoring, and dHash
- [exifr](https://www.npmjs.com/package/exifr) for EXIF date sorting
- [electron-updater](https://www.npmjs.com/package/electron-updater) for GitHub release updates
- electron-builder for portable Windows exe

## Notes

- First export may take a few minutes depending on how many photos/videos you import
- HEIC photos are converted automatically for ffmpeg compatibility
- Smart visual dedup is opt-in — leave it off for the classic 3-second burst behavior
- Updates are checked automatically on launch (packaged app) and manually via Help menu or More options
