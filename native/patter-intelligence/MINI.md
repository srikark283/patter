# patter-1-mini desktop integration

The selection uses a separate `patter-1-mini` settings ID, cache directory, and
Qwen system/user message format. Nano keeps its Gemma user-turn format.
Both Patter models accept app-profile instructions; neither supplies personal
memory or meeting notes. Those features continue to use Ollama.

The pinned 4-bit MLX release is described by `mini-model.json`: immutable release
URL, file sizes, SHA-256 checksums, and release revision. Weights are not committed.
Select mini and use **Download & enable**. Installation downloads the model and
its license, notice, and model card, verifies all files, then loads the model
before saving the new active selection. No local export path is required.

Published release: https://github.com/srikark283/patter/releases/tag/patter-1-mini-7294d1a1274c

This version is pinned; mini does not use nano's Gemma update channel. To adopt a
new mini release, verify its published manifest and update `mini-model.json`.
Rebuild the helper with `npm run build:intelligence` when upgrading an existing dev build.

Comparison copy describes capabilities and model capacity, not benchmarked
quality or latency. Test the same dictation and app instructions across models
before making performance recommendations.

Download and inference check:

```sh
npm run build:intelligence
cargo test --manifest-path src-tauri/Cargo.toml mini_bundled_runtime_smoke -- --ignored --nocapture
```
