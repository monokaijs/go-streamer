# Go Streamer

Stream a remote browser to Discord via Go Live — control it from anywhere.

Go Streamer runs a full Chromium browser inside a Docker container, captures the screen with FFmpeg, and streams it to a Discord voice channel as a Go Live session. A built-in web UI lets you browse, navigate, and interact with the remote browser in real time. Discord chat commands provide media playback controls without needing the web panel.

## Features

- **Discord Go Live** — Stream browser content to any voice/stage channel
- **Remote Browser** — Full Chromium with tabs, navigation, and persistent sessions
- **Web Control Panel** — Real-time preview, mouse, keyboard, touch, and scroll input
- **Media Commands** — Play, pause, seek, volume, and more via Discord chat
- **Hardware Acceleration** — Automatic NVENC and VAAPI detection for GPU encoding
- **Live Settings** — Change resolution and FPS mid-stream without disconnecting
- **Auth** — Optional password protection for the web panel

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker Container                               │
│                                                 │
│  ┌──────────┐    x11grab   ┌────────┐           │
│  │ Chromium ├─────────────►│ FFmpeg ├──► Discord│
│  │ (Xvfb)   │              │ H.264  │   Go Live │
│  └────┬─────┘              └────────┘           │
│       │ CDP Screencast                          │
│  ┌────▼─────┐    Socket.IO  ┌────────┐          │
│  │ Node.js  ├──────────────►│ Web UI │          │
│  │ Server   │◄──────────────┤ Client │          │
│  └──────────┘   Input Fwd   └────────┘          │
└─────────────────────────────────────────────────┘
```

## Quick Start

### Docker (recommended)

```bash
# Clone
git clone https://github.com/monokaijs/go-streamer.git
cd go-streamer

# Configure
cp .env.example .env
# Edit .env with your Discord user token

# Run
docker build -t go-streamer .
docker run -d \
  --name go-streamer \
  --restart unless-stopped \
  --env-file .env \
  -p 3000:3000 \
  -v ./data:/app/data \
  go-streamer
```

Open `http://localhost:3000` to access the control panel.

### With GPU acceleration

Pass through `/dev/dri` for Intel VAAPI or add `--gpus all` for NVIDIA:

```bash
# Intel VAAPI
docker run -d \
  --name go-streamer \
  --restart unless-stopped \
  --env-file .env \
  -p 3000:3000 \
  -v ./data:/app/data \
  --device /dev/dri:/dev/dri \
  go-streamer

# NVIDIA
docker run -d \
  --name go-streamer \
  --restart unless-stopped \
  --env-file .env \
  -p 3000:3000 \
  -v ./data:/app/data \
  --gpus all \
  go-streamer
```

### Local development

```bash
npm install
npm run dev
```

> Requires Chromium, FFmpeg, Xvfb, and PulseAudio installed locally.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DISCORD_TOKEN` | — | Discord user token (required for streaming) |
| `AUTH_SECRET` | — | Password for the web panel (empty = no auth) |
| `DISCORD_COMMAND_CHANNELS` | — | Comma-separated channel IDs for chat commands (empty = all channels) |
| `WEB_PORT` | `3000` | Web UI port |
| `STREAM_WIDTH` | `1920` | Capture resolution width |
| `STREAM_HEIGHT` | `1080` | Capture resolution height |
| `STREAM_FPS` | `30` | Capture frame rate |

## Discord Commands

Control media playback from any Discord channel (or specific channels via `DISCORD_COMMAND_CHANNELS`):

| Command | Description |
|---|---|
| `!play` | Resume playback |
| `!pause` | Pause playback |
| `!pp` | Toggle play/pause |
| `!np` | Now playing info with progress bar |
| `!vol <0-100>` | Set volume |
| `!m` | Toggle mute |
| `!seek <time>` | Seek to time (`ss`, `mm:ss`, or `hh:mm:ss`) |
| `!ff [seconds]` | Fast forward (default 10s) |
| `!rw [seconds]` | Rewind (default 10s) |
| `!fs` | Toggle fullscreen |
| `!goto <url>` | Navigate to URL |
| `!reload` | Reload page |
| `!back` / `!forward` | Browser history navigation |
| `!click <x> <y>` | Click at coordinates |
| `!type <text>` | Type text |
| `!key <key>` | Press a key (e.g. `Space`, `Enter`, `Escape`) |
| `!help` | Show all commands |

## Video Encoding

Go Streamer automatically detects available hardware and selects the best encoder:

| Priority | Encoder | Detection |
|---|---|---|
| 1 | `h264_nvenc` | `nvidia-smi` available |
| 2 | `h264_vaapi` | `/dev/dri/renderD128` exists + FFmpeg VAAPI test encode passes |
| 3 | `libx264` | Fallback (CPU) |

The software fallback uses `ultrafast` preset with `zerolatency` tuning for minimal CPU overhead.

## Project Structure

```
src/
├── index.ts                  # Entry point
├── config.ts                 # Environment config
├── browser/
│   ├── browser-manager.ts    # Chromium lifecycle, tabs, screencast
│   └── input-handler.ts      # CDP mouse/keyboard/touch dispatch
├── discord/
│   ├── discord-streamer.ts   # FFmpeg pipeline, Discord Go Live
│   └── command-handler.ts    # Chat-based media controls
└── web/
    ├── server.ts             # Express + Socket.IO server
    └── public/               # Web UI (HTML/CSS/JS)
```

## CI/CD

Pushes to `main` trigger a GitHub Actions workflow that builds and pushes a Docker image to `ghcr.io/monokaijs/go-streamer:latest`.

## License

MIT
