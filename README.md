# Patter

Local-first, context-aware dictation for macOS and Windows. Speak naturally — Patter transcribes, cleans up, and pastes the text into whatever app you're using. Everything runs on-device: transcription, LLM cleanup, meeting notes, and memory. Nothing is uploaded anywhere.

## Features

### Dictation
- **On-device transcription** — Whisper (OpenAI) and Parakeet (Nvidia), Metal/GPU-accelerated. Six models from 78 MB to 1.6 GB; pick fast or accurate per your hardware.
- **AI cleanup** — Built-in S1-mini by Superwhisper on Apple Silicon, or a local Ollama model, cleans up dictation before the text is typed. Silence and noise trimmed by on-device VAD (Silero) first.
- **App-aware profiles** — Patter knows which app is frontmost and applies per-app cleanup rules (casual for Slack, verbatim for code editors, formal for Mail, and so on).
- **Push-to-talk or toggle** — hold the hotkey to record and release to transcribe, or press once to start/stop. Works with modifier-only keys (e.g. right Option) or full combos.
- **Two output modes** — instant paste (clipboard + simulated paste) or simulated typing (keystroke-by-keystroke, for remote desktops).
- **Command mode** — select text anywhere, then either press a separate hotkey or just open your normal dictation with a trigger phrase ("Patter, make this formal"), and say what to do with it ("make this formal", "turn this into bullet points", "make this idiomatic"). The local model rewrites the selection in place. With nothing selected, it writes what you asked for instead.

### Meetings
- Record a meeting from your mic; stop to get a transcript, minutes, decisions, and action items — generated locally by Ollama.
- Optional speaker diarization ("Speaker 1: ...") via on-device models.
- Independent, customizable hotkey to start/stop meeting recording — separate from the dictation hotkey.
- Cancel a recording or an in-progress transcription/summarization at any point, from the HUD or the Meetings page.
- Meeting audio is streamed to disk during capture (not held in RAM), so long meetings don't balloon memory.

### Personalization
- **Personal memory** — teach Patter facts about you, your projects, and your jargon; it uses them (via local embeddings) to get names and terms right.
- **Dictionary** — a custom vocabulary list for names, acronyms, and slang. Spelling corrections run before cleanup and again on the final result with either S1-mini or Ollama. Whisper also receives vocabulary hints, and Ollama receives the terms as cleanup context. Corrections still work with cleanup off.
- **Learns from your edits** — correct a transcript in History and Patter offers to remember the preferred spelling and the misheard variants. Approved variants become exact word or phrase replacements across speech models, with or without cleanup. Click a Dictionary term to edit its spelling and corrections. It proposes, never adds on its own.
- **Voice macros** — say a short trigger phrase, get a whole block of text expanded automatically (addresses, sign-offs, boilerplate).

### Interface
- **HUD** — a small floating pill shows live status (listening, transcribing, cleaning up) with a waveform visualizer, and appears on whichever monitor your cursor is on.
- **History** — every dictation is saved, searchable, and editable. Favorite transcripts, filter by app or date, and use arrow keys to browse, Enter to edit, and Command/Ctrl+Enter to save.
- **Readiness** — Home shows your microphone, speech model, cleanup availability, shortcut, and permission issues with direct setup actions.
- **Transcript recovery** — known output failures and clipboard fallbacks remain available on Home and in the Transcripts recovery filter until marked handled. Copy saved text into the intended app. Output dispatch confirms that the OS accepted the action, not that the target app inserted the text.
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
2. Release (or press again): Whisper or Parakeet transcribes on your GPU, then your selected cleanup model polishes the result. Ollama can also use your memory and the active app's profile.
3. Finished text lands at your cursor. Every dictation is saved to History, editable and searchable.

Meetings follow the same local pipeline — record, then transcribe → (optionally) diarize → summarize, all on-device.

## Development

Built with Rust, Tauri (v2), React, and Tailwind CSS.

### Prerequisites

- Rust toolchain: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node.js (v18+)
- macOS: full Xcode (Swift 6.2+) and its Metal toolchain for the bundled MLX helper (`xcodebuild -downloadComponent MetalToolchain`)
- Windows: the Visual Studio Build Tools (C++ workload) and WebView2 runtime

### Running Locally

```bash
npm install
npm run tauri dev
```

### Cleanup experiments

The [custom cleanup model experiment](training/cleanup/README.md) defines the first
fine-tuning milestone, behavior contract, and reviewed dataset preparation.

