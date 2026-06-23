# MannyCanDoIt

A simple Windows desktop app to turn photos and videos into a slideshow with background music — built for family memories.

## Features

- **Import** photos (JPG, PNG, HEIC) and videos (MP4, MOV) via drag-and-drop, folder picker, or file picker
- **Timeline** with thumbnails — drag to reorder, click ✕ to remove
- **Background music** — pick one MP3 or WAV file (loops to fit video length)
- **Natural duration** — live estimated total from photos × seconds-per-photo plus full video lengths (no fixed target slider)
- **Photo timing hints** — e.g. "With 120 photos at 4s each ≈ 8 min. Try 5s for ~10 min."
- **Auto-arrange** — sorts by EXIF DateTimeOriginal (filename date or file date fallback), deduplicates burst photos within 3s keeping the sharpest (Laplacian variance via sharp), shows a toast with results
- **Make Video** — renders an MP4 with crossfade transitions using ffmpeg

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
3. **Reorder** — drag thumbnails in the timeline if needed
4. **Music** — click "Choose Music File" and pick a song
5. **Timing** — adjust seconds per photo (default 4s) and optional video max length (0 = full length)
6. **Make Video** — click the big button, choose where to save, and wait for the progress bar

## Tech Stack

- Electron + React + Vite + TypeScript
- [ffmpeg-static](https://www.npmjs.com/package/ffmpeg-static) for video rendering
- [sharp](https://www.npmjs.com/package/sharp) for thumbnails, HEIC conversion, and sharpness scoring
- [exifr](https://www.npmjs.com/package/exifr) for EXIF date sorting
- electron-builder for portable Windows exe

## Notes

- First export may take a few minutes depending on how many photos/videos you import
- HEIC photos are converted automatically for ffmpeg compatibility
- Auto-arrange burst dedup groups photos taken within 3 seconds and keeps the sharpest frame
