# comine <img src="static\icon.png" align="right" height="200" alt="Comine logo (icon)" />

Cross-platform media and file downloader.

## Tech Stack

- **Frontend:** Svelte 5 + SvelteKit
- **Backend:** Tauri v2 + Rust
- **Download Engine:** yt-dlp, aria2c, ffmpeg

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/)
- [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites)

### Setup

```bash
pnpm install
pnpm tauri dev
```

### Build

```bash
# Desktop
pnpm tauri build

# Android
pnpm tauri android build
```

## License

GPL-3.0

#### Consider leaving a star ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=nichind/comine&type=Date)](https://github.com/nichind/comine)