See [the cleanup evaluation suite](evals/cleanup/README.md) for repeatable quality
and latency comparisons, per-request Ollama counters, and optional local MLflow
tracking backed by SQLite.

### Dictation latency baseline

Run `npm run tauri dev` and look for `[timing]` in the terminal after a
successful dictation. Each line includes a session ID and these durations:

- `capture`: stop-handler entry through audio snapshot and worker scheduling.
- `prepare`: mono conversion, resampling, optional filtering, and settings snapshot.
- `vad`: silence trimming, including model preparation if needed.
- `transcribe`: speech recognition, including waiting for the engine lock.
- `memory`: embedding and memory retrieval (zero when skipped).
- `cleanup_first_text_ms`: time from cleanup start to first nonempty visible text,
  before HUD throttling (`None` if none arrives); this is part of `cleanup`.
- `cleanup`: the complete LLM rewrite, including a failed attempt before fallback.
- `output_dispatch`: output permission check and clipboard/keystroke scheduling.
- `total`: stop-handler entry through output dispatch, before history persistence.

`total` includes miscellaneous processing between stages, so the listed durations
need not sum to it. Output dispatch does not confirm that the target app has
inserted the text. `audio_seconds` is the processed audio length after trimming.
Command mode, cancellation, and empty/error recordings do not emit this baseline.

For a useful comparison, keep the speech model and microphone fixed, use the
same roughly 5-, 15-, and 30-second phrases, and collect at least 20 samples per
configuration. Compare cleanup off, cleanup on without memories, and cleanup on
with memories. Record the first run after launch separately from subsequent warm
runs. For each group, sort `total` and compare the median (p50) and the value at
rank `ceil(0.95 * sample_count)` (p95); inspect the individual stages to explain
the difference. Note hardware, selected models, whisper mode, and silence trimming.

### Architecture

- **Core**: Rust (Tauri) for audio capture (`cpal`), global hotkeys and keyboard/accessibility APIs (a local `rdev` fork plus `enigo`), and local transcription (`whisper-rs`, `sherpa-onnx` for Parakeet and diarization).
- **Frontend**: React + Vite + Tailwind for the dashboard and the floating HUD, communicating with the Rust backend over Tauri's IPC.
- **LLM pipeline**: built-in MLX S1-mini for English dictation cleanup on Apple Silicon; Ollama for general cleanup, meeting summaries, commands, and memory embeddings. No cloud APIs, no accounts.

### Built-in cleanup (Apple Silicon)

Choose **Dictation Cleanup Provider → Built-in → S1-mini**, then click
**Download & enable S1-mini**. Setup downloads 347 MB of pinned, checksum-verified
weights, loads the model, sets transcription to English, and enables cleanup.
Existing cleanup settings stay active until setup succeeds. Failed downloads can
be retried; verified files are reused. After setup, cleanup works offline.

S1-mini by Superwhisper is offered as a **beta** on Apple Silicon with macOS 14+.
Unsupported devices retain Ollama. Missing weights, missing runtime files, and
non-English settings cannot activate built-in cleanup. Disable cleanup or switch
to Ollama before selecting another transcription language.

Patter maps the active app and existing App Profile to supported tone, list, and
email hints. Chat apps use a conversational style; email apps use email layout;
notes apps permit lists. Terminal/code apps and profiles requesting verbatim
output bypass normalization. Free-form instructions and personal memory require
Ollama. Dictionary corrections still apply with either provider. Meetings, voice
commands, and memory embedding generation use Ollama.

Use **Try a transcript** to preview cleanup and an App Profile without dictating
into another app. Long transcripts are split with S1-mini's tokenizer into chunks
of at most 384 tokens, preferring sentence boundaries. Supported app hints apply
to every chunk; formatting across chunks can vary. Only successfully completed
output is pasted. Cancellation kills the worker; a failed or truncated chunk
retains the original transcript. The input limit is 128 KB.

Existing S1-mini downloads and Ollama selections are preserved. Retired built-in
model selections migrate to S1-mini with cleanup disabled until setup completes.
Beta/RC release tags (for example, `v0.4.16-beta.1`) publish as GitHub prereleases,
so the stable updater continues using the latest stable release.

See [release checks](docs/s1-mini-release-checks.md) for validation results and
remaining device/distribution checks before release.

For development, install full Xcode (Swift 6.2+) and its Metal toolchain:

```bash
xcodebuild -downloadComponent MetalToolchain
npm run tauri dev
```

