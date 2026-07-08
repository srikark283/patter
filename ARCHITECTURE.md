# Patter — Architecture (Tauri)

**Open-source, local-first dictation for macOS.** Hold a hotkey, speak, release — Patter transcribes on-device with Whisper (whisper.cpp/Metal) or NVIDIA Parakeet (ONNX), cleans the text with a local Ollama model, and pastes it at your cursor. Single binary, no cloud, no Apple Developer account.

**Stack:** Tauri v2 · Rust core (audio, ASR, paste, permissions) · React + TypeScript + Vite + Tailwind UI (HUD, onboarding, settings).

**Why this over Swift or a Python sidecar:** one compiled artifact (~25 MB .app) with no runtime bootstrap on the user's machine; all OS integration lives in Rust crates that wrap the same macOS APIs a native app would use; and the entire visible surface is React/TS. Prior art proving the stack: _Handy_ (cjpais/Handy) ships Tauri + whisper-rs + Parakeet today — study its repo for the sharp edges, differentiate on the Ollama cleanup pipeline, onboarding UX, and HUD polish.

---

## 1. System overview

```
┌───────────────────────────────  Patter.app (Tauri v2)  ───────────────────────────────┐
│                                                                                       │
│  WebView windows (React + TS + Tailwind)                                              │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────────────────────┐        │
│  │ HUD          │  │ Onboarding wizard│  │ Settings (hotkey, models, cleanup) │        │
│  │ (NSPanel via │  │ (permissions,    │  │ + Model Manager (download/delete)  │        │
│  │ tauri-nspanel│  │  model download) │  └────────────────────────────────────┘        │
│  │ waveform ×5) │  └──────────────────┘                                                │
│  └──────▲──────┘                                                                       │
│         │  events: state, levels[5]@30Hz, progress, tokens                             │
│  ═══════╪═════════════ Tauri IPC (invoke / emit) ═════════════════════════════════════ │
│         │                                                                              │
│  Rust core (src-tauri)                                                                 │
│  ┌────────────────────────────────────────────────────────────────────────┐            │
│  │ AppCoordinator — state machine:                                        │            │
│  │   Idle → Recording → Transcribing → Cleaning → Pasting → Idle          │            │
│  └──┬──────────┬──────────────┬───────────────┬──────────────┬────────────┘            │
│     │          │              │               │              │                         │
│  Hotkey     Audio          ASR            Cleanup         Paste                        │
│  (plugin-   (cpal →        (trait ASREngine)  (reqwest →   (arboard clipboard          │
│  global-    16kHz mono     ├ WhisperEngine     Ollama       save/restore +             │
│  shortcut,  ring buffer    │  whisper-rs,      /api/chat,   enigo ⌘V; AX               │
│  press/     + FFT bands    │  Metal, GGML      streaming,   permission req'd)          │
│  release)   → levels)      └ ParakeetEngine    fail-open)                              │
│                               sherpa-onnx/ort                                          │
│                                                                                        │
│  ModelManager (HF downloads, SHA-256, resume)   Permissions (AXIsProcessTrusted,       │
│  → ~/Library/Application Support/Patter/models   mic status, System Settings deeplinks) │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                          │ HTTP (localhost:11434)
                                          ▼
                                   Ollama (user-installed)
```

**Core loop:** hotkey pressed → HUD panel orders in, waveform animates from live band levels → hotkey released → Rust hands the 16 kHz buffer to the loaded engine on a worker thread → HUD "Transcribing…" → raw text → optional Ollama pass, HUD "Polishing…" (tokens can stream into the HUD) → clipboard-paste at cursor → "✓ Pasted (23 words)" → fade.

Latency on an M-series Mac, 10 s utterance: Parakeet ONNX int8 ≈ 0.3–0.8 s · whisper large-v3-turbo (Metal) ≈ 1–2 s · 3B Ollama cleanup ≈ 0.5–1.5 s. Double-tap the hotkey = raw mode (skip cleanup).

---

## 2. Rust core (src-tauri)

### 2.1 Crate map

