# Comine

Cross-platform media downloader powered by yt-dlp.

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
