# Patter — Milestone 1 spike

Proves the two highest-risk pieces of the whole project — `cpal` (CoreAudio capture) and `whisper-rs` (whisper.cpp with Metal) — compile and run on your machine, **before any Tauri or UI work**. If this spike works, everything downstream is plumbing.

## Prerequisites

```bash
# Rust toolchain (if you don't have it)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# whisper-rs builds whisper.cpp from source and needs cmake
brew install cmake
```

Xcode Command Line Tools must be installed (`xcode-select --install`) — they provide clang and the Metal SDK.

## Get a model

```bash
mkdir -p models
curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

`base.en` (~142 MB) is plenty to validate the pipeline. Later swap in `ggml-large-v3-turbo.bin` for quality testing.

## Run it

```bash
cargo run --release -- models/ggml-base.en.bin
```

1. First run: macOS will prompt to give **your terminal app** microphone access — grant it. (The eventual Patter.app owns its own permission; this is just for the spike.)
2. Press Enter, speak a sentence or two, press Enter again.
3. Your transcript prints, with inference time.

## What success looks like

- Build completes (first build takes a few minutes — it's compiling whisper.cpp).
- Console shows your mic device and sample rate.
- Transcript is accurate and inference on an M-series Mac is well under real-time (a 10 s clip should transcribe in ~1 s with `base.en`).

## If it fails

| Symptom                                 | Fix                                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cmake: command not found` during build | `brew install cmake`                                                                                                                                                 |
| Build errors mentioning Metal           | Ensure Xcode CLT: `xcode-select --install`; try `cargo clean`                                                                                                        |
| `captured 0 samples`                    | System Settings → Privacy & Security → Microphone → enable for your terminal                                                                                         |
| Gibberish transcript                    | You probably fed it a multilingual model with `set_language(Some("en"))`, or the resample rate mismatched — check the console line showing device sample rate        |
| whisper-rs version conflicts            | Check crates.io for the latest `whisper-rs` and adjust `Cargo.toml`; the API surface used here (WhisperContext / FullParams / full) is stable across recent versions |

## What's next (per ARCHITECTURE.md)

Milestone 2: wrap this exact pipeline in a Tauri app — `tauri-plugin-global-shortcut` press/release replaces the Enter keys, `arboard` + `enigo` paste the transcript at your cursor. That's end-to-end dictation.