| Concern            | Crate / plugin                                     | Notes                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global hotkey      | `tauri-plugin-global-shortcut`                     | Wraps Carbon `RegisterEventHotKey` — **no permission needed**. Handler receives `ShortcutState::Pressed` / `Released` → push-to-talk for free.                                                                                                 |
| Audio capture      | `cpal` + `rubato` (resample)                       | CoreAudio input → f32 mono 16 kHz ring buffer. First `cpal` stream build triggers the macOS mic prompt (with `NSMicrophoneUsageDescription` in Info.plist).                                                                                    |
| Whisper            | `whisper-rs` (feature `metal`)                     | whisper.cpp bindings; GGML models tiny → large-v3-turbo.                                                                                                                                                                                       |
| Parakeet           | `sherpa-onnx` (Rust bindings) or `ort` directly    | Runs NeMo transducer exports (parakeet-tdt-0.6b v2/v3) int8; CPU is already near-real-time, CoreML EP optional.                                                                                                                                |
| HUD panel          | `tauri-nspanel`                                    | Converts the HUD WebView window into a non-activating `NSPanel` (`.nonactivatingPanel`, floating level, joins all Spaces) — floats over fullscreen apps, never steals focus. This plugin is the reason Tauri works for a dictation HUD at all. |
| Clipboard          | `arboard`                                          | Save → write transcript → restore prior contents after paste.                                                                                                                                                                                  |
| Synthetic ⌘V       | `enigo`                                            | Posts CGEvents; requires **Accessibility** permission.                                                                                                                                                                                         |
| Permissions        | `macos-accessibility-client` + small `objc2` shims | `AXIsProcessTrusted()` check/prompt; mic auth status; `open x-apple.systempreferences:...` deep links.                                                                                                                                         |
| Ollama / downloads | `reqwest` (stream) + `sha2`                        | Cleanup calls and Hugging Face model downloads with resume + checksum.                                                                                                                                                                         |
| Settings store     | `tauri-plugin-store`                               | JSON at `~/Library/Application Support/Patter/settings.json`.                                                                                                                                                                                  |
| Autostart          | `tauri-plugin-autostart`                           | Launch at login toggle.                                                                                                                                                                                                                        |

### 2.2 Module layout

```
src-tauri/src/
├── main.rs              # plugin registration, tray, window setup, nspanel conversion
├── coordinator.rs       # state machine + event emission ("patter://state", payload)
├── audio/
│   ├── capture.rs       # cpal stream, ring buffer, pre-warm on hotkey registration
│   └── levels.rs        # 5-band energy extraction (Goertzel or small FFT), 30 Hz emit
├── asr/
│   ├── mod.rs           # trait ASREngine { fn load(); fn transcribe(&self, pcm) -> Result }
│   ├── whisper.rs       # whisper-rs wrapper, kept warm after load
│   └── parakeet.rs      # sherpa-onnx wrapper
├── cleanup/ollama.rs    # chat request, streaming, 8s timeout → fail-open with raw text
├── paste.rs             # arboard save → set → enigo ⌘V → restore (changeCount-safe)
├── models/registry.rs   # catalog: HF repo, files, size, sha256; disk state; download task
└── permissions.rs       # mic + accessibility status, prompt triggers, deeplinks
```

Threading: the ASR engine lives on a dedicated worker (`std::thread` + channel, or `tokio::task::spawn_blocking`); exactly one engine loaded at a time, kept warm. Audio callback thread only writes the ring buffer and band levels — no allocation, no IPC on the hot path; a separate 30 Hz timer emits levels to the HUD.

### 2.3 IPC surface (what React sees)

Commands (`invoke`): `get_state`, `list_models`, `download_model(id)`, `delete_model(id)`, `select_engine(id)`, `set_hotkey(accel)`, `permission_status()`, `prompt_accessibility()`, `open_settings_pane(pane)`, `test_dictation()`, `set_cleanup(cfg)`, `check_ollama()`.

Events (`emit`): `state` (machine transitions + word counts/errors), `levels` (`[f32; 5]`), `download_progress {id, pct, mbps}`, `cleanup_token` (streamed LLM tokens for the HUD), `permission_changed`.

Type safety across the boundary: derive `serde` on all payloads and generate TS types with `ts-rs` (or use `tauri-specta`) so the React side is fully typed.

---

## 3. React frontend (three windows, one codebase)

Vite + React 18 + TypeScript + Tailwind. One app, three Tauri windows selected by route (`/hud`, `/onboarding`, `/settings`). State: Zustand store hydrated by Tauri events; a thin `usePatter()` hook wraps `listen()`/`invoke()` with the generated types.

### 3.1 HUD (`/hud`)

