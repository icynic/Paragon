# Paragon

English | [简体中文](README.zh-CN.md)

A browser tool for learning languages with videos. Open a local video file (`.mkv` / `.mp4` / `.webm`), pick an audio track and two subtitle tracks, and learn while you watch.

Try it online: <https://effax.net/paragon/>

All video processing happens locally in your browser (powered by [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)); your videos are never uploaded to a server.

## Features

- Extracts audio tracks and embedded text subtitles (e.g. SRT, ASS; ASS subtitles keep their original styling and position)
- Dual subtitles: the language you are learning on top, your native language below
- Hover over a word to see its translation, click it to see dictionary definitions
- Jump to the previous / next subtitle, adjust playback speed and subtitle size
- Interface available in English and Chinese

## Running locally

Requires Node.js 18 or later.

```bash
npm install
npm run dev
```

Then open the address shown in the terminal (by default `http://localhost:5173/paragon/`).

## Other commands

```bash
npm run build           # build into dist/
npm run preview         # preview the production build
npm run test:subtitles  # run the subtitle unit tests
```

## Deployment

Create a `deploy.local` file in the project root containing the scp upload target (for example `user@host:paragon`). The file is git-ignored, so it is never committed. You can also set the `PARAGON_DEPLOY_TARGET` environment variable instead.

```bash
npm run deploy               # build, then upload the contents of dist/ to the target with scp
npm run deploy -- --dry-run  # build and print the scp command without uploading
```

Files in `assets/` have content hashes in their names, so old files on the server can be kept or deleted.

## Notes

- The app uses the single-threaded ffmpeg.wasm core, which does not need `SharedArrayBuffer`, so the server does not have to send COOP/COEP headers (the ones configured for the dev server in `vite.config.js` are not required).
- The ffmpeg core files are loaded from unpkg.com at runtime.
- Translations come from the [MyMemory](https://mymemory.translated.net/) API and definitions from [Wiktionary](https://en.wiktionary.org/); the words you look up are sent to these services.
- `base` in `vite.config.js` is set to `/paragon/`; change it if you deploy under a different path.
