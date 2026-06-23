# MannyCanDoIt

A simple Windows desktop app to turn photos and videos into a slideshow with background music — built for family memories.

## Features

- **Import** photos (JPG, PNG, HEIC) and videos (MP4, MOV) via drag-and-drop, folder picker, or file picker
- **Timeline** with thumbnails — drag to reorder, click ✕ to remove
- **Background music** — pick one MP3 or WAV file (loops to fit)
- **Settings** — target duration, photo display time, video max length
- **Auto-arrange** — sorts by EXIF date (or file date) and skips burst duplicates
- **Make Video** — renders an MP4 with crossfade transitions using ffmpeg

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- Windows 10/11 (for building the installer)

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

## Build Windows Installer

```bash
npm run build:win
```

The NSIS installer will be created in the `release/` folder.

To build without creating the installer (faster, for testing):

```bash
npx tsc && npx vite build
```

Then run the unpacked app from `release/win-unpacked/MannyCanDoIt.exe` after a full `npm run build:win`.

## How to Use

1. **Import** — drag a folder of phone photos onto the app, or click "Choose Folder"
2. **Auto-arrange** — click to sort by date and remove burst duplicates
3. **Reorder** — drag thumbnails in the timeline if needed
4. **Music** — click "Choose Music File" and pick a song
5. **Settings** — adjust duration sliders (defaults: 10 min target, 4s per photo, 15s max video)
6. **Make Video** — click the big button, choose where to save, and wait for the progress bar

## Tech Stack

- Electron + React + Vite + TypeScript
- [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static) for video rendering
- [sharp](https://www.npmjs.com/package/sharp) for thumbnails and HEIC conversion
- [exifr](https://www.npmjs.com/package/exifr) for EXIF date sorting
- electron-builder for Windows NSIS installer

## Notes

- First export may take a few minutes depending on how many photos/videos you import
- HEIC photos are converted automatically for ffmpeg compatibility
- Auto-arrange burst dedup is a simple filename + timestamp heuristic (not full perceptual hashing)
