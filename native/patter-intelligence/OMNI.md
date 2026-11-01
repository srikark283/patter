# patter-1-omni desktop integration

Omni is a 4-bit MLX LFM2 cleanup model. It uses separate system and user
messages matching the training contract in `patter-model/training/data.py`.
The existing English cleanup, app instructions, chunking, cancellation, and
truncation safeguards apply. This is text cleanup, not audio or vision inference.

The pinned release is described by `omni-model.json`: immutable release URL,
revision, file sizes, and SHA-256 checksums. Weights are not committed.
In Intelligence, choose **Patter 1 Omni → Download & use**. Installation downloads
and verifies the model, license, notice, and model card, then loads the model
before saving the selection. No local export path is required.

Published release: https://github.com/srikark283/patter/releases/tag/patter-1-omni-094013416e15

Omni does not use nano's update channel. To adopt a new release, verify its
published manifest and update `omni-model.json`. Rebuild the helper with
`npm run build:intelligence` when upgrading an existing dev build.

On Apple Silicon with macOS 14 or newer, test download and inference with:

```sh
npm run build:intelligence
cargo test --manifest-path src-tauri/Cargo.toml omni_bundled_runtime_smoke -- --ignored --nocapture
```

For offline testing, set `PATTER_OMNI_SOURCE` to a folder containing every file
from the release manifest, including its notices and model card.
