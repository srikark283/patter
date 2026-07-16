# Patter

Local-first, context-aware dictation for macOS. Speak naturally, and Patter will transcribe, clean up, and seamlessly paste the text into whatever app you're using.

## Features

- **Context-Aware Profiles**: Patter knows which app you're dictating into (e.g., VS Code, ChatGPT, Slack) and automatically applies custom instructions (like "format as code" or "keep it conversational").
- **Local-First Privacy**: Run entirely on-device using local Whisper models for transcription and Ollama for cleanup formatting. No data leaves your machine unless you opt into remote APIs.
- **Remote Providers**: Optionally plug in OpenAI, Anthropic, or Google Gemini API keys for top-tier transcription and cleanup.
- **HUD Interface**: A beautiful, non-intrusive floating HUD for real-time status and quick adjustments.
- **Universal Input**: Simulates keystrokes or uses your clipboard to paste your spoken text perfectly into any active window.

## Installation

Apple Silicon only, macOS 11+.

**One command** (no Gatekeeper friction — curl'd files carry no quarantine flag):

```bash
curl -fsSL https://raw.githubusercontent.com/srikark283/patter/main/install.sh | sh
```

**Or the DMG route:**

1. Download the `.dmg` from the [latest release](https://github.com/srikark283/patter/releases/latest) and drag **Patter** to Applications.
2. Patter isn't notarized (no Apple Developer account), so macOS will claim the browser download is "damaged". It isn't — that's the quarantine flag. Clear it:

   ```bash
   xattr -cr /Applications/patter.app
   ```

3. Launch. Onboarding walks you through the mic permission, accessibility permissions (needed for automatic pasting), and setting your hotkey.

Updates install themselves in-app — Gatekeeper only ever sees the first install.

## How it works

1. Hold your configured hotkey to start recording.
2. Speak naturally.
3. Release the hotkey. Patter transcribes your audio, runs it through an LLM to clean up the formatting based on your active window, and pastes it right where your cursor is.

## Development

Built with Rust, Tauri (v2), React, and Tailwind CSS.

### Prerequisites

- Rust toolchain: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node.js (v18+)
- Xcode Command Line Tools (`xcode-select --install`) for Metal SDK and compilation

### Running Locally

```bash
npm install
npm run tauri dev
```

### Architecture

- **Core**: Rust (Tauri) for audio capture (`cpal`), keyboard/accessibility APIs (`rdev`, `enigo`), and local transcription (`whisper-rs`).
- **Frontend**: React + Vite + Tailwind for the dashboard and the floating HUD.
- **LLM Pipeline**: Integrated support for local Ollama instances and remote APIs (OpenAI, Anthropic, Gemini) for context-aware post-processing.