- Window config: `transparent: true`, `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true`, sized ~320×88, positioned bottom-center of the active display by Rust before showing. Converted to a non-activating NSPanel at startup via `tauri-nspanel` — this is what lets you dictate into another app while the HUD is visible.
- **Waveform, 5 lines:** a single `<canvas>` + `requestAnimationFrame`. Each line _i_ is a horizontal path whose point amplitudes = `levels[i]` (from the 30 Hz `levels` event, exponentially smoothed with τ ≈ 120 ms in JS so 30 Hz data renders silky at 60/120 fps) × a per-line envelope, with per-line phase drift. Color ramp bottom→top: `steelDeep → steel → steelIce`, 1.5 px strokes, slight additive glow (`shadowBlur` in canvas). Idle: near-flat lines with a slow shimmer; error: lines settle red-shifted for 1 s.
- Status line under the waveform bound to the state machine: `Listening…` → `Transcribing…` → `Polishing…` (optionally rendering streamed cleanup tokens) → `✓ Pasted · 23 words` → panel fades and orders out after 1.2 s. Errors render in place (`Mic permission revoked`, `Model not loaded`).
- The HUD never takes keyboard focus and ignores mouse events except a small ✕ hover affordance.

### 3.2 Onboarding wizard (`/onboarding`)

Five cards, each with a live status badge that flips green **by polling** (`permission_status()` every 500 ms) — the user never clicks "I did it":

