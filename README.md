# Patter

Local-first, context-aware dictation for macOS and Windows. Speak naturally — Patter transcribes, cleans up, and pastes the text into whatever app you're using. Everything runs on-device: transcription, LLM cleanup, meeting notes, and memory. Nothing is uploaded anywhere.

## Features

### Dictation
- **On-device transcription** — Whisper (OpenAI) and Parakeet (Nvidia), Metal/GPU-accelerated. Six models from 78 MB to 1.6 GB; pick fast or accurate per your hardware.
- **AI cleanup** — a local Ollama model fixes grammar and strips filler words before the text is typed. Silence and noise trimmed by on-device VAD (Silero) first.
- **App-aware profiles** — Patter knows which app is frontmost and applies per-app cleanup rules (casual for Slack, verbatim for code editors, formal for Mail, and so on).
- **Push-to-talk or toggle** — hold the hotkey to record and release to transcribe, or press once to start/stop. Works with modifier-only keys (e.g. right Option) or full combos.
- **Two output modes** — instant paste (clipboard + simulated paste) or simulated typing (keystroke-by-keystroke, for remote desktops).

### Meetings
- Record a meeting from your mic; stop to get a transcript, minutes, decisions, and action items — generated locally by Ollama.
- Optional speaker diarization ("Speaker 1: ...") via on-device models.
- Independent, customizable hotkey to start/stop meeting recording — separate from the dictation hotkey.
- Cancel a recording or an in-progress transcription/summarization at any point, from the HUD or the Meetings page.
- Meeting audio is streamed to disk during capture (not held in RAM), so long meetings don't balloon memory.

### Personalization
- **Personal memory** — teach Patter facts about you, your projects, and your jargon; it uses them (via local embeddings) to get names and terms right.
- **Dictionary** — a custom vocabulary list for words the model should recognize (names, acronyms, slang).
- **Voice macros** — say a short trigger phrase, get a whole block of text expanded automatically (addresses, sign-offs, boilerplate).

### Interface
- **HUD** — a small floating pill shows live status (listening, transcribing, cleaning up) with a waveform visualizer, and appears on whichever monitor your cursor is on.
- **History** — every dictation is saved, searchable, and editable.
- **Dashboard** — words dictated, time saved, and other stats, all computed and stored locally.
- **Permissions tracker** — a Preferences page showing the live status of Accessibility, Input Monitoring, and Microphone access, with one-click links to the right System Settings pane.

### System
- Cross-platform: macOS 11+ (Apple Silicon) and Windows 10+ (x64).
- Auto-update checks on launch and periodically while running, with a native OS notification when a new version is available — install happens only when you approve it.
- Launch at login, configurable HUD position, optional UI sounds.

## Installation

**macOS** (no Gatekeeper friction — curl'd files carry no quarantine flag):

```bash
curl -fsSL https://raw.githubusercontent.com/srikark283/patter/main/install.sh | sh
```

**Windows:**

```powershell
irm https://raw.githubusercontent.com/srikark283/patter/main/install.ps1 | iex
```

**Or grab a release directly:** download the `.dmg` (macOS) or `.msi`/`.exe` (Windows) from the [latest release](https://github.com/srikark283/patter/releases/latest).

- macOS isn't notarized (no Apple Developer account), so an unquarantined download will show as "damaged" — clear it with `xattr -cr /Applications/patter.app`, or use the curl installer above, which skips this entirely.
- Windows isn't EV-signed, so SmartScreen may warn — click "More info → Run anyway", or use the installer script above.

Onboarding walks you through mic permission, Accessibility (needed for automatic pasting on macOS), a starting speech model, and your hotkey.

## How it works

1. Press your hotkey (anywhere on the desktop) and speak.
2. Release (or press again): Whisper or Parakeet transcribes on your GPU, then your local Ollama model cleans up the result using your memory and the active app's profile.
3. Finished text lands at your cursor. Every dictation is saved to History, editable and searchable.

Meetings follow the same local pipeline — record, then transcribe → (optionally) diarize → summarize, all on-device.

## Development

Built with Rust, Tauri (v2), React, and Tailwind CSS.

### Prerequisites

- Rust toolchain: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node.js (v18+)
- macOS: Xcode Command Line Tools (`xcode-select --install`) for the Metal SDK and compilation
- Windows: the Visual Studio Build Tools (C++ workload) and WebView2 runtime

### Running Locally

```bash
npm install
npm run tauri dev
```

### Architecture

- **Core**: Rust (Tauri) for audio capture (`cpal`), global hotkeys and keyboard/accessibility APIs (a local `rdev` fork plus `enigo`), and local transcription (`whisper-rs`, `sherpa-onnx` for Parakeet and diarization).
- **Frontend**: React + Vite + Tailwind for the dashboard and the floating HUD, communicating with the Rust backend over Tauri's IPC.
- **LLM pipeline**: local Ollama only — cleanup, meeting summarization, and memory embeddings all run against a model you already have pulled. No cloud APIs, no accounts.