patter-1-nano is available under **Intelligence → Built-in → patter-1-nano**.
Click **Download & enable patter-1-nano** to install the pinned model from the
[patter-1-nano model release](https://github.com/srikark283/patter/releases).
The app verifies each file's size and SHA-256, resumes verified files on retry,
and loads the model before changing cleanup settings. S1-mini remains available;
selecting a model previews setup until you enable it. Both currently require
English on Apple Silicon with macOS 14 or newer. The download includes the
Gemma terms, prohibited-use policy, and modification notices; these terms govern
the model weights separately from Patter's application source license.

patter-1-nano uses its fine-tuning contract: the cleanup policy and a JSON payload with
`trusted_instruction` and `transcript` in a Gemma user turn. App Profiles provide
the trusted instruction, with the training project's default app policy used
otherwise. Personal memory remains an Ollama feature. Code and terminal dictation
stays verbatim. patter-1-nano uses 256-token transcript chunks; S1-mini keeps its
384-token chunks. Failed, cancelled, or truncated cleanup retains the original
transcript. patter-1-nano is currently best suited to short dictation: the longer native
regression sample still reaches the generation limit and retains its original text.

patter-1-nano can receive compatible weights-only updates through a shared channel at
`https://raw.githubusercontent.com/srikark283/patter/model-channel/models/patter-1-nano/stable.json`.
Opening patter-1-nano settings checks for an update. **Update** downloads the advertised
immutable release, verifies every file, probes the model, and atomically changes
the active manifest. The previous version remains available through **Restore**,
including offline. A failed download or probe keeps the working version. In-flight
cleanup and model activation are serialized, and the worker reloads when the model
path changes. The bundled v1 manifest remains an offline/bootstrap fallback.

Deploy from the sibling `patter-model` project with one command:

```bash
uv run patter deploy --name YOUR_TRAINED_MODEL_NAME
```

This fuses the checkpoint, builds matching MLX/GGUF exports, verifies both
runtimes, publishes immutable content-versioned assets and promotes the shared
channel. `uv run patter deploy` selects and exports the newest completed patter-1-nano
checkpoint automatically; `--source`/`--bf16` select explicit existing exports,
and `--prepare-only` verifies without publishing. To roll the server channel back,
run `uv run patter promote-model patter-1-nano-RELEASE_HASH`. See `patter-model/README.md`
for prerequisites and protocol details. No per-app manifest edits are needed for
subsequent compatible weight updates. Devices need the channel-capable app once;
architecture or prompt-contract changes still require a new runtime/app release.

The legacy `scripts/prepare-flash-release.py` remains available for verifying the
bundled v1 fallback. Model weights stay outside Git and app installers. GitHub
model prereleases do not change the stable app updater. The current smoke checks
verify loadability and basic preservation, not broad cleanup quality.

`tauri dev` builds the helper automatically (`npm run build:s1` builds it alone).
`tauri build` packages the helper, Metal library, Swift compatibility libraries,
and license notices. Model weights are downloaded inside the app. Revisions and
checksums are recorded in `native/s1-mini/model.json`;
Swift dependencies are locked in `native/s1-mini/Package.resolved`.

The helper builds MLX with `MLX_METAL_NO_NAX` so it uses standard Metal GPU
kernels on both physical and virtualized Macs. This avoids unsupported
cooperative-tensor kernels on CI runners; the hardware smoke test remains enabled.

The model-free chunking regression check:

```bash
xcrun swiftc native/s1-mini/Sources/PatterS1/TranscriptChunks.swift native/s1-mini/Tests/ChunkingCheck.swift -o /tmp/patter-chunk-check
/tmp/patter-chunk-check
```

The hardware integration test downloads S1-mini to a temporary cache and checks
cleanup, filler removal, long input, and worker shutdown:

```bash
cargo test --manifest-path src-tauri/Cargo.toml s1::tests -- --include-ignored --nocapture
```

Model license texts are retained in `native/s1-mini/licenses/` and bundled with
the helper. MLX conversions are provided by mlx-community.

`patter-1-nano` is the canonical model identity in settings, releases, and caches.
The v2 channel lives at `models/patter-1-nano/stable.json` on `model-channel`.
Each release has an immutable `patter-1-nano-<hash>` version, with separate
`mlx-4bit` and `gguf-q4_k_m` variant IDs. A future `patter-1-mini` is a separate
model, with its own channel, selection, and cache. Runtime support must exist
before a new model can be offered by an app. Historical Flash descriptors and
settings are accepted only for migration and offline rollback; new deployments
use Nano names throughout.