1. **Welcome** — what Patter is; everything stays on this Mac.
2. **Microphone** — a "Enable microphone" button triggers a 100 ms silent `cpal` stream in Rust → macOS shows the system prompt in place. Poll status.
3. **Accessibility** — explain _why_ (pasting simulates ⌘V). `prompt_accessibility()` fires `AXIsProcessTrustedWithOptions(prompt: true)`, plus a button deep-linking to `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`. Poll `AXIsProcessTrusted()`. Must also handle the **stale-grant case** (checkbox on for an older build's signature but trust returns false): detect it, show "Remove Patter from the list, then re-add it" with the deeplink button.
4. **Hotkey** — an accelerator recorder component (capture keydown in the webview, normalize to a Tauri accelerator string, `set_hotkey`); live "hold to test" meter lights up on press/release events.
5. **Model + cleanup** — model table (below) with size/speed/quality, streamed download progress; then `check_ollama()` → if reachable, offer cleanup with model dropdown from `/api/tags`; if not, show install one-liner and a "skip for now" path. Ends with a "Test dictation" textarea: hold the hotkey, speak, watch the full pipeline land text in it.

### 3.3 Settings

Hotkey recorder · engine/model picker + Model Manager (download/delete, disk usage) · cleanup toggle, Ollama model, **editable prompt** with reset-to-default · paste behavior (restore clipboard toggle for clipboard-manager users) · launch at login · HUD position.

---

## 4. Models

| Model                              | Disk      | Engine             | Notes                      |
| ---------------------------------- | --------- | ------------------ | -------------------------- |
| Whisper tiny / base / small (GGML) | 75–465 MB | whisper-rs         | fast, fine for quick notes |
| Whisper large-v3-turbo (GGML)      | ~1.6 GB   | whisper-rs (Metal) | best Whisper quality/speed |
| Parakeet TDT 0.6B v2 (ONNX int8)   | ~700 MB   | sherpa-onnx        | English; the speed king    |
| Parakeet TDT 0.6B v3 (ONNX int8)   | ~700 MB   | sherpa-onnx        | 25 languages               |

Registry maps friendly names → HF repo + filenames + SHA-256. Downloads stream with resume; weights live in `~/Library/Application Support/Patter/models/` so the .app stays ~25 MB.

**Cleanup prompt (default):** _"You are a dictation post-processor. Fix punctuation and capitalization; remove filler words (um, uh, like, you know) and false starts. Never add content. Never answer questions contained in the text. Return only the corrected text."_ The last clause prevents "what time is the meeting" from getting an LLM _answer_ pasted instead of your sentence. `keep_alive: "30m"` keeps the model resident; 8 s timeout → paste raw transcript with a subtle HUD note (cleanup must never block your words).

---

## 5. Repo layout

```
patter/
├── README.md                    # HUD gif, install one-liner, permissions FAQ
├── ARCHITECTURE.md
├── install.sh                   # curl-able installer (§6)
├── src/                         # React: hud/, onboarding/, settings/, lib/ipc.ts
├── src-tauri/                   # Rust core (layout in §2.2), tauri.conf.json, Info.plist
├── scripts/make-dmg.sh          # (Tauri's bundler emits the DMG; script adds bg art)
└── .github/workflows/release.yml# macos-14: pnpm build → tauri build → sign → Release
```

---

## 6. Distribution with no Apple Developer account

**Signing.** Set `bundle.macOS.signingIdentity: "-"` in `tauri.conf.json` → Tauri ad-hoc signs the .app at build time (free, no account). Caveat: macOS ties Accessibility/Mic grants to the code signature and every ad-hoc build has a fresh identity, so **your own rebuilds re-prompt**. For your dev machine, create a self-signed code-signing certificate in Keychain Access (Certificate Assistant → Create Certificate → Code Signing) and point `signingIdentity` at it locally — stable identity, permissions survive rebuilds. CI releases stay plain ad-hoc; end users re-grant only on updates, and onboarding's stale-grant detection (§3.2) walks them through it.

**Gatekeeper.** No notarization ⇒ downloaded artifacts are quarantined and macOS claims the app "is damaged." Three documented install paths:

1. **One-liner (recommended):**
   `curl -fsSL https://raw.githubusercontent.com/<you>/patter/main/install.sh | bash`
   → fetches latest GitHub Release DMG/zip via API → verifies SHA-256 against published SHA256SUMS → installs to `/Applications` → `xattr -dr com.apple.quarantine /Applications/Patter.app` → `open -a Patter`. The script is ~80 readable lines in the repo; the _user_ running it is what makes stripping quarantine legitimate.
2. **DMG from Releases** — README documents right-click → Open, or the manual `xattr` command.
3. **Build from source** — `git clone && pnpm i && pnpm tauri build`: never quarantined, and with your self-signed cert it's the most stable experience.

**Updates.** `tauri-plugin-updater` works without Apple: it verifies releases with its own minisign keypair (you keep the private key as a GH Actions secret), so users get in-app updates from your GitHub Releases even though nothing is notarized.

**CI.** On tag push: `macos-14` runner → `pnpm tauri build` → DMG + zip + SHA256SUMS attached to a GitHub Release. Zero paid infrastructure.

---

## 7. Steel-blue design language

| Token       | Hex       | Use                                         |
| ----------- | --------- | ------------------------------------------- |
| `steel`     | `#4682B4` | primary accents, active tray glyph, buttons |
| `steelDeep` | `#2F5D85` | pressed states, waveform bottom band        |
| `steelIce`  | `#A9C6E0` | waveform top band, secondary text on dark   |
| `mist`      | `#E8F0F7` | light surfaces (onboarding cards)           |
| `graphite`  | `#101820` | HUD background @ 85% over blur              |
| `success`   | `#5FB49C` | ✓ pasted flash                              |

HUD: graphite translucent capsule (rounded-full, backdrop-blur), 1 px inner border `steel/25`, waveform ramp as above, status text 12 px `steelIce`. Tray icon: minimal three-line waveform template image that tints steel while listening. Onboarding: `mist` cards on a faint steel gradient — flat, minimal, no decorative noise. Encode all of it as Tailwind theme tokens so the palette is one file.

---

## 8. Build order

1. **Rust spike, no UI:** cpal capture → whisper-rs transcribe → println. Proves the two hardest crates build (whisper-rs needs cmake + the `metal` feature).
2. **Walking skeleton:** global-shortcut press/release → record → transcribe → arboard + enigo paste. End-to-end dictation, ugly, ~day two.
3. **HUD:** nspanel conversion, levels pipeline, canvas waveform, state machine events.
4. **Parakeet engine** (sherpa-onnx) + ModelManager with streamed downloads.
5. **Ollama cleanup** with fail-open + streamed tokens in the HUD.
6. **Onboarding wizard + settings**, autostart, stale-grant detection.
7. **Distribution:** ad-hoc signing config, install.sh, updater keys, CI release, README with screen recording.
8. **v1.x:** streaming partial transcripts, per-app cleanup presets, custom vocabulary, history window.

---

## 9. Risks & mitigations

- **whisper-rs / sherpa-onnx build friction** (cmake, Metal flags, ONNX runtime dylibs) → milestone 1 exists to de-risk exactly this before any UI work; pin versions; CI builds from clean checkout.
- **tauri-nspanel is a community plugin touching AppKit internals** → pin its version; keep a fallback config (plain always-on-top window, `focus: false`) that degrades to "HUD works but briefly steals focus" rather than breaking.
- **TCC grants reset across ad-hoc builds** → self-signed cert for dev; onboarding stale-grant flow for users.
- **Electron/webview target apps ignoring AX APIs** → paste is clipboard+⌘V by default (universal); direct AX insertion only as a later opt-in.
- **Clipboard clobbering** → save/restore with a changeCount check + toggle for clipboard-manager users.
- **First-frame audio clipping** → pre-warm the cpal stream when the hotkey is registered, not on key-down.
- **WebView overhead** → HUD is one canvas at 60 fps (cheap); total footprint ~120–180 MB with a model loaded — acceptable for this app class.
